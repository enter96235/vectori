using System.Runtime.InteropServices;
using Microsoft.Win32;
using System.Text.Json.Serialization;

namespace AudiTt.J2534Bridge;

public sealed class J2534Provider
{
    public J2534Provider(
        string id,
        string name,
        string vendor,
        string functionLibrary,
        string registryPath)
    {
        Id = id;
        Name = name;
        Driver = vendor;
        FunctionLibrary = functionLibrary;
        RegistryPath = registryPath;
    }

    public string Id { get; }
    public string Name { get; }
    public string Kind => "j2534";
    public bool Connected => false;
    public string Driver { get; }
    public string? Firmware => null;

    public string? FunctionLibrary { get; }
    public string Architecture => Environment.Is64BitProcess ? "x64" : "x86";

    [JsonIgnore]
    public string RegistryPath { get; }
}

public sealed record J2534ProbeResult(
    bool Success,
    string FunctionLibrary,
    uint? DeviceId,
    string Message
);

public sealed class J2534Catalog
{
    private const string RegistryRoot = @"SOFTWARE\PassThruSupport.04.04";
    private readonly ILogger _logger;

    public J2534Catalog(ILogger logger)
    {
        _logger = logger;
    }

    public IReadOnlyList<J2534Provider> Discover()
    {
        if (!OperatingSystem.IsWindows())
        {
            return Array.Empty<J2534Provider>();
        }

        var result = new List<J2534Provider>();
        var seenLibraries = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var registryView = Environment.Is64BitProcess
            ? RegistryView.Registry64
            : RegistryView.Registry32;
        using var baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, registryView);
        using var key = baseKey.OpenSubKey(RegistryRoot);
        if (key is null)
        {
            return result;
        }

        foreach (var subKeyName in key.GetSubKeyNames())
        {
            using var providerKey = key.OpenSubKey(subKeyName);
            var functionLibrary = providerKey?.GetValue("FunctionLibrary") as string;
            if (string.IsNullOrWhiteSpace(functionLibrary) ||
                !seenLibraries.Add(functionLibrary))
            {
                continue;
            }

            var name = providerKey?.GetValue("Name") as string ?? subKeyName;
            var vendor = providerKey?.GetValue("Vendor") as string ?? "Fabricante desconocido";
            result.Add(new J2534Provider(
                subKeyName,
                name,
                vendor,
                functionLibrary,
                $@"HKLM\{RegistryRoot}\{subKeyName}"
            ));
        }

        return result;
    }

    public J2534ProbeResult Probe(string functionLibrary)
    {
        if (!OperatingSystem.IsWindows())
        {
            return new(false, functionLibrary, null, "J2534 solo está disponible en Windows. Linux no puede cargar las bibliotecas PassThru necesarias.");
        }

        if (!Path.IsPathFullyQualified(functionLibrary))
        {
            return new(false, functionLibrary, null, "La ruta de la biblioteca J2534 debe ser absoluta.");
        }

        if (!File.Exists(functionLibrary))
        {
            return new(false, functionLibrary, null, "No existe la DLL J2534 registrada.");
        }

        try
        {
            using var api = J2534Api.Load(functionLibrary);
            var status = api.Open(out var deviceId);
            if (status != (int)J2534Status.NoError)
            {
                return new(false, functionLibrary, null, $"El proveedor J2534 rechazó la apertura: {api.GetLastError(status)}");
            }

            var closeStatus = api.Close(deviceId);
            if (closeStatus != (int)J2534Status.NoError)
            {
                _logger.LogWarning(
                    "J2534 provider opened but returned an error while closing: {Status}",
                    closeStatus
                );
            }

            return new(
                true,
                functionLibrary,
                deviceId,
                "El proveedor J2534 se cargó y PassThruOpen se completó correctamente."
            );
        }
        catch (Exception exception) when (
            exception is DllNotFoundException ||
            exception is EntryPointNotFoundException ||
            exception is BadImageFormatException ||
            exception is InvalidOperationException)
        {
            _logger.LogWarning(exception, "No se pudo probar el proveedor J2534 {Library}", functionLibrary);
            return new(false, functionLibrary, null, J2534ErrorMessages.Describe(exception));
        }
    }

    public ObdSnapshot ReadObd(string functionLibrary)
    {
        return new J2534ObdReader(_logger).Read(functionLibrary);
    }
}

internal enum J2534Status : int
{
    NoError = 0
}

internal static class J2534ErrorMessages
{
    public static string Describe(Exception exception) => exception switch
    {
        BadImageFormatException => "La DLL GODIAG no coincide con la arquitectura del puente. Prueba el proveedor J2534 de 32 bits o el de 64 bits según corresponda (error 0x8007000B).",
        DllNotFoundException => "No se pudo cargar la DLL J2534 o falta una de sus dependencias. Reinstala el controlador oficial de GODIAG.",
        EntryPointNotFoundException => "La DLL no expone una función J2534 requerida. Instala el controlador correcto del dispositivo.",
        InvalidOperationException => $"El proveedor J2534 no pudo completar la operación: {exception.Message}",
        _ => $"Falló la operación J2534: {exception.Message}",
    };
}

