using System.Runtime.InteropServices;

namespace AudiTt.J2534Bridge;

[StructLayout(LayoutKind.Sequential, Pack = 1)]
internal struct PassThruMessage
{
    public uint ProtocolId;
    public uint RxStatus;
    public uint TxFlags;
    public uint Timestamp;
    public uint DataSize;
    public uint ExtraDataIndex;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 4128)]
    public byte[] Data;

    public static PassThruMessage Create() => new() { Data = new byte[4128] };
}

internal sealed class J2534ObdReader
{
    private const uint Iso15765 = 6;
    private const uint FlowControlFilter = 3;
    private const uint BufferEmpty = 10;
    private readonly ILogger _logger;

    public J2534ObdReader(ILogger logger)
    {
        _logger = logger;
    }

    public ObdSnapshot Read(string functionLibrary)
    {
        var readings = new List<ObdReading>();
        var diagnosticEvents = new List<string>();
        uint deviceId = 0;
        uint channelId = 0;
        var opened = false;
        var connected = false;
        var filterIds = new List<uint>();
        J2534Api? api = null;

        try
        {
            api = J2534Api.Load(functionLibrary);
            var status = api.Open(out deviceId);
            if (status != 0)
            {
                return Failure(functionLibrary, api.GetLastError(status));
            }
            opened = true;
            diagnosticEvents.Add("J2534: dispositivo PassThru abierto.");

            status = api.Connect(deviceId, Iso15765, 0, 500000, out channelId);
            if (status != 0)
            {
                return Failure(functionLibrary, $"Falló la conexión ISO 15765: {api.GetLastError(status)}");
            }
            connected = true;
            diagnosticEvents.Add("J2534: canal ISO 15765 conectado a 500 kbit/s.");

            for (uint responseId = 0x7E8; responseId <= 0x7E9; responseId++)
            {
                var mask = PassThruMessage.Create();
                mask.DataSize = 4;
                mask.Data[2] = 0x07;
                mask.Data[3] = 0xFF;
                var pattern = PassThruMessage.Create();
                pattern.DataSize = 4;
                pattern.Data[2] = (byte)(responseId >> 8);
                pattern.Data[3] = (byte)responseId;
                var flowControl = PassThruMessage.Create();
                flowControl.ProtocolId = Iso15765;
                flowControl.DataSize = 4;
                flowControl.Data[2] = (byte)((responseId - 8) >> 8);
                flowControl.Data[3] = (byte)(responseId - 8);
                status = api.StartFilter(channelId, FlowControlFilter, ref mask, ref pattern, ref flowControl, out var filterId);
                if (status != 0)
                {
                    return Failure(functionLibrary, $"Falló el filtro ISO 15765 para respuestas CAN 0x{responseId:X3}: {api.GetLastError(status)}");
                }
                filterIds.Add(filterId);
            }

            foreach (var definition in Definitions)
            {
                var payload = ReadService(api, channelId, new byte[] { 0x01, definition.Pid });
                if (payload is null || payload.Length < definition.RequiredBytes + 2 || payload[0] != 0x41 || payload[1] != definition.Pid)
                {
                    continue;
                }

                var value = definition.Parse(payload[2..]);
                readings.Add(new ObdReading(definition.Key, definition.Label, value, definition.Unit, $"01{definition.Pid:X2}", DateTimeOffset.UtcNow));
            }

            var statusPayload = ReadService(api, channelId, new byte[] { 0x01, 0x01 });
            bool? milOn = statusPayload is { Length: >= 3 } && statusPayload[0] == 0x41 && statusPayload[1] == 0x01
                ? (statusPayload[2] & 0x80) != 0
                : null;
            var vinResponse = ReadService(api, channelId, new byte[] { 0x09, 0x02 }, 3000);
            var vin = ParseVin(vinResponse);
            if (vin is null)
            {
                diagnosticEvents.Add("VIN: sin respuesta a la solicitud funcional OBD-II 7DF; probando dirección física del motor.");
                foreach (var requestId in new uint[] { 0x7E0, 0x7E1 })
                {
                    vin = ParseVin(ReadService(api, channelId, new byte[] { 0x09, 0x02 }, 1200, requestId));
                    if (vin is not null) break;
                    diagnosticEvents.Add($"VIN: sin respuesta del identificador CAN 0x{requestId:X3}.");
                }
            }
            diagnosticEvents.Add(vin is null ? "VIN: no se pudo extraer por OBD-II Mode 09." : $"VIN leído por OBD-II Mode 09: {vin}");
            var currentDtcs = ReadTroubleCodes(api, channelId, 0x03, 0x43);
            var pendingDtcs = ReadTroubleCodes(api, channelId, 0x07, 0x47);
            var permanentDtcs = ReadTroubleCodes(api, channelId, 0x0A, 0x4A);
            var timestamp = DateTimeOffset.UtcNow;
            var success = readings.Count > 0 ||
                milOn is not null ||
                vin is not null ||
                currentDtcs is not null ||
                pendingDtcs is not null ||
                permanentDtcs is not null;
            var dtcResponses = new[] { currentDtcs, pendingDtcs, permanentDtcs }.Count(codes => codes is not null);
            return new ObdSnapshot(
                success,
                functionLibrary,
                "J2534 ISO 15765",
                readings,
                success
                    ? $"Lectura OBD-II J2534 completada: {readings.Count} parámetro(s), {(vin is null ? "VIN no disponible" : "VIN leído")} y {dtcResponses} respuesta(s) de códigos."
                    : "J2534 se conectó, pero el vehículo no respondió a las consultas OBD-II.",
                timestamp)
            {
                MilOn = milOn,
                Vin = vin,
                CurrentDtcs = currentDtcs ?? Array.Empty<string>(),
                PendingDtcs = pendingDtcs ?? Array.Empty<string>(),
                PermanentDtcs = permanentDtcs ?? Array.Empty<string>(),
                CurrentDtcsAvailable = currentDtcs is not null,
                PendingDtcsAvailable = pendingDtcs is not null,
                PermanentDtcsAvailable = permanentDtcs is not null,
                TransportConnected = true,
                DiagnosticEvents = diagnosticEvents,
            };
        }
        catch (Exception exception) when (exception is DllNotFoundException or EntryPointNotFoundException or BadImageFormatException or InvalidOperationException or ExternalException)
        {
            _logger.LogWarning(exception, "Falló la lectura OBD mediante J2534 para {Library}", functionLibrary);
            return Failure(functionLibrary, J2534ErrorMessages.Describe(exception));
        }
        finally
        {
            try
            {
                if (api is not null)
                {
                    foreach (var filterId in filterIds) api.StopFilter(channelId, filterId);
                    if (connected) api.Disconnect(channelId);
                    if (opened) api.Close(deviceId);
                }
            }
            catch (Exception exception)
            {
                _logger.LogDebug(exception, "J2534 cleanup failed for {Library}", functionLibrary);
            }
            finally
            {
                api?.Dispose();
            }
        }
    }

