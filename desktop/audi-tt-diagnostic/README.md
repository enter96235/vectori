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
vehículo, el protocolo soportado y el controlador del adaptador.

La pantalla del vehículo permite seleccionar perfiles de referencia para el
Audi TT Mk2 (8J) de 2007 y el Mercedes-Benz SLK 200 (R172) de 2012 o 2014.
El TT 8J se puede reconocer por el código de chasis del VIN; los perfiles
Mercedes son manuales y no se validan a partir del VIN. Para el Audi, la
aplicación muestra una lista documental de posibles unidades basada en la
[tabla de aplicaciones Ross-Tech](https://www.ross-tech.com/vag-com/cars/applications/ttr8.html);
los elementos opcionales dependen del equipamiento. Esa lista no constituye
un resultado del vehículo: la aplicación no consulta esas unidades mediante
J2534. Para el Mercedes R172 no se incluye un catálogo de unidades verificado.
Ambos perfiles siguen limitados a las consultas OBD-II genéricas implementadas.

El escaneo de unidades electrónicas específico de fabricante todavía no está
implementado. La documentación de Auto-Scan de [Ross-Tech](https://www.ross-tech.com/vcds/tour/autoscan.php)
explica que la detección depende del chasis y, en vehículos CAN compatibles,
de consultar el gateway; un listado de unidades candidatas no proporciona por
sí solo los identificadores de transporte J2534 para cada ECU. La aplicación
no explora identificadores CAN desconocidos ni sustituye un escáner OEM.

La marca se identifica mediante el fabricante (WMI) y el año mediante el
código de año modelo del VIN. El código de año puede repetirse en ciclos de 30
años, por lo que la fecha mostrada se calcula usando el ciclo más cercano al
año actual. La selección manual de un perfil sirve como referencia y no
confirma el motor, el equipamiento ni la presencia de módulos.
