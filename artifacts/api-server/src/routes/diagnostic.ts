import { Router, type IRouter, type Response } from "express";
import {
  GetDiagnosticStatusResponse,
  ListDiagnosticInterfacesResponse,
} from "@workspace/api-zod";
import { diagnosticBridge } from "../lib/diagnostic-bridge";
import { operationPermissions } from "../lib/diagnostic-bridge";

const router: IRouter = Router();

function requirePermission(operation: string, adapter: string, protocol: string, res: Response): boolean {
  const permission = operationPermissions.find((item) =>
    item.operation === operation && item.adapter === adapter && item.protocol === protocol,
  );
  if (permission?.state === "available") return true;
  res.status(403).json({
    message: permission?.reason || "Esta operación no está habilitada para el adaptador seleccionado.",
  });
  return false;
}

router.get("/diagnostic/status", async (req, res): Promise<void> => {
  req.log.debug("Reading diagnostic bridge status");
  const status = await diagnosticBridge.getStatus();
  res.json(GetDiagnosticStatusResponse.parse(status));
});

router.get(
  "/diagnostic/interfaces",
  async (req, res): Promise<void> => {
    req.log.debug("Listing detected diagnostic interfaces");
    const interfaces = await diagnosticBridge.listInterfaces();
    res.json(ListDiagnosticInterfacesResponse.parse(interfaces));
  },
);

router.post("/diagnostic/interfaces/probe-serial", async (req, res): Promise<void> => {
  if (!requirePermission("probe_adapter", "Adaptador serie / ELM327", "COM/Bluetooth serie y comandos AT", res)) return;
  const portName = typeof req.body?.portName === "string" ? req.body.portName : "";
  if (!portName) {
    res.status(400).json({ message: "Se requiere el nombre del puerto." });
    return;
  }
  const result = await diagnosticBridge.probeSerial(portName);
  res.json(result);
});

router.post("/diagnostic/interfaces/probe-j2534", async (req, res): Promise<void> => {
  if (!requirePermission("probe_adapter", "GODIAG J2534", "SAE J2534 PassThruOpen/Close", res)) return;
  const functionLibrary = typeof req.body?.functionLibrary === "string" ? req.body.functionLibrary : "";
  const architecture = req.body?.architecture === "x86" ? "x86" : "x64";
  if (!functionLibrary) {
    res.status(400).json({ message: "Se requiere la ruta de la biblioteca J2534." });
    return;
  }
  try {
    res.json(await diagnosticBridge.probeJ2534(functionLibrary, architecture));
  } catch (error) {
    res.status(422).json({ message: error instanceof Error ? error.message : "Falló la prueba J2534." });
  }
});

router.post("/diagnostic/obd/read", async (req, res): Promise<void> => {
    if (!requirePermission("read_obd_pids", "ELM327", "OBD-II por puerto COM/Bluetooth serie", res) ||
      !requirePermission("read_vin", "ELM327", "OBD-II Mode 09", res) ||
      !requirePermission("read_dtcs", "ELM327", "OBD-II Mode 03/07/0A", res)) return;
  const portName = typeof req.body?.portName === "string" ? req.body.portName : "";
  if (!portName) {
    res.status(400).json({ message: "Se requiere el nombre del puerto." });
    return;
  }
  try {
    res.json(await diagnosticBridge.readObd(portName));
  } catch (error) {
    res.status(422).json({
      message: error instanceof Error ? error.message : "Falló la lectura OBD-II.",
    });
  }
});

router.post("/diagnostic/obd/read-j2534", async (req, res): Promise<void> => {
  if (!requirePermission("read_obd_pids", "GODIAG J2534", "J2534 ISO 15765 / OBD-II Mode 01", res)) return;
  const functionLibrary = typeof req.body?.functionLibrary === "string" ? req.body.functionLibrary : "";
  const architecture = req.body?.architecture === "x86" ? "x86" : "x64";
  if (!functionLibrary) {
    res.status(400).json({ message: "Se requiere la ruta de la biblioteca J2534." });
    return;
  }
  try {
    res.json(await diagnosticBridge.readJ2534Obd(functionLibrary, architecture));
  } catch (error) {
    res.status(422).json({ message: error instanceof Error ? error.message : "Falló la lectura OBD-II mediante J2534." });
  }
});

router.get("/diagnostic/events", async (_req, res): Promise<void> => {
  try {
    res.json(await diagnosticBridge.getEvents());
  } catch {
    res.json([]);
  }
});

router.post("/diagnostic/operations/:operation", (req, res): void => {
  const adapter = typeof req.body?.adapter === "string" ? req.body.adapter : "";
  const protocol = typeof req.body?.protocol === "string" ? req.body.protocol : "";
  const permission = operationPermissions.find((item) =>
    item.operation === req.params.operation &&
    item.adapter === adapter &&
    item.protocol === protocol,
  );

  if (!permission || permission.state !== "available") {
    res.status(403).json({
      operation: req.params.operation,
      adapter,
      protocol,
      state: permission?.state ?? "blocked",
      confirmationRequired: permission?.confirmationRequired ?? true,
      message: permission?.reason ?? "No existe un permiso declarado para esta operación, adaptador y protocolo.",
    });
    return;
  }

  res.status(405).json({
    message: "La operación está permitida, pero debe ejecutarse mediante su endpoint específico.",
  });
});

export default router;