    private static byte[]? ReadService(
        J2534Api api,
        uint channelId,
        byte[] serviceData,
        int timeoutMilliseconds = 1200,
        uint requestId = 0x7DF)
    {
        var request = PassThruMessage.Create();
        request.ProtocolId = Iso15765;
        request.DataSize = (uint)(4 + serviceData.Length);
        request.Data[0] = 0;
        request.Data[1] = 0;
        request.Data[2] = (byte)(requestId >> 8);
        request.Data[3] = (byte)requestId;
        Array.Copy(serviceData, 0, request.Data, 4, serviceData.Length);
        uint sendCount = 1;
        var status = api.WriteMessages(channelId, ref request, ref sendCount, 1000);
        if (status != 0 || sendCount == 0) return null;

        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMilliseconds);
        var assembled = new List<byte>();
        var expectedLength = 0;
        var nextSequence = 1;
        while (DateTime.UtcNow < deadline)
        {
            var response = PassThruMessage.Create();
            uint count = 1;
            status = api.ReadMessages(channelId, ref response, ref count, 200);
            if (status == BufferEmpty || count == 0) continue;
            if (status != 0 || response.DataSize < 5) return null;

            var data = response.Data;
            var payloadLength = (int)response.DataSize - 4;
            var firstByte = data[4];
            var frameType = firstByte >> 4;

            if (frameType == 0)
            {
                var singleFrameLength = firstByte & 0x0F;
                if (singleFrameLength == 0 || singleFrameLength > payloadLength - 1) continue;
                var singleFramePayload = data.AsSpan(5, singleFrameLength).ToArray();
                if (MatchesResponse(singleFramePayload, serviceData)) return singleFramePayload;
                continue;
            }

            if (frameType == 1 && payloadLength >= 2)
            {
                expectedLength = ((firstByte & 0x0F) << 8) | data[5];
                if (expectedLength <= 0 || expectedLength > 4095) return null;
                assembled.Clear();
                assembled.AddRange(data.AsSpan(6, payloadLength - 2).ToArray());
                nextSequence = 1;
                if (assembled.Count >= expectedLength)
                {
                    var firstFramePayload = assembled.Take(expectedLength).ToArray();
                    if (MatchesResponse(firstFramePayload, serviceData)) return firstFramePayload;
                    expectedLength = 0;
                }
                continue;
            }

            if (frameType == 2 && expectedLength > 0 && payloadLength > 1)
            {
                if ((firstByte & 0x0F) != nextSequence) return null;
                assembled.AddRange(data.AsSpan(5, payloadLength - 1).ToArray());
                nextSequence = (nextSequence + 1) & 0x0F;
                if (assembled.Count >= expectedLength)
                {
                    var multiFramePayload = assembled.Take(expectedLength).ToArray();
                    if (MatchesResponse(multiFramePayload, serviceData)) return multiFramePayload;
                    expectedLength = 0;
                }
                continue;
            }

            var messagePayload = data.AsSpan(4, payloadLength).ToArray();
            if (MatchesResponse(messagePayload, serviceData))
            {
                return messagePayload;
            }
        }

