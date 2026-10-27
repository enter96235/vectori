using System.Diagnostics;
using System.IO.Ports;
using System.Text.RegularExpressions;

namespace AudiTt.J2534Bridge;

public sealed class UcanInterface
{
    public UcanInterface(string portName, string kind = "serial", string? name = null)
    {
        PortName = portName;
        Kind = kind;
        Id = kind == "bluetooth" ? $"bt:{portName}" : $"ucan:{portName}";
        Name = name ?? (kind == "bluetooth"
            ? $"Adaptador de diagnóstico serie Bluetooth ({portName})"
            : $"Adaptador de diagnóstico serie USB ({portName})");
    }

    public string Id { get; }
    public string Name { get; }
    public string Kind { get; }
    public bool Connected => false;
    public string Driver => Kind == "bluetooth" ? "ELM327 / serie Bluetooth" : "Compatible con SLCAN / CANable";
    public string? Firmware => null;
    public string? FunctionLibrary => null;
    public string Architecture => Environment.Is64BitProcess ? "x64" : "x86";
    public string PortName { get; }
}

public sealed record UcanProbeResult(
    bool Success,
    string PortName,
    string? Firmware,
    string Message
);

public sealed class UcanCatalog
{
    private readonly ILogger _logger;

    public UcanCatalog(ILogger logger)
    {
        _logger = logger;
    }

