using AudiTt.J2534Bridge;

var builder = WebApplication.CreateBuilder(args);
var port = Environment.GetEnvironmentVariable("J2534_BRIDGE_PORT") ?? "27401";

builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
builder.Logging.ClearProviders();
builder.Logging.AddConsole();

var app = builder.Build();
var catalog = new J2534Catalog(app.Logger);
var ucanCatalog = new UcanCatalog(app.Logger);
var obdCatalog = new ObdCatalog(app.Logger);
var permissions = new[]
{
    new { operation = "probe_adapter", adapter = "Adaptador serie / ELM327", protocol = "COM/Bluetooth serie y comandos AT", state = "available", reason = "Apertura del puerto e identificación AT implementadas.", confirmationRequired = false },
    new { operation = "probe_adapter", adapter = "GODIAG J2534", protocol = "SAE J2534 PassThruOpen/Close", state = "available", reason = "Carga de DLL y apertura/cierre implementados en bridges x86/x64.", confirmationRequired = false },
    new { operation = "read_obd_pids", adapter = "ELM327", protocol = "OBD-II por puerto COM/Bluetooth serie", state = "available", reason = "Lectura de PIDs Mode 01 implementada; los parámetros dependen del vehículo.", confirmationRequired = false },
    new { operation = "read_vin", adapter = "ELM327", protocol = "OBD-II Mode 09", state = "available", reason = "Consulta VIN implementada; requiere soporte del adaptador y del vehículo.", confirmationRequired = false },
    new { operation = "read_dtcs", adapter = "ELM327", protocol = "OBD-II Mode 03/07/0A", state = "available", reason = "Lectura genérica implementada para códigos del tren motriz OBD-II.", confirmationRequired = false },
    new { operation = "read_obd_pids", adapter = "GODIAG J2534", protocol = "J2534 ISO 15765 / OBD-II Mode 01", state = "available", reason = "Lectura de PIDs implementada; requiere DLL del fabricante con arquitectura compatible.", confirmationRequired = false },
    new { operation = "read_vin", adapter = "GODIAG J2534", protocol = "J2534 ISO 15765 / Mode 09", state = "available", reason = "Consulta VIN por OBD-II Mode 09; depende del soporte del vehículo y del proveedor J2534.", confirmationRequired = false },
    new { operation = "read_dtcs", adapter = "GODIAG J2534", protocol = "J2534 ISO 15765 / Mode 03/07/0A", state = "available", reason = "Consulta códigos OBD-II del motor; requiere respuesta compatible del vehículo y del adaptador.", confirmationRequired = false },
    new { operation = "scan_audi_modules", adapter = "GODIAG J2534", protocol = "Diagnóstico de módulos específico de marca", state = "pending", reason = "El escaneo de módulos OEM específicos de marca no está implementado ni validado.", confirmationRequired = false },
    new { operation = "clear_dtcs", adapter = "ELM327 / GODIAG J2534", protocol = "OBD-II Mode 04 / servicio específico", state = "blocked", reason = "Borrado no implementado; requiere control individual y confirmación explícita.", confirmationRequired = true },
    new { operation = "coding", adapter = "GODIAG J2534", protocol = "Diagnóstico específico de marca", state = "blocked", reason = "La codificación no está implementada ni validada.", confirmationRequired = true },
    new { operation = "adaptation", adapter = "GODIAG J2534", protocol = "Diagnóstico específico de marca", state = "blocked", reason = "Las adaptaciones no están implementadas ni validadas.", confirmationRequired = true },
    new { operation = "actuator_test", adapter = "GODIAG J2534", protocol = "Diagnóstico específico de marca", state = "blocked", reason = "Las pruebas de actuadores no están implementadas ni validadas.", confirmationRequired = true },
    new { operation = "ecu_programming", adapter = "GODIAG J2534", protocol = "Programación OEM específica", state = "blocked", reason = "Programación de ECUs bloqueada; no está implementada ni validada.", confirmationRequired = true },
};

bool IsAvailable(string operation, string adapter) => permissions.Any(item =>
    item.operation == operation && item.adapter == adapter && item.state == "available");

app.MapGet("/health", () => Results.Ok(new
{
    bridge = "available",
    message = "El puente J2534 está activo. Todavía no se ha iniciado una sesión con el vehículo."
}));

app.MapGet("/status", () => Results.Ok(new
{
    bridge = OperatingSystem.IsWindows() ? "available" : "limited-linux",
    adapter = "disconnected",
    vehicle = "unknown",
    profile = "Vehículo no identificado",
    permissions,
    message = OperatingSystem.IsWindows()
        ? "El puente está activo, pero no hay un adaptador ni una sesión de vehículo activos."
        : "En Linux solo está disponible la detección de interfaces serie; J2534 requiere Windows.",
}));

