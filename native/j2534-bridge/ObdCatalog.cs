using System.Globalization;
using System.IO.Ports;
using System.Text.RegularExpressions;

namespace AudiTt.J2534Bridge;

public sealed record ObdReading(
    string Key,
    string Label,
    double Value,
    string Unit,
    string Pid,
    DateTimeOffset Timestamp
);

public sealed record ObdSnapshot(
    bool Success,
    string PortName,
    string? Adapter,
    IReadOnlyList<ObdReading> Readings,
    string Message,
    DateTimeOffset Timestamp)
{
    public bool TransportConnected { get; init; }
    public IReadOnlyList<string> DiagnosticEvents { get; init; } = Array.Empty<string>();
    public string? Vin { get; init; }
    public bool? MilOn { get; init; }
    public IReadOnlyList<string> CurrentDtcs { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> PendingDtcs { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> PermanentDtcs { get; init; } = Array.Empty<string>();
    public bool CurrentDtcsAvailable { get; init; }
    public bool PendingDtcsAvailable { get; init; }
    public bool PermanentDtcsAvailable { get; init; }
}

public sealed class ObdCatalog
{
    private readonly ILogger _logger;
    private readonly object _sync = new();
    private readonly List<string> _events = new();

    public ObdCatalog(ILogger logger)
    {
        _logger = logger;
    }

    public IReadOnlyList<string> Events
    {
        get
        {
            lock (_sync)
            {
                return _events.ToArray();
            }
        }
    }

    public void RecordEvent(string message) => AddEvent(message);

    public ObdSnapshot Read(string portName)
    {
        if (string.IsNullOrWhiteSpace(portName))
        {
            return Fail(portName, "Se requiere un puerto COM.");
        }

        try
        {
            var connection = OpenElmPort(portName);
            if (connection is null)
            {
                return Fail(portName, "El ELM327 no respondió. Comprueba el puerto COM, el emparejamiento Bluetooth y la alimentación del adaptador.");
            }

            using var port = connection.Value.Port;
            AddEvent($"El adaptador ELM respondió en {portName} a {connection.Value.BaudRate} baudios.");
            Send(port, "ATE0", 250);
            Send(port, "ATL0", 250);
            Send(port, "ATS0", 250);
            Send(port, "ATH0", 250);
            Send(port, "ATSP0", 300);
            var adapter = connection.Value.Adapter;
            var readings = new List<ObdReading>();

            foreach (var definition in Definitions)
            {
                var response = Send(port, definition.Command, 700);
                var bytes = ParsePidBytes(response, definition.Pid);
                if (bytes is null)
                {
                    AddEvent($"{definition.Pid} · {definition.Label}: sin respuesta.");
                    continue;
                }

                if (bytes.Length < definition.RequiredBytes)
                {
                    AddEvent($"{definition.Pid} · {definition.Label}: respuesta incompleta.");
                    continue;
                }

                var value = definition.Parse(bytes);
                readings.Add(new ObdReading(definition.Key, definition.Label, value, definition.Unit, definition.Pid, DateTimeOffset.UtcNow));
                AddEvent($"{definition.Pid} {definition.Label}: {value.ToString("0.##", CultureInfo.InvariantCulture)} {definition.Unit}".TrimEnd());
            }

            var statusBytes = ParsePidBytes(Send(port, "0101", 500), "0101");
            bool? milOn = statusBytes is { Length: >= 2 } ? (statusBytes[0] & 0x80) != 0 : null;
            var currentDtcs = ReadTroubleCodes(port, "03", "43");
            var pendingDtcs = ReadTroubleCodes(port, "07", "47");
            var permanentDtcs = ReadTroubleCodes(port, "0A", "4A");
            var vin = ReadVin(port);
            AddTroubleCodeEvent("Modo 03", currentDtcs, "actual");
            AddTroubleCodeEvent("Modo 07", pendingDtcs, "pendiente");
            AddTroubleCodeEvent("Modo 0A", permanentDtcs, "permanente");
            if (!string.IsNullOrWhiteSpace(vin)) AddEvent($"VIN leído: {vin}");

            var success = readings.Count > 0 || vin is not null || milOn is not null || currentDtcs is not null || pendingDtcs is not null || permanentDtcs is not null;
            var message = success
                ? $"Se leyeron {readings.Count} parámetro(s) OBD-II compatible(s) y datos de avería/estado."
                : "El adaptador respondió, pero el vehículo no devolvió PIDs OBD-II compatibles.";
            AddEvent(message);
            return new ObdSnapshot(success, portName, adapter, readings, message, DateTimeOffset.UtcNow)
            {
                Vin = vin,
                MilOn = milOn,
                TransportConnected = true,
                CurrentDtcs = currentDtcs ?? Array.Empty<string>(),
                PendingDtcs = pendingDtcs ?? Array.Empty<string>(),
                PermanentDtcs = permanentDtcs ?? Array.Empty<string>(),
                CurrentDtcsAvailable = currentDtcs is not null,
                PendingDtcsAvailable = pendingDtcs is not null,
                PermanentDtcsAvailable = permanentDtcs is not null,
            };
        }
        catch (Exception exception) when (exception is UnauthorizedAccessException or IOException or InvalidOperationException)
        {
            _logger.LogWarning(exception, "No se pudieron leer datos OBD-II desde {Port}", portName);
            var message = DescribeSerialError(portName, exception);
            AddEvent(message);
            return Fail(portName, message);
        }
    }

    private ObdSnapshot Fail(string portName, string message)
    {
        AddEvent(message);
        return new(false, portName, null, Array.Empty<ObdReading>(), message, DateTimeOffset.UtcNow);
    }

    private static string DescribeSerialError(string portName, Exception exception) => exception switch
    {
        UnauthorizedAccessException => $"No se puede acceder a {portName}. Comprueba los permisos y cierra otros programas que usen el puerto.",
        InvalidOperationException => $"El puerto {portName} no está disponible. Desconecta y vuelve a conectar el adaptador.",
        IOException => $"Falló la comunicación por {portName}. Comprueba la conexión y vuelve a intentarlo.",
        _ => $"No se pudo leer el adaptador en {portName}.",
    };

    private void AddEvent(string message)
    {
        lock (_sync)
        {
            _events.Add($"{DateTimeOffset.Now:HH:mm:ss} {message}");
            if (_events.Count > 100)
            {
                _events.RemoveAt(0);
            }
        }
    }

    private static string[] Send(SerialPort port, string command, int waitMilliseconds)
    {
        port.DiscardInBuffer();
        port.Write(command + "\r");
        Thread.Sleep(waitMilliseconds);
        return port.ReadExisting()
            .Split(new[] { '\r', '\n', '>' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Trim())
            .Where(line => line.Length > 0 && !line.Equals(command, StringComparison.OrdinalIgnoreCase))
            .ToArray();
    }

    private static (SerialPort Port, string Adapter, int BaudRate)? OpenElmPort(string portName)
    {
        foreach (var baudRate in new[] { 38400, 9600, 115200, 19200, 57600 })
        {
            var port = new SerialPort(portName, baudRate, Parity.None, 8, StopBits.One)
            {
                NewLine = "\r",
                ReadTimeout = 900,
                WriteTimeout = 900,
                DtrEnable = false,
                RtsEnable = false,
            };

            try
            {
                port.Open();
                Send(port, "ATZ", 1100);
                var identity = Send(port, "ATI", 450);
                var adapter = identity.FirstOrDefault(line =>
                    line.Contains("ELM", StringComparison.OrdinalIgnoreCase) ||
                    line.Contains("OBD", StringComparison.OrdinalIgnoreCase));
                if (!string.IsNullOrWhiteSpace(adapter))
                {
                    return (port, adapter, baudRate);
                }
            }
            catch (UnauthorizedAccessException)
            {
                port.Dispose();
                throw;
            }
            catch (IOException)
            {
                port.Dispose();
                continue;
            }
            catch (InvalidOperationException)
            {
                port.Dispose();
                continue;
            }

            port.Dispose();
        }

        return null;
    }

    private static byte[]? ParsePidBytes(IEnumerable<string> lines, string pid)
    {
        var hex = Regex.Replace(string.Concat(lines).ToUpperInvariant(), "[^0-9A-F]", "");
        var match = Regex.Match(hex, $"41{pid[2..]}([0-9A-F]{{2,}})");
        if (!match.Success)
        {
            return null;
        }

        var payload = match.Groups[1].Value;
        payload = payload[..(payload.Length / 2 * 2)];
        var values = Regex.Matches(payload, "[0-9A-F]{2}")
            .Select(item => byte.Parse(item.Value, NumberStyles.HexNumber, CultureInfo.InvariantCulture))
            .ToArray();
        if (pid.Equals("010C", StringComparison.OrdinalIgnoreCase) && values.Length < 2)
        {
            return null;
        }

        return values.Length > 0 ? values : null;
    }

    private void AddTroubleCodeEvent(string mode, IReadOnlyList<string>? codes, string type)
    {
        AddEvent(codes is null
            ? $"{mode}: el vehículo no respondió."
            : $"{mode}: {codes.Count} código(s) {type}(s).");
    }

    private static IReadOnlyList<string>? ReadTroubleCodes(SerialPort port, string command, string responseService)
    {
        var raw = Regex.Replace(string.Concat(Send(port, command, 600)).ToUpperInvariant(), "[^0-9A-F]", "");
        var serviceIndex = raw.IndexOf(responseService, StringComparison.Ordinal);
        if (serviceIndex < 0) return null;

        var payload = raw[(serviceIndex + 2)..];
        payload = payload[..(payload.Length / 4 * 4)];
        var codes = new List<string>();
        for (var index = 0; index + 4 <= payload.Length; index += 4)
        {
            var first = byte.Parse(payload.Substring(index, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
            var second = byte.Parse(payload.Substring(index + 2, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
            if (first == 0 && second == 0) continue;
            var family = new[] { 'P', 'C', 'B', 'U' }[(first >> 6) & 0x03];
            var digit = (first >> 4) & 0x03;
            codes.Add($"{family}{digit:X1}{first & 0x0F:X1}{second:X2}");
        }
        return codes.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private static string? ReadVin(SerialPort port)
    {
        var raw = Regex.Replace(string.Concat(Send(port, "0902", 900)).ToUpperInvariant(), "[^0-9A-F]", "");
        var responseIndex = raw.IndexOf("4902", StringComparison.Ordinal);
        if (responseIndex < 0) return null;
        var data = raw[(responseIndex + 4)..];
        if (data.StartsWith("01", StringComparison.Ordinal)) data = data[2..];
        var vin = new string(Regex.Matches(data, "[0-9A-F]{2}")
            .Select(item => (char)byte.Parse(item.Value, NumberStyles.HexNumber, CultureInfo.InvariantCulture))
            .Take(17)
            .ToArray());
        return vin.Length == 17 && vin.All(character => char.IsAsciiLetterOrDigit(character)) ? vin : null;
    }

    private sealed record Definition(string Key, string Label, string Command, string Pid, string Unit, int RequiredBytes, Func<byte[], double> Parse);

    private static readonly Definition[] Definitions =
    {
        new("load", "Carga calculada del motor", "0104", "0104", "%", 1, bytes => bytes[0] * 100d / 255d),
        new("coolant", "Temperatura del refrigerante", "0105", "0105", "°C", 1, bytes => bytes[0] - 40),
        new("trim-short-1", "Ajuste de combustible a corto plazo, banco 1", "0106", "0106", "%", 1, bytes => (bytes[0] - 128) * 100d / 128d),
        new("trim-long-1", "Ajuste de combustible a largo plazo, banco 1", "0108", "0108", "%", 1, bytes => (bytes[0] - 128) * 100d / 128d),
        new("fuel-pressure", "Presión de combustible", "010A", "010A", "kPa", 1, bytes => bytes[0] * 3d),
        new("map", "Presión del múltiple de admisión", "010B", "010B", "kPa", 1, bytes => bytes[0]),
        new("rpm", "Revoluciones del motor", "010C", "010C", "rpm", 2, bytes => (bytes[0] * 256 + bytes[1]) / 4d),
        new("speed", "Velocidad del vehículo", "010D", "010D", "km/h", 1, bytes => bytes[0]),
        new("timing", "Avance de encendido", "010E", "010E", "°", 1, bytes => bytes[0] / 2d - 64),
        new("intake", "Temperatura del aire de admisión", "010F", "010F", "°C", 1, bytes => bytes[0] - 40),
        new("maf", "Caudal de aire (MAF)", "0110", "0110", "g/s", 2, bytes => (bytes[0] * 256 + bytes[1]) / 100d),
        new("throttle", "Posición del acelerador", "0111", "0111", "%", 1, bytes => bytes[0] * 100d / 255d),
        new("runtime", "Tiempo de funcionamiento del motor", "011F", "011F", "s", 2, bytes => bytes[0] * 256 + bytes[1]),
        new("fuel-level", "Nivel de combustible", "012F", "012F", "%", 1, bytes => bytes[0] * 100d / 255d),
        new("barometric", "Presión barométrica", "0133", "0133", "kPa", 1, bytes => bytes[0]),
        new("voltage", "Voltaje del módulo de control", "0142", "0142", "V", 2, bytes => (bytes[0] * 256 + bytes[1]) / 1000d),
        new("relative-throttle", "Posición relativa del acelerador", "0145", "0145", "%", 1, bytes => bytes[0] * 100d / 255d),
        new("ambient", "Temperatura ambiente", "0146", "0146", "°C", 1, bytes => bytes[0] - 40),
        new("oil-temp", "Temperatura del aceite del motor", "015C", "015C", "°C", 1, bytes => bytes[0] - 40),
    };
}