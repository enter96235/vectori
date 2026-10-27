export type DiagnosticBridgeStatus = {
  bridge: "available" | "unavailable";
  adapter: "connected" | "disconnected";
  vehicle: "connected" | "disconnected" | "unknown";
  profile: string;
  message: string;
  permissions: OperationPermission[];
};

export type OperationPermission = {
  operation: string;
  adapter: string;
  protocol: string;
  state: "available" | "pending" | "blocked";
  reason: string;
  confirmationRequired: boolean;
};

export const operationPermissions: OperationPermission[] = [
  { operation: "probe_adapter", adapter: "Adaptador serie / ELM327", protocol: "COM/Bluetooth serie y comandos AT", state: "available", reason: "Apertura del puerto e identificación AT implementadas.", confirmationRequired: false },
  { operation: "probe_adapter", adapter: "GODIAG J2534", protocol: "SAE J2534 PassThruOpen/Close", state: "available", reason: "Carga de DLL y apertura/cierre implementados en bridges x86/x64.", confirmationRequired: false },
  { operation: "read_obd_pids", adapter: "ELM327", protocol: "OBD-II por puerto COM/Bluetooth serie", state: "available", reason: "Lectura de PIDs Mode 01 implementada; los parámetros dependen del vehículo.", confirmationRequired: false },
  { operation: "read_vin", adapter: "ELM327", protocol: "OBD-II Mode 09", state: "available", reason: "Consulta VIN implementada; requiere soporte del adaptador y del vehículo.", confirmationRequired: false },
  { operation: "read_dtcs", adapter: "ELM327", protocol: "OBD-II Mode 03/07/0A", state: "available", reason: "Lectura genérica actual, pendiente y permanente implementada; cobertura limitada al tren motriz OBD-II.", confirmationRequired: false },
  { operation: "read_obd_pids", adapter: "GODIAG J2534", protocol: "J2534 ISO 15765 / OBD-II Mode 01", state: "available", reason: "Lectura de PIDs implementada; requiere DLL del fabricante con arquitectura compatible.", confirmationRequired: false },
  { operation: "read_vin", adapter: "GODIAG J2534", protocol: "J2534 ISO 15765 / Mode 09", state: "available", reason: "Consulta VIN por OBD-II Mode 09; depende del soporte del vehículo y del proveedor J2534.", confirmationRequired: false },
  { operation: "read_dtcs", adapter: "GODIAG J2534", protocol: "J2534 ISO 15765 / Mode 03/07/0A", state: "available", reason: "Consulta códigos OBD-II del motor; requiere respuesta compatible del vehículo y del adaptador.", confirmationRequired: false },
  { operation: "scan_audi_modules", adapter: "GODIAG J2534", protocol: "Diagnóstico de módulos específico de marca", state: "pending", reason: "El escaneo de módulos OEM específicos de marca no está implementado ni validado.", confirmationRequired: false },
  { operation: "clear_dtcs", adapter: "ELM327 / GODIAG J2534", protocol: "OBD-II Mode 04 / servicio específico", state: "blocked", reason: "Borrado no implementado. Requiere control individual y confirmación explícita antes de habilitarse.", confirmationRequired: true },
  { operation: "coding", adapter: "GODIAG J2534", protocol: "Diagnóstico específico de marca", state: "blocked", reason: "La codificación no está implementada ni validada.", confirmationRequired: true },
  { operation: "adaptation", adapter: "GODIAG J2534", protocol: "Diagnóstico específico de marca", state: "blocked", reason: "Las adaptaciones no están implementadas ni validadas.", confirmationRequired: true },
  { operation: "actuator_test", adapter: "GODIAG J2534", protocol: "Diagnóstico específico de marca", state: "blocked", reason: "Las pruebas de actuadores no están implementadas ni validadas.", confirmationRequired: true },
  { operation: "ecu_programming", adapter: "GODIAG J2534", protocol: "Programación OEM específica", state: "blocked", reason: "Programación de ECUs bloqueada; no está implementada ni validada.", confirmationRequired: true },
];

export type DiagnosticInterface = {
  id: string;
  name: string;
  kind: "j2534" | "usb-can" | "k-line" | "serial" | "bluetooth" | "unknown";
  connected: boolean;
  driver: string | null;
  firmware: string | null;
  functionLibrary?: string | null;
  architecture: "x86" | "x64";
};