internal sealed class J2534Api : IDisposable
{
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int PassThruOpenDelegate(IntPtr name, out uint deviceId);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int PassThruCloseDelegate(uint deviceId);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int PassThruGetLastErrorDelegate(
        [Out] System.Text.StringBuilder errorText
    );

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int PassThruConnectDelegate(uint deviceId, uint protocolId, uint flags, uint baudRate, out uint channelId);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int PassThruDisconnectDelegate(uint channelId);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int PassThruStartMsgFilterDelegate(uint channelId, uint filterType, ref PassThruMessage mask, ref PassThruMessage pattern, IntPtr flowControl, out uint filterId);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int PassThruStopMsgFilterDelegate(uint channelId, uint filterId);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int PassThruMessagesDelegate(uint channelId, ref PassThruMessage message, ref uint count, uint timeout);

    private readonly IntPtr _library;
    private readonly PassThruOpenDelegate _open;
    private readonly PassThruCloseDelegate _close;
    private readonly PassThruGetLastErrorDelegate _getLastError;
    private readonly PassThruConnectDelegate _connect;
    private readonly PassThruDisconnectDelegate _disconnect;
    private readonly PassThruStartMsgFilterDelegate _startFilter;
    private readonly PassThruStopMsgFilterDelegate _stopFilter;
    private readonly PassThruMessagesDelegate _writeMessages;
    private readonly PassThruMessagesDelegate _readMessages;

    private J2534Api(
        IntPtr library,
        PassThruOpenDelegate open,
        PassThruCloseDelegate close,
        PassThruGetLastErrorDelegate getLastError,
        PassThruConnectDelegate connect,
        PassThruDisconnectDelegate disconnect,
        PassThruStartMsgFilterDelegate startFilter,
        PassThruStopMsgFilterDelegate stopFilter,
        PassThruMessagesDelegate writeMessages,
        PassThruMessagesDelegate readMessages)
    {
        _library = library;
        _open = open;
        _close = close;
        _getLastError = getLastError;
        _connect = connect;
        _disconnect = disconnect;
        _startFilter = startFilter;
        _stopFilter = stopFilter;
        _writeMessages = writeMessages;
        _readMessages = readMessages;
    }

    public static J2534Api Load(string functionLibrary)
    {
        var library = NativeLibrary.Load(functionLibrary);
        try
        {
            var open = GetDelegate<PassThruOpenDelegate>(library, "PassThruOpen");
            var close = GetDelegate<PassThruCloseDelegate>(library, "PassThruClose");
            var getLastError =
                GetDelegate<PassThruGetLastErrorDelegate>(library, "PassThruGetLastError");
            var connect = GetDelegate<PassThruConnectDelegate>(library, "PassThruConnect");
            var disconnect = GetDelegate<PassThruDisconnectDelegate>(library, "PassThruDisconnect");
            var startFilter = GetDelegate<PassThruStartMsgFilterDelegate>(library, "PassThruStartMsgFilter");
            var stopFilter = GetDelegate<PassThruStopMsgFilterDelegate>(library, "PassThruStopMsgFilter");
            var writeMessages = GetDelegate<PassThruMessagesDelegate>(library, "PassThruWriteMsgs");
            var readMessages = GetDelegate<PassThruMessagesDelegate>(library, "PassThruReadMsgs");
            return new J2534Api(library, open, close, getLastError, connect, disconnect, startFilter, stopFilter, writeMessages, readMessages);
        }
        catch
        {
            NativeLibrary.Free(library);
            throw;
        }
    }

    public int Open(out uint deviceId) => _open(IntPtr.Zero, out deviceId);

    public int Close(uint deviceId) => _close(deviceId);

    public int Connect(uint deviceId, uint protocolId, uint flags, uint baudRate, out uint channelId) =>
        _connect(deviceId, protocolId, flags, baudRate, out channelId);

    public int Disconnect(uint channelId) => _disconnect(channelId);

    public int StartFilter(
        uint channelId,
        uint filterType,
        ref PassThruMessage mask,
        ref PassThruMessage pattern,
        ref PassThruMessage flowControl,
        out uint filterId)
    {
        var flowControlPointer = Marshal.AllocHGlobal(Marshal.SizeOf<PassThruMessage>());
        try
        {
            Marshal.StructureToPtr(flowControl, flowControlPointer, false);
            return _startFilter(
                channelId,
                filterType,
                ref mask,
                ref pattern,
                flowControlPointer,
                out filterId);
        }
        finally
        {
            Marshal.FreeHGlobal(flowControlPointer);
        }
    }

    public int StopFilter(uint channelId, uint filterId) => _stopFilter(channelId, filterId);

    public int WriteMessages(uint channelId, ref PassThruMessage message, ref uint count, uint timeout) =>
        _writeMessages(channelId, ref message, ref count, timeout);

    public int ReadMessages(uint channelId, ref PassThruMessage message, ref uint count, uint timeout) =>
        _readMessages(channelId, ref message, ref count, timeout);

    public string GetLastError(int status)
    {
        var text = new System.Text.StringBuilder(256);
        var getErrorStatus = _getLastError(text);
        return getErrorStatus == (int)J2534Status.NoError
            ? $"{text} (status {status})"
            : $"J2534 devolvió el estado {status}. PassThruGetLastError también falló con el estado {getErrorStatus}.";
    }

    public void Dispose()
    {
        if (_library != IntPtr.Zero)
        {
            NativeLibrary.Free(_library);
        }
    }

    private static TDelegate GetDelegate<TDelegate>(IntPtr library, string name)
        where TDelegate : Delegate
    {
        var export = NativeLibrary.GetExport(library, name);
        return Marshal.GetDelegateForFunctionPointer<TDelegate>(export);
    }
}