app.MapPost("/operations/{operation}", (string operation, OperationPermissionRequest request) =>
{
    var permission = permissions.FirstOrDefault(item =>
        item.operation == operation && item.adapter == request.Adapter && item.protocol == request.Protocol);
    if (permission is null || permission.state != "available")
    {
        return Results.Json(new
        {
            operation,
            adapter = request.Adapter,
            protocol = request.Protocol,
            state = permission?.state ?? "blocked",
            confirmationRequired = permission?.confirmationRequired ?? true,
            message = permission?.reason ?? "No existe permiso para esta operación, adaptador y protocolo.",
        }, statusCode: StatusCodes.Status403Forbidden);
    }

    return Results.Json(new
    {
        message = "La operación está permitida, pero debe usar su endpoint específico.",
    }, statusCode: StatusCodes.Status405MethodNotAllowed);
});

app.MapGet("/interfaces", () =>
{
    var providers = catalog.Discover();
    var usbCan = ucanCatalog.Discover();
    return Results.Ok(providers.Cast<object>().Concat(usbCan).ToArray());
});

app.MapPost("/interfaces/probe", (ProbeRequest request) =>
{
    if (!IsAvailable("probe_adapter", "GODIAG J2534"))
    {
        return Results.Forbid();
    }
    if (string.IsNullOrWhiteSpace(request.FunctionLibrary))
    {
        return Results.BadRequest(new { error = "Se requiere la ruta de la biblioteca J2534." });
    }

    var result = catalog.Probe(request.FunctionLibrary);
    return result.Success
        ? Results.Ok(result)
        : Results.Problem(result.Message, statusCode: 422);
});

app.MapPost("/interfaces/probe-serial", (SerialProbeRequest request) =>
{
    if (!IsAvailable("probe_adapter", "Adaptador serie / ELM327"))
    {
        return Results.Forbid();
    }
    var result = ucanCatalog.Probe(request.PortName);
    return result.Success
        ? Results.Ok(result)
        : Results.Problem(result.Message, statusCode: 422);
});

app.MapPost("/obd/read", (ObdReadRequest request) =>
{
    if (!IsAvailable("read_obd_pids", "ELM327") ||
        !IsAvailable("read_vin", "ELM327") ||
        !IsAvailable("read_dtcs", "ELM327"))
    {
        return Results.Forbid();
    }
    var result = obdCatalog.Read(request.PortName);
    return result.Success
        ? Results.Ok(result)
        : Results.Problem(result.Message, statusCode: 422);
});

app.MapPost("/obd/read-j2534", (J2534ObdReadRequest request) =>
{
    if (!IsAvailable("read_obd_pids", "GODIAG J2534"))
    {
        return Results.Forbid();
    }
    if (string.IsNullOrWhiteSpace(request.FunctionLibrary))
    {
        return Results.BadRequest(new { error = "Se requiere la ruta de la biblioteca J2534." });
    }

    var result = catalog.ReadObd(request.FunctionLibrary);
    foreach (var diagnosticEvent in result.DiagnosticEvents)
    {
        obdCatalog.RecordEvent(diagnosticEvent);
    }
    obdCatalog.RecordEvent(result.Message);
    foreach (var reading in result.Readings)
    {
        obdCatalog.RecordEvent($"J2534 {reading.Pid} · {reading.Label}: {reading.Value:0.##} {reading.Unit}".TrimEnd());
    }
    foreach (var code in result.CurrentDtcs) obdCatalog.RecordEvent($"Código actual: {code}");
    foreach (var code in result.PendingDtcs) obdCatalog.RecordEvent($"Código pendiente: {code}");
    foreach (var code in result.PermanentDtcs) obdCatalog.RecordEvent($"Código permanente: {code}");
    if (!result.CurrentDtcsAvailable) obdCatalog.RecordEvent("Modo 03: el vehículo no respondió.");
    if (!result.PendingDtcsAvailable) obdCatalog.RecordEvent("Modo 07: el vehículo no respondió.");
    if (!result.PermanentDtcsAvailable) obdCatalog.RecordEvent("Modo 0A: el vehículo no respondió.");
    if (!string.IsNullOrWhiteSpace(result.Vin)) obdCatalog.RecordEvent($"VIN leído: {result.Vin}");
    else if (result.TransportConnected) obdCatalog.RecordEvent("VIN: el vehículo no respondió al servicio OBD-II Mode 09.");
    else obdCatalog.RecordEvent("J2534: no se estableció el canal de comunicación con el adaptador.");
    if (result.MilOn is not null) obdCatalog.RecordEvent($"Testigo de avería: {(result.MilOn.Value ? "ENCENDIDO" : "APAGADO")}");
    return Results.Ok(result);
});

app.MapGet("/obd/events", () => Results.Ok(obdCatalog.Events));

app.Run();

public sealed record ProbeRequest(string FunctionLibrary);
public sealed record SerialProbeRequest(string PortName);
public sealed record ObdReadRequest(string PortName);
public sealed record J2534ObdReadRequest(string FunctionLibrary);
public sealed record OperationPermissionRequest(string Adapter, string Protocol);