type ObdSnapshot = {
  success: boolean;
  portName: string;
  adapter: string | null;
  transportConnected: boolean;
  readings: Array<{ key: string; label: string; value: number; unit: string; pid: string; timestamp: string }>;
  vin: string | null;
  milOn: boolean | null;
  currentDtcs: string[];
  pendingDtcs: string[];
  permanentDtcs: string[];
  currentDtcsAvailable?: boolean;
  pendingDtcsAvailable?: boolean;
  permanentDtcsAvailable?: boolean;
  message: string;
  timestamp: string;
};

export interface DiagnosticBridge {
  getStatus(): Promise<DiagnosticBridgeStatus>;
  listInterfaces(): Promise<DiagnosticInterface[]>;
  probeJ2534(functionLibrary: string, architecture?: "x86" | "x64"): Promise<{ success: boolean; functionLibrary: string; deviceId: number | null; message: string }>;
  probeSerial(portName: string): Promise<{ success: boolean; portName: string; firmware: string | null; message: string }>;
  readObd(portName: string): Promise<ObdSnapshot>;
  readJ2534Obd(functionLibrary: string, architecture?: "x86" | "x64"): Promise<ObdSnapshot>;
  getEvents(): Promise<string[]>;
}

/**
 * La vista web no puede acceder a una DLL J2534 de Windows ni a un controlador USB-CAN.
 * Se informa la ausencia del puente sin inventar adaptadores, conexiones, módulos o mediciones.
 */
class UnavailableDiagnosticBridge implements DiagnosticBridge {
  async getStatus(): Promise<DiagnosticBridgeStatus> {
    return {
      bridge: "unavailable",
      adapter: "disconnected",
      vehicle: "disconnected",
      profile: "Vehículo no identificado",
      message:
        "No hay un puente de diagnóstico nativo disponible. No se han leído datos del vehículo.",
      permissions: operationPermissions,
    };
  }

  async listInterfaces(): Promise<DiagnosticInterface[]> {
    return [];
  }

  async probeSerial(portName: string) {
    return { success: false, portName, firmware: null, message: "No hay un puente nativo disponible." };
  }

  async probeJ2534(functionLibrary: string) {
    return { success: false, functionLibrary, deviceId: null, message: "No hay un puente de diagnóstico disponible." };
  }

  async readObd(portName: string) {
    return { success: false, portName, adapter: null, transportConnected: false, readings: [], vin: null, milOn: null, currentDtcs: [], pendingDtcs: [], permanentDtcs: [], message: "No hay un puente nativo disponible.", timestamp: new Date().toISOString() };
  }

  async readJ2534Obd(functionLibrary: string) {
    return { success: false, portName: functionLibrary, adapter: null, transportConnected: false, readings: [], vin: null, milOn: null, currentDtcs: [], pendingDtcs: [], permanentDtcs: [], message: "No hay un puente nativo disponible.", timestamp: new Date().toISOString() };
  }

  async getEvents() {
    return [];
  }
}

class HttpDiagnosticBridge implements DiagnosticBridge {
  private readonly baseUrl: string;
  private readonly x86BaseUrl: string;

  constructor(baseUrl: string, x86BaseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.x86BaseUrl = x86BaseUrl.replace(/\/+$/, "");
  }

  async getStatus(): Promise<DiagnosticBridgeStatus> {
    const response = await fetch(`${this.baseUrl}/status`);
    if (!response.ok) {
      throw new Error(`El puente de diagnóstico respondió con HTTP ${response.status}.`);
    }

    return (await response.json()) as DiagnosticBridgeStatus;
  }

  async listInterfaces(): Promise<DiagnosticInterface[]> {
    const [x64Response, x86Response] = await Promise.all([
      fetch(`${this.baseUrl}/interfaces`),
      this.x86BaseUrl === this.baseUrl ? Promise.resolve(null) : fetch(`${this.x86BaseUrl}/interfaces`).catch(() => null),
    ]);
    if (!x64Response.ok) {
      throw new Error(`El puente de diagnóstico respondió con HTTP ${x64Response.status}.`);
    }
    const x64Interfaces = await x64Response.json() as DiagnosticInterface[];
    const x86Interfaces = x86Response?.ok ? await x86Response.json() as DiagnosticInterface[] : [];
    return [
      ...x64Interfaces.map((item) => ({ ...item, architecture: "x64" as const })),
      ...x86Interfaces.filter((item) => item.kind === "j2534").map((item) => ({ ...item, id: `${item.id}:x86`, architecture: "x86" as const })),
    ];
  }

