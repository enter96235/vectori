import { type ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  CarFront,
  ChevronRight,
  FileWarning,
  LayoutDashboard,
  Menu,
  PlugZap,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import {
  getListDiagnosticInterfacesQueryKey,
  useListDiagnosticInterfaces,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

type NavItem = {
  label: string;
  detail: string;
  icon: typeof LayoutDashboard;
  target: string;
};

type InterfaceItem = {
  id: string;
  name: string;
  kind: string;
  connected: boolean;
  driver: string | null;
  firmware: string | null;
  functionLibrary?: string | null;
  architecture: 'x86' | 'x64';
};

const navItems: NavItem[] = [
  { label: 'Conexión', detail: 'Adaptador y estado', icon: LayoutDashboard, target: 'connection' },
  { label: 'Vehículo', detail: 'Identificación por VIN', icon: CarFront, target: 'vehicle' },
  { label: 'Escanear', detail: 'Lectura de Códigos de Error', icon: FileWarning, target: 'scan' },
  { label: 'Registro', detail: 'Log de actividades', icon: Terminal, target: 'logs' },
];

function Header({ onRefresh, isRefreshing, onMenu }: { onRefresh: () => void; isRefreshing: boolean; onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#0b151e]/95 backdrop-blur-md">
      <div className="flex h-[68px] items-center justify-between gap-4 px-4 sm:px-7">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onMenu}
            className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 lg:hidden"
            aria-label="Abrir navegación"
            data-testid="button-open-navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-cyan-400/35 bg-cyan-400/10 text-cyan-300">
            <ScanLine className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-extrabold tracking-[0.16em] text-slate-100">VECTOR / DIAG</p>
            <p className="mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Diagnóstico multimarca</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="group inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/50 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200 disabled:cursor-wait disabled:opacity-60"
            aria-label="Actualizar interfaces de diagnóstico"
            data-testid="button-refresh-diagnostics"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : 'group-hover:rotate-45'}`} />
            <span className="hidden sm:inline">Actualizar interfaces</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function Sidebar({ active, onNavigate, open, onClose }: { active: string; onNavigate: (target: string) => void; open: boolean; onClose: () => void }) {
  return (
    <>
      {open && <button className="fixed inset-0 z-40 bg-slate-950/70 lg:hidden" onClick={onClose} aria-label="Cerrar navegación" data-testid="button-close-navigation" />}
      <aside className={`fixed bottom-0 left-0 top-[68px] z-50 w-[274px] border-r border-slate-800/90 bg-[#09131d] transition-transform duration-200 lg:sticky lg:top-[68px] lg:z-10 lg:block lg:h-[calc(100dvh-68px)] lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-full flex-col p-4">
          <div className="mb-5 flex items-center justify-between px-2">
            <span className="mono text-[10px] uppercase tracking-[0.2em] text-slate-500">Diagnóstico</span>
            <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:text-slate-200 lg:hidden" aria-label="Cerrar navegación" data-testid="button-sidebar-close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <nav className="space-y-1" aria-label="Secciones de diagnóstico">
            {navItems.map((item) => {
              const Icon = item.icon;
              const selected = active === item.target;
              return (
                <button
                  type="button"
                  key={item.target}
                  onClick={() => onNavigate(item.target)}
                  className={`group flex w-full items-center gap-3 rounded-md border px-3 py-3 text-left ${selected ? 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200' : 'border-transparent text-slate-400 hover:border-slate-700 hover:bg-slate-800/60 hover:text-slate-200'}`}
                  data-testid={`button-nav-${item.target}`}
                  aria-current={selected ? 'page' : undefined}
                >
                  <Icon className={`h-[17px] w-[17px] shrink-0 ${selected ? 'text-cyan-300' : 'text-slate-500'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold">{item.label}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-slate-500">{item.detail}</span>
                  </span>
                  {selected && <ChevronRight className="h-3.5 w-3.5 text-cyan-400" />}
                </button>
              );
            })}
          </nav>
          <div className="mt-auto border-t border-slate-800/80 pt-4">
            <div className="rounded-md border border-cyan-400/15 bg-cyan-400/[0.045] p-3">
              <div className="mb-2 flex items-center gap-2 text-cyan-300">
                <ShieldCheck className="h-4 w-4" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Solo lectura</span>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">La sesión consulta datos OBD-II; no modifica el vehículo.</p>
            </div>
            <div className="mt-4 flex items-center justify-between px-2 text-[10px] text-slate-600">
              <span className="mono">VECTOR DIAG</span>
              <span>OBD-II</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function ConnectionHero() {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-100">Conexión</h1>
      <p className="mt-2 text-sm text-slate-400">Conecte el adaptador para leer el VIN del vehículo.</p>
    </div>
  );
}

const vehicleMakes = [
  'Audi',
  'BMW',
  'Chevrolet',
  'Ford',
  'Honda',
  'Hyundai',
  'Kia',
  'Mazda',
  'Mercedes-Benz',
  'Nissan',
  'Peugeot',
  'Renault',
  'Subaru',
  'Toyota',
  'Volkswagen',
  'Volvo',
  'Otra marca',
];

function ProfileCard({
  vin,
  diagnosis,
}: {
  vin: string | null;
  diagnosis: string;
}) {
  const vehicle = vin ? decodeVin(vin) : null;
  return (
    <section className="rise-in rounded-lg border border-slate-800 bg-[#0e1a25] p-5 sm:p-6" data-testid="card-vehicle-profile">
      <div className="mb-5 flex items-center gap-2 text-cyan-300"><CarFront className="h-4 w-4" /><span className="mono text-[10px] uppercase tracking-[0.16em]">Identificación del vehículo</span></div>
      {vehicle ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <VehicleField label="Marca" value={vehicle.make || 'No identificada'} />
            <VehicleField label="Modelo" value="Sin decodificador local" />
            <VehicleField label="Año modelo" value={vehicle.year || 'No identificado'} />
          </div>
          <div className="mt-4 rounded border border-slate-800 bg-slate-950/25 p-3">
            <p className="mono text-[9px] uppercase tracking-wider text-slate-500">VIN leído del vehículo</p>
            <p className="mono mt-2 break-all text-sm text-slate-100">{vin}</p>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">La marca y el año se decodifican del VIN. El código de modelo depende del fabricante y no tiene una decodificación universal; no se muestra un modelo sin una fuente local validada. El código de año puede repetirse cada 30 años.</p>
        </>
      ) : (
        <p className={`rounded border border-dashed border-slate-700 px-4 py-6 text-center text-sm ${diagnosis === 'No se puede conectar' || diagnosis === 'No se puede extraer VIN' ? 'text-red-200' : 'text-slate-400'}`}>{diagnosis}</p>
      )}
    </section>
  );
}

function VehicleField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-950/25 p-3">
      <span className="mono block text-[9px] uppercase tracking-wider text-slate-500">{label}</span>
      <span className="mt-2 block text-sm font-semibold text-slate-100">{value}</span>
    </div>
  );
}

function AdapterSelectorCard({ interfaces, selectedId, onSelect, onConnect, testing, connectionState }: { interfaces?: InterfaceItem[]; selectedId?: string; onSelect: (id: string) => void; onConnect: () => void; testing: boolean; connectionState: { success: boolean; message: string } | null }) {
  const available = interfaces ?? [];
  const selected = available.find((item) => item.id === selectedId) ?? available[0];

  return (
    <section className="rise-in-delay rounded-lg border border-slate-800 bg-[#0e1a25] p-5 sm:p-6" data-testid="card-adapter-selector">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-cyan-300"><PlugZap className="h-4 w-4" /><span className="mono text-[10px] uppercase tracking-[0.16em]">Selección de adaptador</span></div>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-100">Adaptador de diagnóstico</h2>
        </div>
        <span className="mono rounded border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] uppercase text-cyan-300">WINDOWS</span>
      </div>

      <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
        <div>
          <label htmlFor="adapter-select" className="mb-2 block text-[10px] uppercase tracking-[0.16em] text-slate-500">Adaptador seleccionado</label>
          <select
            id="adapter-select"
            value={selected?.id ?? ''}
            onChange={(event) => onSelect(event.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none ring-0 transition focus:border-cyan-400/50"
          >
            {!selected && <option value="">No se detectaron interfaces</option>}
            {available.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {{ bluetooth: 'Bluetooth', 'usb-can': 'USB-CAN', serial: 'Serie', j2534: 'J2534', 'k-line': 'K-Line', unknown: 'Desconocido' }[item.kind] || 'Desconocido'}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end">
          <button
            type="button"
            onClick={onConnect}
            disabled={!selected || testing}
            className="w-full rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 py-2.5 text-xs font-bold text-cyan-200 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {testing ? 'Conectando y leyendo VIN...' : 'Conectar y leer VIN'}
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-slate-800 bg-slate-950/20 p-3">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-slate-500">
          <span>Dispositivo seleccionado</span>
          <span className={connectionState?.success ? 'text-emerald-300' : connectionState || !selected ? 'text-red-300' : 'text-slate-400'}>{connectionState?.success ? 'Conectado' : connectionState ? 'Desconectado' : !selected ? 'No se puede conectar' : 'Sin probar'}</span>
        </div>
        <p className="mt-2 truncate text-sm font-semibold text-slate-100">{selected?.name ?? 'Ningún dispositivo seleccionado'}</p>
        {connectionState && <p className={`mt-2 text-xs ${connectionState.success ? 'text-emerald-200' : 'text-red-200'}`} role="status">{connectionState.message}</p>}
          {!connectionState && selected && <p className="mt-1 text-[11px] text-slate-500">{selected.id}</p>}
      </div>
    </section>
  );
}

type ObdReading = { key: string; label: string; value: number; unit: string; pid: string; timestamp: string };
type ObdScanResult = {
  adapterKind: string;
  success: boolean;
  transportConnected: boolean;
  readings: ObdReading[];
  vin: string | null;
  milOn: boolean | null;
  currentDtcs: string[];
  pendingDtcs: string[];
  permanentDtcs: string[];
  currentDtcsAvailable: boolean;
  pendingDtcsAvailable: boolean;
  permanentDtcsAvailable: boolean;
  timestamp: string;
};

function makeFromVin(vin: string): string | null {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) return null;
  const wmi = vin.slice(0, 3).toUpperCase();
  const makesByWmi: Record<string, string> = {
    '1FA': 'Ford',
    '1FB': 'Ford',
    '1FC': 'Ford',
    '1FD': 'Ford',
    '1G1': 'Chevrolet',
    '1HG': 'Honda',
    '1N4': 'Nissan',
    '2HG': 'Honda',
    '3FA': 'Ford',
    '3VW': 'Volkswagen',
    '4T1': 'Toyota',
    '5NP': 'Hyundai',
    '5XY': 'Kia',
    'JH4': 'Honda',
    'JHM': 'Honda',
    'JM1': 'Mazda',
    'JN1': 'Nissan',
    'JTE': 'Toyota',
    'JTD': 'Toyota',
    'KMH': 'Hyundai',
    'KNA': 'Kia',
    'TRU': 'Audi',
    'VF1': 'Renault',
    'VF3': 'Peugeot',
    'VF7': 'Citroën',
    'WBA': 'BMW',
    'WBS': 'BMW',
    'WDB': 'Mercedes-Benz',
    'WDD': 'Mercedes-Benz',
    'WDC': 'Mercedes-Benz',
    'WVW': 'Volkswagen',
    'W0L': 'Opel',
    'WAU': 'Audi',
    'WP0': 'Porsche',
    'W1K': 'Mercedes-Benz',
    'W1N': 'Mercedes-Benz',
    'YV1': 'Volvo',
    'ZFA': 'Fiat',
  };
  return makesByWmi[wmi] ?? null;
}

function decodeVin(vin: string): { make: string | null; year: string | null } {
  const make = makeFromVin(vin);
  const yearCode = vin[9]?.toUpperCase();
  const yearCodes = 'ABCDEFGHJKLMNPRSTVWXY123456789';
  const yearIndex = yearCodes.indexOf(yearCode || '');
  if (yearIndex < 0) return { make, year: null };

  const baseYear = 1980 + yearIndex;
  const currentYear = new Date().getFullYear();
  const candidates = [baseYear - 30, baseYear, baseYear + 30, baseYear + 60]
    .filter((year) => year <= currentYear + 1);
  const year = candidates.reduce((closest, candidate) =>
    Math.abs(candidate - currentYear) < Math.abs(closest - currentYear) ? candidate : closest,
  );
  return { make, year: String(year) };
}

function FaultMemoryCard({ scan, loading, onScan }: { scan: ObdScanResult | null; loading: boolean; onScan: () => void }) {
  const groups = [
    { label: 'Actuales', codes: scan?.currentDtcs ?? [], available: scan?.currentDtcsAvailable ?? false },
    { label: 'Pendientes', codes: scan?.pendingDtcs ?? [], available: scan?.pendingDtcsAvailable ?? false },
    { label: 'Permanentes', codes: scan?.permanentDtcs ?? [], available: scan?.permanentDtcsAvailable ?? false },
  ];
  return <section className="rounded-lg border border-amber-400/15 bg-[#0e1a25] p-5 sm:p-6" data-testid="card-fault-memory"><div className="mb-4 flex items-center gap-2 text-amber-300"><FileWarning className="h-4 w-4" /><span className="mono text-[10px] uppercase tracking-[0.16em]">Lectura de Códigos de Error</span></div><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-extrabold tracking-tight text-slate-100">Códigos OBD-II</h2><button type="button" onClick={onScan} disabled={loading} className="inline-flex shrink-0 items-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-400/15 disabled:cursor-wait disabled:opacity-60"><ScanLine className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />{loading ? 'Leyendo...' : 'Leer códigos'}</button></div>{scan ? <div className="mt-4 grid gap-3 sm:grid-cols-3">{groups.map((group) => <div key={group.label} className="rounded border border-slate-800 bg-slate-950/25 p-3"><div className="flex justify-between text-[10px] uppercase tracking-wider text-slate-500"><span>{group.label}</span><span>{group.available ? group.codes.length : '—'}</span></div>{!group.available ? <p className="mt-2 text-xs text-slate-500">Sin respuesta</p> : group.codes.length ? <ul className="mt-2 space-y-1">{group.codes.map((code) => <li key={code} className="mono text-sm font-bold text-amber-200">{code}</li>)}</ul> : <p className="mt-2 text-xs text-slate-500">Sin códigos</p>}</div>)}</div> : <p className="mt-3 text-xs text-slate-500">Conecte el adaptador para consultar los códigos disponibles.</p>}<p className="mt-3 text-[10px] text-slate-600">Lectura genérica del motor; no incluye el escaneo de todas las unidades electrónicas.</p></section>;
}

function EventLog({ events, error }: { events: string[]; error: string | null }) {
  return <section id="logs" className="rounded-lg border border-slate-800 bg-[#0e1a25] p-5 sm:p-6" data-testid="card-event-log"><div className="mb-4 flex items-center justify-between"><div><div className="mb-2 flex items-center gap-2 text-cyan-300"><Terminal className="h-4 w-4" /><span className="mono text-[10px] uppercase tracking-[0.16em]">Log de actividades</span></div><h2 className="text-xl font-extrabold tracking-tight text-slate-100">Actividad del adaptador</h2></div><span className="mono text-[10px] text-slate-600">{events.length} EVENTOS</span></div>{error ? <p className="rounded border border-red-400/20 bg-red-400/5 px-3 py-4 text-center text-xs text-red-200">{error}</p> : events.length ? <div className="max-h-[65vh] overflow-auto rounded border border-slate-800 bg-slate-950/30 p-3">{events.slice().reverse().map((event, index) => <p key={`${event}-${index}`} className="mono border-b border-slate-800/70 py-1.5 text-[10px] text-slate-400 last:border-0">{event}</p>)}</div> : <p className="rounded border border-dashed border-slate-700/80 px-3 py-5 text-center text-xs text-slate-500">Todavía no hay actividades registradas.</p>}</section>;
}

function Home() {
  const [active, setActive] = useState('connection');
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState('');
  const [connectionState, setConnectionState] = useState<{ success: boolean; message: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [obdScan, setObdScan] = useState<ObdScanResult | null>(null);
  const [obdLoading, setObdLoading] = useState(false);
  const [obdMessage, setObdMessage] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const interfacesQuery = useListDiagnosticInterfaces({ query: { queryKey: getListDiagnosticInterfacesQueryKey() } });
  const interfaces = Array.isArray(interfacesQuery.data) ? interfacesQuery.data : [];

  useEffect(() => {
    if (!selectedInterfaceId && interfaces.length > 0) {
      setSelectedInterfaceId(interfaces[0].id);
    } else if (selectedInterfaceId && !interfaces.some((item) => item.id === selectedInterfaceId)) {
      setSelectedInterfaceId(interfaces[0]?.id ?? '');
      setConnectionState(null);
      setObdScan(null);
    }
  }, [interfaces, selectedInterfaceId]);

  const refreshEvents = async () => {
    try {
      const response = await fetch('/api/diagnostic/events');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setEvents(await response.json() as string[]);
      setEventsError(null);
    } catch {
      setEventsError('No se pudo cargar el registro de actividades.');
    }
  };

  useEffect(() => {
    void refreshEvents();
  }, []);

  const refreshAll = () => {
    void interfacesQuery.refetch();
    void refreshEvents();
  };

  const readObd = async (target?: InterfaceItem): Promise<ObdScanResult | null> => {
    const selected = target ?? interfaces.find((item) => item.id === selectedInterfaceId);
    if (!selected) {
      setObdMessage('No se puede conectar');
      return null;
    }
    setObdLoading(true);
    try {
      const isJ2534 = selected.kind === 'j2534';
      const url = isJ2534 ? '/api/diagnostic/obd/read-j2534' : '/api/diagnostic/obd/read';
      const requestBody = isJ2534
        ? { functionLibrary: selected.functionLibrary, architecture: selected.architecture }
        : { portName: selected.id.replace(/^ucan:/i, '').replace(/^bt:/i, '') };
      if (isJ2534 && !selected.functionLibrary) {
        setObdMessage('No se puede conectar');
        return null;
      }
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody) });
      const result = await response.json() as Partial<ObdScanResult> & { message?: string; detail?: string };
      if (!response.ok) {
        setObdScan(null);
        setObdMessage(result.message || result.detail || 'No se puede extraer VIN');
        return null;
      }
      const scan: ObdScanResult = {
        adapterKind: selected.kind,
        success: result.success === true,
        transportConnected: result.transportConnected === true,
        readings: result.readings || [],
        vin: result.vin && /^[A-HJ-NPR-Z0-9]{17}$/i.test(result.vin) ? result.vin.toUpperCase() : null,
        milOn: result.milOn ?? null,
        currentDtcs: result.currentDtcs || [],
        pendingDtcs: result.pendingDtcs || [],
        permanentDtcs: result.permanentDtcs || [],
        currentDtcsAvailable: result.currentDtcsAvailable === true,
        pendingDtcsAvailable: result.pendingDtcsAvailable === true,
        permanentDtcsAvailable: result.permanentDtcsAvailable === true,
        timestamp: result.timestamp || new Date().toISOString(),
      };
      setObdScan(scan);
      setObdMessage(scan.vin ? 'VIN leído correctamente.' : scan.transportConnected ? 'No se puede extraer VIN' : 'No se puede conectar');
      return scan;
    } catch {
      setObdMessage('No se puede extraer VIN');
      return null;
    } finally {
      setObdLoading(false);
      void refreshEvents();
    }
  };

  const connectAdapter = async () => {
    const target = interfaces.find((item) => item.id === selectedInterfaceId);
    if (!target) {
      setConnectionState({ success: false, message: 'No se puede conectar' });
      return;
    }

    setConnecting(true);
    setConnectionState(null);
    setObdScan(null);
    try {
      const isJ2534 = target.kind === 'j2534';
      const requestUrl = isJ2534
        ? '/api/diagnostic/interfaces/probe-j2534'
        : '/api/diagnostic/interfaces/probe-serial';
      const requestBody = isJ2534
        ? { functionLibrary: target.functionLibrary, architecture: target.architecture }
        : { portName: target.id.replace(/^ucan:/i, '').replace(/^bt:/i, '') };
      if (isJ2534 && !target.functionLibrary) {
        setConnectionState({ success: false, message: 'No se puede conectar' });
        return;
      }
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const result = await response.json() as { success?: boolean };
      if (!response.ok || result.success !== true) {
        setConnectionState({ success: false, message: 'No se puede conectar' });
        await refreshEvents();
        return;
      }

      setConnectionState({ success: true, message: 'Conectado. Leyendo VIN...' });
      const scan = await readObd(target);
      if (!scan?.transportConnected) {
        setConnectionState({ success: false, message: 'No se puede conectar' });
        return;
      }
      setConnectionState({
        success: true,
        message: scan?.vin ? 'Conectado' : 'No se puede extraer VIN',
      });
    } catch {
      setConnectionState({ success: false, message: 'No se puede conectar' });
      await refreshEvents();
    } finally {
      setConnecting(false);
    }
  };

  const navigate = (target: string) => {
    setActive(target);
    setMenuOpen(false);
  };

  const diagnosis = connectionState?.message ?? (interfacesQuery.isError || (interfacesQuery.isSuccess && interfaces.length === 0) ? 'No se puede conectar' : 'Conecte el adaptador para identificar el vehículo.');
  const mainContent = {
    connection: (
      <>
        <ConnectionHero />
        <AdapterSelectorCard
          interfaces={interfaces}
          selectedId={selectedInterfaceId}
          onSelect={(id) => {
            setSelectedInterfaceId(id);
            setConnectionState(null);
            setObdScan(null);
            setObdMessage(null);
          }}
          onConnect={() => void connectAdapter()}
          testing={connecting || obdLoading}
          connectionState={connectionState}
        />
      </>
    ),
    vehicle: (
      <>
        <div className="mb-5"><h1 className="text-2xl font-extrabold tracking-tight text-slate-100">Vehículo</h1><p className="mt-2 text-sm text-slate-400">Identificación obtenida automáticamente al conectar.</p></div>
        <ProfileCard vin={obdScan?.vin ?? null} diagnosis={diagnosis} />
      </>
    ),
    scan: (
      <>
        <div className="mb-5"><h1 className="text-2xl font-extrabold tracking-tight text-slate-100">Escanear</h1><p className="mt-2 text-sm text-slate-400">Lectura de Códigos de Error</p></div>
        <FaultMemoryCard scan={obdScan} loading={obdLoading || connecting} onScan={() => void (connectionState?.success ? readObd() : connectAdapter())} />
        {obdMessage && <p className="mt-3 rounded border border-slate-800 bg-slate-950/30 px-3 py-2 text-xs text-slate-400" role="status">{obdMessage}</p>}
      </>
    ),
    logs: (
      <>
        <div className="mb-5"><h1 className="text-2xl font-extrabold tracking-tight text-slate-100">Registro</h1><p className="mt-2 text-sm text-slate-400">Log de actividades del adaptador y las lecturas.</p></div>
        <EventLog events={events} error={eventsError} />
      </>
    ),
  }[active] ?? null;

  return (
    <div className="min-h-[100dvh] bg-[#0b151e] text-slate-200">
      <Header onRefresh={refreshAll} isRefreshing={interfacesQuery.isFetching} onMenu={() => setMenuOpen(true)} />
      <div className="mx-auto flex w-full max-w-[1560px]">
        <Sidebar active={active} onNavigate={navigate} open={menuOpen} onClose={() => setMenuOpen(false)} />
        <main className="instrument-grid min-w-0 flex-1 px-4 py-6 sm:px-7 sm:py-8 lg:px-9">
          <div className="mx-auto max-w-[1180px]" key={active} data-testid={`view-${active}`}>
            {mainContent}
            <footer className="mt-8 flex flex-col gap-2 border-t border-slate-800/80 py-5 text-[10px] text-slate-600 sm:flex-row sm:items-center sm:justify-between">
              <span className="mono">VECTOR / DIAG · OBD-II</span>
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-emerald-400/70" /> Solo lectura</span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;