    public IReadOnlyList<UcanInterface> Discover()
    {
        var result = new List<UcanInterface>();

        foreach (var port in GetPortNames())
        {
            result.Add(new UcanInterface(port, "serial"));
        }

        if (OperatingSystem.IsLinux())
        {
            foreach (var bt in DiscoverBluetoothDevices())
            {
                result.Add(new UcanInterface(bt.Address, "bluetooth", bt.Name));
            }
        }

        return result
            .OrderBy(device => device.Kind, StringComparer.OrdinalIgnoreCase)
            .ThenBy(device => device.PortName, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public UcanProbeResult Probe(string portName)
    {
        if (string.IsNullOrWhiteSpace(portName))
        {
            return new(false, portName, null, "Se requiere el nombre del puerto serie.");
        }

        var normalized = NormalizePortName(portName);
        if (IsBluetoothAddress(normalized))
        {
            return ProbeBluetoothDevice(normalized);
        }

        return ProbeSerialPort(normalized);
    }

    private UcanProbeResult ProbeSerialPort(string portName)
    {
        foreach (var baudRate in new[] { 38400, 9600, 115200, 19200, 57600 })
        {
            try
            {
                using var port = new SerialPort(portName, baudRate, Parity.None, 8, StopBits.One)
                {
                    NewLine = "\r",
                    ReadTimeout = 700,
                    WriteTimeout = 700,
                    DtrEnable = false,
                    RtsEnable = false
                };
                port.Open();
                port.DiscardInBuffer();
                port.Write("ATZ\r");
                Thread.Sleep(1000);
                var elmResponse = port.ReadExisting().Trim();
                if (elmResponse.Contains("ELM", StringComparison.OrdinalIgnoreCase) || elmResponse.Contains("OBD", StringComparison.OrdinalIgnoreCase))
                {
                    port.Write("ATI\r");
                    Thread.Sleep(250);
                    var version = port.ReadExisting().Trim();
                    return new(true, portName, version, $"Adaptador compatible con ELM detectado a {baudRate} baudios: {version}");
                }

                if (baudRate == 115200)
                {
                    port.DiscardInBuffer();
                    port.Write("V\r");
                    Thread.Sleep(150);
                    var response = port.ReadExisting().Trim();
                    if (!string.IsNullOrWhiteSpace(response))
                    {
                        return new(true, portName, response, $"Adaptador CAN serie detectado: {response}");
                    }
                }
            }
            catch (UnauthorizedAccessException exception)
            {
                _logger.LogDebug(exception, "Unable to open serial port {Port}", portName);
                return new(false, portName, null, $"No se puede acceder a {portName}. Comprueba que ningún otro programa esté usando el puerto.");
            }
            catch (Exception exception) when (exception is IOException or InvalidOperationException)
            {
                _logger.LogDebug(exception, "Unable to probe serial port {Port} at {BaudRate}", portName, baudRate);
            }
        }

        return new(false, portName, null, "El puerto COM se abrió, pero no respondió a las consultas de identificación ELM327 o SLCAN.");
    }

    private UcanProbeResult ProbeBluetoothDevice(string bluetoothAddress)
    {
        var address = NormalizeBluetoothAddress(bluetoothAddress);
        if (string.IsNullOrWhiteSpace(address))
        {
            return new(false, bluetoothAddress, null, "La dirección MAC de Bluetooth no es válida.");
        }

        var trustResult = RunCommand("bluetoothctl", $"trust {address}");
        if (trustResult.ExitCode != 0 && !string.IsNullOrWhiteSpace(trustResult.StdErr))
        {
            _logger.LogWarning("bluetoothctl trust returned {ExitCode}: {Error}", trustResult.ExitCode, trustResult.StdErr);
        }

        var pairResult = RunCommand("bluetoothctl", $"pair {address}");
        if (pairResult.ExitCode != 0 && !string.IsNullOrWhiteSpace(pairResult.StdErr))
        {
            _logger.LogWarning("bluetoothctl pair returned {ExitCode}: {Error}", pairResult.ExitCode, pairResult.StdErr);
        }

        var bindResult = RunCommand("rfcomm", $"bind 0 {address}");
        if (bindResult.ExitCode != 0 && !string.IsNullOrWhiteSpace(bindResult.StdErr))
        {
            _logger.LogWarning("rfcomm bind returned {ExitCode}: {Error}", bindResult.ExitCode, bindResult.StdErr);
        }

        var devicePath = FindRfcommDevicePath();
        if (devicePath is null)
        {
            return new(
                false,
                address,
                null,
                "Se intentó emparejar y autorizar el dispositivo, pero no se creó el puerto RFCOMM. Revisa la configuración de Bluetooth y los permisos de Linux."
            );
        }

        return ProbeSerialPort(devicePath);
    }

    private static IReadOnlyList<string> GetPortNames()
    {
        var names = SerialPort.GetPortNames();
        if (names.Length > 0)
        {
            return names;
        }

        if (OperatingSystem.IsLinux() || OperatingSystem.IsMacOS())
        {
            var paths = new[]
            {
                "/dev/ttyUSB",
                "/dev/ttyACM",
                "/dev/ttyS",
                "/dev/cu.usbserial",
                "/dev/cu.usbmodem",
                "/dev/serial/by-id",
                "/dev/serial/by-path"
            };

            var discovered = new List<string>();
            foreach (var prefix in paths)
            {
                try
                {
                    if (!Directory.Exists(prefix))
                    {
                        continue;
                    }

                    foreach (var entry in Directory.EnumerateFiles(prefix, "*", SearchOption.TopDirectoryOnly))
                    {
                        if (!string.IsNullOrWhiteSpace(entry))
                        {
                            discovered.Add(entry);
                        }
                    }

                    foreach (var entry in Directory.EnumerateDirectories(prefix, "*", SearchOption.TopDirectoryOnly))
                    {
                        if (!string.IsNullOrWhiteSpace(entry))
                        {
                            discovered.Add(entry);
                        }
                    }
                }
                catch
                {
                    // Ignore filesystem access issues while scanning for serial devices.
                }
            }

            return discovered
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Order(StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }

        return Array.Empty<string>();
    }

    private static IReadOnlyList<(string Address, string Name)> DiscoverBluetoothDevices()
    {
        if (!OperatingSystem.IsLinux())
        {
            return Array.Empty<(string Address, string Name)>();
        }

        var pairedResult = RunCommand("bluetoothctl", "paired-devices");
        var devicesResult = RunCommand("bluetoothctl", "devices");
        var discovered = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var output in new[] { pairedResult.StdOut, devicesResult.StdOut })
        {
            foreach (var line in output.Split('\n', StringSplitOptions.RemoveEmptyEntries))
            {
                var match = Regex.Match(line, @"Device\s+([0-9A-Fa-f:]{17})\s*(.*)$");
                if (!match.Success)
                {
                    continue;
                }

                var address = NormalizeBluetoothAddress(match.Groups[1].Value);
                var name = match.Groups[2].Value.Trim();
                if (string.IsNullOrWhiteSpace(address))
                {
                    continue;
                }

                if (!discovered.TryGetValue(address, out var existingName) || string.IsNullOrWhiteSpace(existingName))
                {
                    discovered[address] = name;
                }
            }
        }

        return discovered
            .OrderBy(item => item.Key, StringComparer.OrdinalIgnoreCase)
            .Select(item => (Address: item.Key, Name: string.IsNullOrWhiteSpace(item.Value) ? "Adaptador serie Bluetooth" : item.Value))
            .ToArray();
    }

    private static string? FindRfcommDevicePath()
    {
        if (!OperatingSystem.IsLinux())
        {
            return null;
        }

        try
        {
            var devices = Directory.GetFiles("/dev", "rfcomm*", SearchOption.TopDirectoryOnly);
            return devices.FirstOrDefault();
        }
        catch
        {
            return null;
        }
    }

    private static (int ExitCode, string StdOut, string StdErr) RunCommand(string fileName, string arguments)
    {
        try
        {
            using var process = new Process();
            process.StartInfo = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            process.Start();
            var stdout = process.StandardOutput.ReadToEnd();
            var stderr = process.StandardError.ReadToEnd();
            process.WaitForExit();
            return (process.ExitCode, stdout, stderr);
        }
        catch (Exception exception)
        {
            return (-1, string.Empty, exception.Message);
        }
    }

    private static string NormalizePortName(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.StartsWith("bt:", StringComparison.OrdinalIgnoreCase))
        {
            trimmed = trimmed[3..];
        }

        if (trimmed.StartsWith("rfcomm", StringComparison.OrdinalIgnoreCase))
        {
            return trimmed;
        }

        return trimmed;
    }

    private static string NormalizeBluetoothAddress(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.StartsWith("bt:", StringComparison.OrdinalIgnoreCase))
        {
            trimmed = trimmed[3..];
        }

        trimmed = trimmed.Trim();
        return trimmed;
    }

    private static bool IsBluetoothAddress(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        return Regex.IsMatch(value, "^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$");
    }
}