  async probeSerial(portName: string) {
    const response = await fetch(`${this.baseUrl}/interfaces/probe-serial`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ portName }),
    });
    const result = (await response.json()) as { success?: boolean; portName?: string; firmware?: string | null; message?: string; detail?: string };
    if (!response.ok) {
      throw new Error(result.message || result.detail || `El puente de diagnóstico respondió con HTTP ${response.status}.`);
    }
    return {
      success: result.success === true,
      portName: result.portName || portName,
      firmware: result.firmware || null,
      message: result.message || "Prueba del adaptador serie completada.",
    };
  }

  async probeJ2534(functionLibrary: string, architecture: "x86" | "x64" = "x64") {
    const baseUrl = architecture === "x86" ? this.x86BaseUrl : this.baseUrl;
    const response = await fetch(`${baseUrl}/interfaces/probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ functionLibrary }),
    });
    const result = await response.json() as { success?: boolean; functionLibrary?: string; deviceId?: number | null; message?: string; detail?: string };
    return {
      success: response.ok && result.success === true,
      functionLibrary: result.functionLibrary || functionLibrary,
      deviceId: result.deviceId ?? null,
      message: result.message || result.detail || (response.ok ? "El proveedor J2534 se abrió correctamente." : "No se pudo abrir el proveedor J2534."),
    };
  }

  async readObd(portName: string) {
    const response = await fetch(`${this.baseUrl}/obd/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ portName }),
    });
    const result = await response.json() as Partial<ObdSnapshot> & { detail?: string };
    if (!response.ok) {
      throw new Error(result.message || result.detail || `El puente de diagnóstico respondió con HTTP ${response.status}.`);
    }
    return {
      success: result.success === true,
      portName: result.portName || portName,
      adapter: result.adapter || null,
      transportConnected: result.transportConnected === true,
      readings: result.readings || [],
      vin: result.vin || null,
      milOn: result.milOn ?? null,
      currentDtcs: result.currentDtcs || [],
      pendingDtcs: result.pendingDtcs || [],
      permanentDtcs: result.permanentDtcs || [],
      currentDtcsAvailable: result.currentDtcsAvailable === true,
      pendingDtcsAvailable: result.pendingDtcsAvailable === true,
      permanentDtcsAvailable: result.permanentDtcsAvailable === true,
      message: result.message || "Lectura OBD-II completada.",
      timestamp: result.timestamp || new Date().toISOString(),
    };
  }

  async readJ2534Obd(functionLibrary: string, architecture: "x86" | "x64" = "x64") {
    const baseUrl = architecture === "x86" ? this.x86BaseUrl : this.baseUrl;
    const response = await fetch(`${baseUrl}/obd/read-j2534`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ functionLibrary }),
    });
    const result = await response.json() as Partial<ObdSnapshot> & { detail?: string };
    if (!response.ok) {
      throw new Error(result.message || result.detail || `El puente de diagnóstico respondió con HTTP ${response.status}.`);
    }
    return {
      success: result.success === true,
      portName: result.portName || functionLibrary,
      adapter: result.adapter || "J2534 ISO 15765",
      transportConnected: result.transportConnected === true,
      readings: result.readings || [],
      vin: result.vin || null,
      milOn: result.milOn ?? null,
      currentDtcs: result.currentDtcs || [],
      pendingDtcs: result.pendingDtcs || [],
      permanentDtcs: result.permanentDtcs || [],
      currentDtcsAvailable: result.currentDtcsAvailable === true,
      pendingDtcsAvailable: result.pendingDtcsAvailable === true,
      permanentDtcsAvailable: result.permanentDtcsAvailable === true,
      message: result.message || "Lectura OBD-II mediante J2534 completada.",
      timestamp: result.timestamp || new Date().toISOString(),
    };
  }

  async getEvents() {
    const responses = await Promise.all([
      fetch(`${this.baseUrl}/obd/events`).catch(() => null),
      this.x86BaseUrl === this.baseUrl
        ? Promise.resolve(null)
        : fetch(`${this.x86BaseUrl}/obd/events`).catch(() => null),
    ]);
    const availableResponses = responses.filter(
      (response): response is Response => response !== null && response.ok,
    );
    if (availableResponses.length === 0) {
      throw new Error("No se pudo consultar el registro de actividades de los puentes J2534.");
    }
    const eventLists = await Promise.all(
      availableResponses.map((response) => response.json() as Promise<string[]>),
    );
    return [...new Set(eventLists.flat())];
  }
}

export const diagnosticBridge: DiagnosticBridge =
  process.env.NATIVE_BRIDGE_URL
    ? new HttpDiagnosticBridge(
        process.env.NATIVE_BRIDGE_URL,
        process.env.NATIVE_BRIDGE_X86_URL || process.env.NATIVE_BRIDGE_URL,
      )
    : new UnavailableDiagnosticBridge();