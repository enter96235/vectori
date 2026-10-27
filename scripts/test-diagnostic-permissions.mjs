import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiEntry = path.join(repositoryRoot, "artifacts", "api-server", "dist", "index.mjs");
const webRoot = path.join(repositoryRoot, "artifacts", "audi-tt-diagnostic", "dist", "public");

const permissions = [
  { operation: "probe_adapter", adapter: "Adaptador serie / ELM327", protocol: "COM/Bluetooth serie y comandos AT", state: "available", reason: "Prueba serie simulada.", confirmationRequired: false },
  { operation: "probe_adapter", adapter: "GODIAG J2534", protocol: "SAE J2534 PassThruOpen/Close", state: "available", reason: "Prueba J2534 simulada.", confirmationRequired: false },
  { operation: "read_obd_pids", adapter: "ELM327", protocol: "OBD-II por puerto COM/Bluetooth serie", state: "available", reason: "Lectura ELM simulada.", confirmationRequired: false },
  { operation: "read_vin", adapter: "ELM327", protocol: "OBD-II Mode 09", state: "available", reason: "VIN simulado.", confirmationRequired: false },
  { operation: "read_dtcs", adapter: "ELM327", protocol: "OBD-II Mode 03/07/0A", state: "available", reason: "DTC simulados.", confirmationRequired: false },
  { operation: "read_obd_pids", adapter: "GODIAG J2534", protocol: "J2534 ISO 15765 / OBD-II Mode 01", state: "available", reason: "Lectura Mode 01 simulada.", confirmationRequired: false },
  { operation: "read_vin", adapter: "GODIAG J2534", protocol: "J2534 ISO 15765 / Mode 09", state: "available", reason: "VIN simulado.", confirmationRequired: false },
  { operation: "read_dtcs", adapter: "GODIAG J2534", protocol: "J2534 ISO 15765 / Mode 03/07/0A", state: "available", reason: "DTC J2534 simulados.", confirmationRequired: false },
  { operation: "scan_audi_modules", adapter: "GODIAG J2534", protocol: "Diagnóstico de módulos específico de marca", state: "pending", reason: "Direccionamiento específico de marca pendiente.", confirmationRequired: false },
  { operation: "clear_dtcs", adapter: "ELM327 / GODIAG J2534", protocol: "OBD-II Mode 04 / servicio específico", state: "blocked", reason: "Borrado no implementado.", confirmationRequired: true },
  { operation: "coding", adapter: "GODIAG J2534", protocol: "VAG UDS/KWP específico", state: "blocked", reason: "Codificación no implementada.", confirmationRequired: true },
  { operation: "adaptation", adapter: "GODIAG J2534", protocol: "VAG UDS/KWP específico", state: "blocked", reason: "Adaptaciones no implementadas.", confirmationRequired: true },
  { operation: "actuator_test", adapter: "GODIAG J2534", protocol: "VAG UDS/KWP específico", state: "blocked", reason: "Actuadores no implementados.", confirmationRequired: true },
  { operation: "ecu_programming", adapter: "GODIAG J2534", protocol: "Programación OEM específica", state: "blocked", reason: "Programación no implementada.", confirmationRequired: true },
];