        return null;
    }

    private static byte ExpectedResponseService(byte[] serviceData) =>
        serviceData.Length > 0 ? (byte)(serviceData[0] + 0x40) : (byte)0;

    private static bool MatchesResponse(byte[] payload, byte[] serviceData)
    {
        if (serviceData.Length == 0 ||
            payload.Length < serviceData.Length ||
            payload[0] != ExpectedResponseService(serviceData))
        {
            return false;
        }

        return serviceData.Length < 2 || payload[1] == serviceData[1];
    }

    private static string? ParseVin(byte[]? payload)
    {
        if (payload is not { Length: >= 3 } || payload[0] != 0x49 || payload[1] != 0x02)
        {
            return null;
        }

        var start = payload[2] == 0x01 ? 3 : 2;
        var vin = new string(payload
            .Skip(start)
            .Take(17)
            .Select(value => (char)value)
            .ToArray());
        return vin.Length == 17 && vin.All(char.IsAsciiLetterOrDigit) ? vin : null;
    }

    private static IReadOnlyList<string>? ReadTroubleCodes(
        J2534Api api,
        uint channelId,
        byte mode,
        byte responseMode)
    {
        var payload = ReadService(api, channelId, new[] { mode }, 1800);
        if (payload is null || payload.Length == 0 || payload[0] != responseMode)
        {
            return null;
        }

        var codes = new List<string>();
        for (var index = 1; index + 1 < payload.Length; index += 2)
        {
            var first = payload[index];
            var second = payload[index + 1];
            if (first == 0 && second == 0) continue;
            var family = new[] { 'P', 'C', 'B', 'U' }[(first >> 6) & 0x03];
            var digit = (first >> 4) & 0x03;
            codes.Add($"{family}{digit:X1}{first & 0x0F:X1}{second:X2}");
        }
        return codes.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private static ObdSnapshot Failure(string functionLibrary, string message) =>
        new(false, functionLibrary, null, Array.Empty<ObdReading>(), message, DateTimeOffset.UtcNow);

    private sealed record Definition(byte Pid, string Key, string Label, string Unit, int RequiredBytes, Func<byte[], double> Parse);

    private static readonly Definition[] Definitions =
    {
        new(0x04, "load", "Carga calculada del motor", "%", 1, bytes => bytes[0] * 100d / 255d),
        new(0x05, "coolant", "Temperatura del refrigerante", "°C", 1, bytes => bytes[0] - 40),
        new(0x06, "trim-short-1", "Ajuste de combustible a corto plazo, banco 1", "%", 1, bytes => (bytes[0] - 128) * 100d / 128d),
        new(0x08, "trim-long-1", "Ajuste de combustible a largo plazo, banco 1", "%", 1, bytes => (bytes[0] - 128) * 100d / 128d),
        new(0x0A, "fuel-pressure", "Presión de combustible", "kPa", 1, bytes => bytes[0] * 3d),
        new(0x0B, "map", "Presión del múltiple de admisión", "kPa", 1, bytes => bytes[0]),
        new(0x0C, "rpm", "Revoluciones del motor", "rpm", 2, bytes => (bytes[0] * 256 + bytes[1]) / 4d),
        new(0x0D, "speed", "Velocidad del vehículo", "km/h", 1, bytes => bytes[0]),
        new(0x0E, "timing", "Avance de encendido", "°", 1, bytes => bytes[0] / 2d - 64),
        new(0x0F, "intake", "Temperatura del aire de admisión", "°C", 1, bytes => bytes[0] - 40),
        new(0x10, "maf", "Caudal de aire (MAF)", "g/s", 2, bytes => (bytes[0] * 256 + bytes[1]) / 100d),
        new(0x11, "throttle", "Posición del acelerador", "%", 1, bytes => bytes[0] * 100d / 255d),
        new(0x1F, "runtime", "Tiempo de funcionamiento del motor", "s", 2, bytes => bytes[0] * 256 + bytes[1]),
        new(0x2F, "fuel-level", "Nivel de combustible", "%", 1, bytes => bytes[0] * 100d / 255d),
        new(0x33, "barometric", "Presión barométrica", "kPa", 1, bytes => bytes[0]),
        new(0x42, "voltage", "Voltaje del módulo de control", "V", 2, bytes => (bytes[0] * 256 + bytes[1]) / 1000d),
        new(0x45, "relative-throttle", "Posición relativa del acelerador", "%", 1, bytes => bytes[0] * 100d / 255d),
        new(0x46, "ambient", "Temperatura ambiente", "°C", 1, bytes => bytes[0] - 40),
        new(0x5C, "oil-temp", "Temperatura del aceite del motor", "°C", 1, bytes => bytes[0] - 40),
    };
}