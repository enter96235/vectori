# Audi TT 8J Diagnostic Scanner

Read-only diagnostic workspace for a 2007 Audi TT 8J, designed to use a real J2534 or USB-CAN interface without fabricating vehicle data.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/audi-tt-diagnostic/` — React/Vite diagnostic workspace and responsive UI.
- `artifacts/api-server/src/lib/diagnostic-bridge.ts` — native bridge boundary; intentionally reports unavailable until a real Windows adapter bridge is connected.
- `artifacts/api-server/src/routes/diagnostic.ts` — read-only bridge status and interface inventory endpoints.
- `lib/api-spec/openapi.yaml` — source of truth for diagnostic bridge API contracts.
- `lib/api-client-react/src/generated/` — generated React Query client for the API contract.

## Architecture decisions

- The first vehicle profile is fixed to Audi TT 8J, model year 2007; vehicle connection is never inferred from the selected profile.
- The UI is read-only. Coding, adaptation, output tests, clearing DTCs, and programming are intentionally outside the first build.
- CAN, transport, diagnostic protocol, vehicle profile, and native hardware access are separate layers; the web UI only consumes the bridge contract.
- No adapter, module, fault, telemetry, or measurement is seeded. Empty states represent missing live hardware data.

## Product

The current build provides a professional workshop-style overview for bridge state, adapter discovery, Audi TT 8J profile context, and honest unavailable states for module inventory, DTCs, live data, and session logs. The next production step is a Windows native bridge that can access J2534 DLLs or vendor USB-CAN drivers.

## User preferences

- Build for the Audi TT 8J first.
- Keep the scanner flexible by separating CAN, transport, protocol, and vehicle-profile layers.
- Do not use simulated or invented vehicle readings.

## Gotchas

- The Replit preview cannot access Windows J2534 DLLs or a USB-CAN driver; it must show the bridge as unavailable rather than pretending an adapter exists.
- A working Windows executable requires a native bridge and a physically connected, supported interface; the browser preview is only the UI and API contract until that bridge exists.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