function listenOnFreePort(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function allocatePort() {
  const server = net.createServer();
  const port = await listenOnFreePort(server);
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function makeBridge(architecture, calls) {
  return http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    const reply = (status, value) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };

    if (request.url === "/status") {
      return reply(200, { bridge: "available", adapter: "disconnected", vehicle: "unknown", profile: "Audi TT 8J", message: "Puente simulado.", permissions });
    }
    if (request.url === "/interfaces") {
      const interfaces = architecture === "x64"
        ? [
          { id: "ucan:COM3", name: "Dispositivo serie USB (COM3)", kind: "serial", connected: false, driver: "ELM327 serie", firmware: null, functionLibrary: null, architecture },
          { id: "GODIAG-X64", name: "GODIAG J2534 x64", kind: "j2534", connected: false, driver: "GODIAG", firmware: null, functionLibrary: "C:\\fake\\godiag-x64.dll", architecture },
        ]
        : [{ id: "GODIAG-X86", name: "GODIAG J2534 x86", kind: "j2534", connected: false, driver: "GODIAG", firmware: null, functionLibrary: "C:\\fake\\godiag-x86.dll", architecture }];
      return reply(200, interfaces);
    }
    if (request.url === "/obd/read" && request.method === "POST") {
      calls.elmRead += 1;
      return reply(200, { success: true, portName: body.portName, adapter: "ELM327 simulado", readings: [{ key: "rpm", label: "Revoluciones del motor", value: 900, unit: "rpm", pid: "010C", timestamp: new Date().toISOString() }], vin: "WAUZZZ8J0AA000000", milOn: false, currentDtcs: [], pendingDtcs: [], permanentDtcs: [], currentDtcsAvailable: true, pendingDtcsAvailable: true, permanentDtcsAvailable: true, message: "Lectura ELM simulada.", timestamp: new Date().toISOString() });
    }
    if (request.url === "/obd/read-j2534" && request.method === "POST") {
      calls.j2534Read[architecture] += 1;
      if (body.functionLibrary.includes("no-vin")) {
        return reply(200, { success: false, transportConnected: true, portName: body.functionLibrary, adapter: "J2534 simulado", readings: [], vin: null, milOn: null, currentDtcs: [], pendingDtcs: [], permanentDtcs: [], currentDtcsAvailable: false, pendingDtcsAvailable: false, permanentDtcsAvailable: false, message: "J2534 se conectó, pero el vehículo no respondió a las consultas OBD-II.", timestamp: new Date().toISOString() });
      }
      return reply(200, { success: true, transportConnected: true, portName: body.functionLibrary, adapter: "J2534 simulado", readings: [{ key: "rpm", label: "Revoluciones del motor", value: 900, unit: "rpm", pid: "010C", timestamp: new Date().toISOString() }], vin: "WDB1704471F000000", milOn: true, currentDtcs: ["P0300"], pendingDtcs: [], permanentDtcs: [], currentDtcsAvailable: true, pendingDtcsAvailable: true, permanentDtcsAvailable: true, message: "Lectura J2534 OBD-II simulada.", timestamp: new Date().toISOString() });
    }
    if (request.url === "/interfaces/probe-serial" || request.url === "/interfaces/probe") {
      return reply(200, { success: true, message: "Prueba simulada." });
    }
    if (request.url === "/obd/events") return reply(200, [`Registro simulado ${architecture}`]);
    return reply(404, { message: "Ruta simulada no encontrada." });
  });
}

