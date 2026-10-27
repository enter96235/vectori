# Vector Diag para Windows

Esta aplicación de diagnóstico multimarca empaqueta la interfaz, el servidor
local y los puentes J2534 de 32 y 64 bits.

## Generar el instalador

Desde la raíz del repositorio, en PowerShell:

```powershell
$env:PORT = "4180"
$env:BASE_PATH = "/"
$env:NODE_ENV = "production"
pnpm --filter @workspace/audi-tt-diagnostic run build
pnpm --filter @workspace/api-server run build

dotnet publish .\native\j2534-bridge\J2534Bridge.csproj `
  -c Release `
  -r win-x64 `
  --self-contained true `
  /p:PublishSingleFile=true `
  /p:IncludeNativeLibrariesForSelfExtract=true `
  -o .\native\j2534-bridge\publish

dotnet publish .\native\j2534-bridge\J2534Bridge.csproj `
  -c Release `
  -r win-x86 `
  --self-contained true `
  /p:PublishSingleFile=true `
  /p:IncludeNativeLibrariesForSelfExtract=true `
  -o .\native\j2534-bridge\publish-x86

Set-Location .\desktop\audi-tt-diagnostic
npm run dist:win
```

El instalador se genera en `desktop/audi-tt-diagnostic/dist/`.

## Uso y alcance

1. Instale el controlador oficial del adaptador.
2. Conecte el adaptador al vehículo y ponga el contacto.
3. Seleccione el adaptador y pulse **Conectar y leer VIN**. La aplicación
   consulta el VIN al establecer la conexión.
4. Consulte **Vehículo** para ver la identificación obtenida del VIN y
   **Escanear** para leer los códigos de error.

La aplicación consulta datos OBD-II genéricos que el vehículo y el adaptador
respondan. ELM327 y J2534 implementan la consulta de parámetros del motor,
VIN y códigos actuales, pendientes y permanentes. La respuesta depende del
vehículo, el protocolo soportado y el controlador del adaptador. El escaneo de
unidades electrónicas específico de cada fabricante todavía no está
implementado; las consultas OBD-II no sustituyen un escáner OEM.

La marca se identifica mediante el fabricante (WMI) y el año mediante el
código de año modelo del VIN. El código de modelo es específico de cada
fabricante y no tiene una decodificación universal autónoma; por eso la
aplicación no inventa un modelo cuando no dispone de una base local validada.
El código de año puede repetirse en ciclos de 30 años, por lo que la fecha
mostrada se calcula usando el ciclo más cercano al año actual.
