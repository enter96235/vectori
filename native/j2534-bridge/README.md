# Puente J2534 nativo para Windows

Este es el componente local de hardware para Vector Diag. Admite proveedores
J2534 y adaptadores UCAN/CANable compatibles con firmware SLCAN. No incluye
un controlador del vehículo ni inventa una conexión.

## Build the Windows executable

Install the .NET 8 SDK on Windows, install the official driver for the real
J2534 interface, then publish both bridge architectures from this directory:

```powershell
dotnet publish .\J2534Bridge.csproj `
  -c Release `
  -r win-x64 `
  --self-contained true `
  /p:PublishSingleFile=true `
  /p:IncludeNativeLibrariesForSelfExtract=true `
  -o .\publish

dotnet publish .\J2534Bridge.csproj `
  -c Release `
  -r win-x86 `
  --self-contained true `
  /p:PublishSingleFile=true `
  /p:IncludeNativeLibrariesForSelfExtract=true `
  -o .\publish-x86
```

Each bridge discovers J2534 providers only from its matching Windows registry
view (`Registry64` for x64 and `Registry32` for x86). This prevents a provider
registered for one architecture from being offered to the other bridge. The
desktop app starts both published executables and routes each provider probe
and OBD request to the bridge matching its reported architecture.

Start the x64 bridge manually with:

```powershell
.\publish\audi-tt-j2534-bridge.exe
```

The bridge listens only on `127.0.0.1:27401`.

## Endpoints

```text
GET  /health
GET  /status
GET  /interfaces
POST /interfaces/probe
POST /interfaces/probe-serial
```

The probe request body is:

```json
{
  "functionLibrary": "C:\\Path\\to\\vendor-j2534.dll"
}
```

The serial probe request body is:

```json
{
  "portName": "COM5"
}
```

The serial probe opens the adapter at 115200 baud and sends the SLCAN `V`
identification command. It does not yet send Audi diagnostic requests or read
DTCs. The UCAN must be connected to the vehicle CANH/CANL/GND wiring; USB
detection alone does not confirm a vehicle session.

La apertura de un proveedor J2534 solo verifica el adaptador. El escaneo de
unidades electrónicas requiere protocolos y direccionamiento específicos de
cada fabricante, y aún no está implementado. Para OBD-II genérico, el puente
consulta PIDs Mode 01, VIN Mode 09 y códigos Mode 03/07/0A, usando el filtro
J2534 de control de flujo ISO 15765 para respuestas multitrama. La respuesta
real depende del proveedor J2534 y del soporte del vehículo.

La consulta de VIN intenta primero la dirección funcional OBD-II y, si no hay
respuesta, prueba las direcciones físicas CAN del motor 0x7E0 y 0x7E1. Se
instalan filtros de control de flujo específicos para las respuestas de
motor/transmisión 0x7E8 y 0x7E9. La actividad de ambos puentes (x86 y x64) se
recoge en el registro de sesión. Una conexión J2534 correcta no garantiza que el vehículo responda a
Mode 09; el registro distingue el canal conectado de un VIN sin respuesta.