const calls = { elmRead: 0, j2534Read: { x64: 0, x86: 0 } };
const x64Bridge = makeBridge("x64", calls);
const x86Bridge = makeBridge("x86", calls);
const bridgeX64Port = await listenOnFreePort(x64Bridge);
const bridgeX86Port = await listenOnFreePort(x86Bridge);
const apiPort = await allocatePort();
const api = spawn(process.execPath, [apiEntry], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(apiPort),
    NATIVE_BRIDGE_URL: `http://127.0.0.1:${bridgeX64Port}`,
    NATIVE_BRIDGE_X86_URL: `http://127.0.0.1:${bridgeX86Port}`,
    STATIC_ROOT: webRoot,
  },
  stdio: "ignore",
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/healthz`);
      ready = response.ok;
      if (ready) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, "API did not start");

  const statusResponse = await fetch(`http://127.0.0.1:${apiPort}/api/diagnostic/status`);
  const status = await statusResponse.json();
  assert.equal(statusResponse.status, 200);
  assert.equal("readOnly" in status, false, "global readOnly field must be absent");
  assert.ok(status.permissions.some((item) => item.operation === "read_obd_pids" && item.adapter === "ELM327" && item.state === "available"));
  assert.ok(status.permissions.some((item) => item.operation === "read_obd_pids" && item.adapter === "GODIAG J2534" && item.protocol.includes("ISO 15765") && item.state === "available"));
  assert.ok(status.permissions.some((item) => item.operation === "read_vin" && item.adapter === "GODIAG J2534" && item.state === "available"));
  assert.ok(status.permissions.some((item) => item.operation === "read_dtcs" && item.adapter === "GODIAG J2534" && item.state === "available"));

  const interfacesResponse = await fetch(`http://127.0.0.1:${apiPort}/api/diagnostic/interfaces`);
  const interfaces = await interfacesResponse.json();
  assert.equal(interfacesResponse.status, 200);
  assert.ok(interfaces.some((item) => item.id === "ucan:COM3"));
  assert.ok(interfaces.some((item) => item.kind === "j2534" && item.architecture === "x86"));
  assert.ok(interfaces.some((item) => item.kind === "j2534" && item.architecture === "x64"));

  const elmRead = await fetch(`http://127.0.0.1:${apiPort}/api/diagnostic/obd/read`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ portName: "COM3" }) });
  assert.equal(elmRead.status, 200);
  assert.equal(calls.elmRead, 1);

  const j2534Read = await fetch(`http://127.0.0.1:${apiPort}/api/diagnostic/obd/read-j2534`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ functionLibrary: "C:\\fake\\godiag.dll", architecture: "x86" }) });
  assert.equal(j2534Read.status, 200);
  assert.equal(calls.j2534Read.x86, 1, "J2534 request must route to x86 bridge");
  const j2534ReadBody = await j2534Read.json();
  assert.equal(j2534ReadBody.vin, "WDB1704471F000000");
  assert.equal(j2534ReadBody.transportConnected, true);
  assert.deepEqual(j2534ReadBody.currentDtcs, ["P0300"]);
  assert.equal(j2534ReadBody.currentDtcsAvailable, true);

  const j2534X64Read = await fetch(`http://127.0.0.1:${apiPort}/api/diagnostic/obd/read-j2534`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ functionLibrary: "C:\\fake\\godiag-x64.dll", architecture: "x64" }) });
  assert.equal(j2534X64Read.status, 200);
  assert.equal(calls.j2534Read.x64, 1, "J2534 request must route to x64 bridge");

  const j2534NoVin = await fetch(`http://127.0.0.1:${apiPort}/api/diagnostic/obd/read-j2534`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ functionLibrary: "C:\\fake\\godiag-no-vin.dll", architecture: "x86" }) });
  assert.equal(j2534NoVin.status, 200, "A connected J2534 vehicle without a Mode 09 response must preserve the diagnostic result");
  const j2534NoVinBody = await j2534NoVin.json();
  assert.equal(j2534NoVinBody.success, false);
  assert.equal(j2534NoVinBody.transportConnected, true);
  assert.equal(j2534NoVinBody.vin, null);

  const eventResponse = await fetch(`http://127.0.0.1:${apiPort}/api/diagnostic/events`);
  const events = await eventResponse.json();
  assert.ok(events.some((event) => event.includes("x86")), "J2534 x86 activity must be included in the event log");
  assert.ok(events.some((event) => event.includes("x64")), "J2534 x64 activity must be included in the event log");

  const blocked = await fetch(`http://127.0.0.1:${apiPort}/api/diagnostic/operations/clear_dtcs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "ELM327 / GODIAG J2534", protocol: "OBD-II Mode 04 / servicio específico" }) });
  assert.equal(blocked.status, 403);
  const blockedBody = await blocked.json();
  assert.equal(blockedBody.confirmationRequired, true);

  const pendingModules = await fetch(`http://127.0.0.1:${apiPort}/api/diagnostic/operations/scan_audi_modules`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "GODIAG J2534", protocol: "Diagnóstico de módulos específico de marca" }) });
  assert.equal(pendingModules.status, 403);
  const pendingJ2534Dtcs = await fetch(`http://127.0.0.1:${apiPort}/api/diagnostic/operations/read_dtcs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "GODIAG J2534", protocol: "J2534 ISO 15765 / Mode 03/07/0A" }) });
  assert.equal(pendingJ2534Dtcs.status, 405, "J2534 OBD-II DTC read permission is available");

  const nativeX64 = await verifyPublishedBridge("x64");
  const nativeX86 = await verifyPublishedBridge("x86");

  console.log(`Correcto: COM3 ELM y GODIAG x86/x64 simulados; lectura J2534 con VIN/DTC enrutada; bloqueos de escritura y módulos OEM confirmados; bridges nativos x64=${nativeX64}, x86=${nativeX86}.`);
} finally {
  api.kill();
  x64Bridge.close();
  x86Bridge.close();
}

async function verifyPublishedBridge(architecture) {
  const folder = architecture === "x86" ? "publish-x86" : "publish";
  const executable = path.join(repositoryRoot, "native", "j2534-bridge", folder, "audi-tt-j2534-bridge.exe");
  assert.equal(existsSync(executable), true, `Falta el bridge nativo ${architecture}`);
  const port = await allocatePort();
  const bridge = spawn(executable, [], { env: { ...process.env, J2534_BRIDGE_PORT: String(port) }, stdio: "ignore" });
  try {
    let status;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/status`);
        if (response.ok) {
          status = await response.json();
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(status, `El bridge nativo ${architecture} no inició`);
    assert.equal("readOnly" in status, false);
    assert.ok(status.permissions.some((item) => item.operation === "read_obd_pids" && item.adapter === "GODIAG J2534" && item.state === "available"));

    const clear = await fetch(`http://127.0.0.1:${port}/operations/clear_dtcs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "ELM327 / GODIAG J2534", protocol: "OBD-II Mode 04 / servicio específico" }) });
    assert.equal(clear.status, 403, `El bridge ${architecture} debe bloquear el borrado`);
    const moduleScan = await fetch(`http://127.0.0.1:${port}/operations/scan_audi_modules`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "GODIAG J2534", protocol: "Diagnóstico de módulos específico de marca" }) });
    assert.equal(moduleScan.status, 403, `El bridge ${architecture} debe bloquear el escaneo Audi pendiente`);
    const pendingDtcs = await fetch(`http://127.0.0.1:${port}/operations/read_dtcs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "GODIAG J2534", protocol: "J2534 ISO 15765 / Mode 03/07/0A" }) });
    assert.equal(pendingDtcs.status, 405, `El bridge ${architecture} debe declarar disponible la lectura J2534 de DTC`);
    return true;
  } finally {
    bridge.kill();
  }
}