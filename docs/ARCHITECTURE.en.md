# Technical Architecture

## Overview

derup has three layers:

1. **React/Vite frontend** — interactive canvas, multi-view tabs, chat interface, and AI orchestration.
2. **Node.js AI proxy** (`server/gemini-server.js`) — forwards requests to Gemini (Google) and Grok (xAI), serves the static build in production.
3. **Local Ollama / OpenClaw** — on-device inference accessed directly via Vite proxy in development, or directly via `localhost` in production.

```
Browser (React)
  │
  ├─ /api/gemini  ──► Node proxy :8787 ──► api.googleapis.com
  ├─ /api/grok    ──► Node proxy :8787 ──► api.x.ai
  ├─ /api/openclaw──► Node proxy :8787 ──► localhost:18789
  └─ /api/ollama  ──► Vite proxy       ──► localhost:11434
```

---

## Frontend structure

| File / Directory | Responsibility |
|---|---|
| `src/App.tsx` | Root component. Holds all diagram state, manages tabs, chat, AI orchestration, import/export, and localStorage persistence. |
| `src/components/Canvas/Canvas.tsx` | SVG canvas. Renders all ER nodes, connectors, aggregation boxes, cardinality labels, role labels, and participation markers. Handles drag, click, and multi-select. |
| `src/components/Views/RelationalSchemaView.tsx` | Renders the auto-derived relational schema as a table list with PK/FK badges. |
| `src/components/Views/SQLView.tsx` | Renders syntax-highlighted `CREATE TABLE` DDL statements with a copy button. |
| `src/components/Properties/` | Inline properties panel. Auto-opens when a node is selected. |
| `src/components/Toolbar/` | Toolbar with node creation buttons, export controls, and view switcher. |
| `src/components/ContextMenu/` | Right-click context menu for canvas operations. |
| `src/components/Shapes/NodeDispatcher.tsx` | Dispatches SVG rendering to the correct shape component based on node type. |
| `src/hooks/useLocalStorage.ts` | Generic hook for reading and writing to localStorage with type safety. |
| `src/hooks/useContextMenu.ts` | Hook managing context menu open/close state and position. |
| `src/utils/chatParser.ts` | Parses natural language chat commands into structured `DiagramCommand` objects. |
| `src/utils/aiCommands.ts` | Applies parsed commands to diagram state (add entity, add attribute, connect, delete, etc.). |
| `src/utils/diagram.ts` | Pure diagram utilities: node placement, free-slot scanning, bounding box calculations. |
| `src/utils/relationalSchema.ts` | Derives a `RelationalSchema` from diagram state (Ramez & Navathe Ch. 9 algorithm). |
| `src/utils/json.ts` | Serialize/deserialize `DiagramSnapshot` with schema validation. |
| `src/utils/schemas.ts` | Zod schemas for `DiagramSnapshot` and related types. |
| `src/utils/ids.ts` | Generates unique node and connection IDs via nanoid. |
| `src/types/er.ts` | All domain type definitions. |

---

## Multi-view system

The app shows three tabs over the same diagram state:

1. **ER Diagram** — the interactive canvas (always the source of truth).
2. **Relational Schema** — computed on demand from `relationalSchema.ts`. Displayed as a styled table list. Source badges indicate how each table was derived.
3. **SQL DDL** — generated from the relational schema by `SQLView.tsx`. Renders `CREATE TABLE` blocks with `PRIMARY KEY`, `FOREIGN KEY`, and `NOT NULL` constraints. Copy-to-clipboard uses the Clipboard API.

Switching tabs does not mutate diagram state. The relational schema and SQL are always re-derived from the current diagram.

---

## Domain types (`src/types/er.ts`)

```
ERNode = EntityNode | RelationshipNode | AttributeNode | ISANode

EntityNode      { isWeak: boolean }
RelationshipNode{ isIdentifying: boolean }
AttributeNode   { isKey, isMultivalued, isDerived, parentId? }
ISANode         { isDisjoint, isTotal }

Connection      { sourceId, targetId, cardinality?, isTotalParticipation, role? }
Aggregation     { id, memberIds[], padding?, label? }
DiagramSnapshot { version, nodes[], aggregations[], connections[], view? }
```

Cardinality values: `'1' | 'N' | 'M'`.

---

## AI proxy (`server/gemini-server.js`)

### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/gemini/health` | Check Gemini API key validity |
| `POST` | `/api/gemini/models` | List available Gemini models |
| `POST` | `/api/gemini` | Send prompt to Gemini, return response text |
| `POST` | `/api/grok/health` | Check Grok/xAI API key validity |
| `POST` | `/api/grok/models` | List available Grok models |
| `POST` | `/api/grok` | Send prompt to Grok, return response text |
| `POST` | `/api/openclaw/health` | Check OpenClaw local endpoint health |
| `POST` | `/api/openclaw/models` | List OpenClaw models |
| `POST` | `/api/openclaw` | Send prompt to OpenClaw |
| `POST` | `/api/rooms` | Create or join a WebSocket collaboration room |
| `GET` | `/health` | Server health check (used by Docker HEALTHCHECK) |

### Security behavior
- Loads `.env` at startup; environment variables set before launch take precedence.
- Static file serving normalizes and sanitizes the request path to prevent path traversal.
- API keys are read from the request body (passed from the frontend) and never logged.
- HTTP errors from upstream providers are propagated with their original status codes.

---

## Vite proxy config (`vite.config.ts`)

In development, the Vite dev server proxies these routes:

| Prefix | Target |
|---|---|
| `/api/gemini` | `http://127.0.0.1:8787` |
| `/api/grok` | `http://127.0.0.1:8787` |
| `/api/openclaw` | `http://127.0.0.1:8787` |
| `/api/ollama` | `http://127.0.0.1:11434/api` |

In production the Node server handles all `/api/*` routes and also serves the built `dist/` directory.

---

## AI flow

```
User submits prompt
  │
  ├─ Frontend validates: provider selected, model selected, key present
  │
  ├─ Request sent to primary provider via proxy
  │
  ├─ If error → automatic fallback to next connected provider
  │
  ├─ Response parsed:
  │    ├─ Single command  → chatParser.ts → aiCommands.ts → state mutation
  │    └─ Full scenario   → JSON with entities/relationships/isa/aggregations
  │                           → validation → sanitization → batch state mutation
  │
  └─ If validation fails → AI-assisted repair stage re-sends to provider
```

Persisted modeling hints (from past errors) are injected into the system prompt before each request so the model avoids previously observed mistakes.

---

## Relational schema algorithm (`src/utils/relationalSchema.ts`)

Based on Ramez Elmasri & Shamkant Navathe, *Fundamentals of Database Systems*, Ch. 9 (ER-to-Relational mapping).

Steps applied in order:

1. **Strong entities** — one table per entity; key attributes become `PRIMARY KEY`; derived attributes are omitted.
2. **Weak entities** — table includes the owner's PK as a `FOREIGN KEY`; composite PK = owner PK + partial key.
3. **1:N relationships** — FK added to the N-side entity table; total participation generates `NOT NULL`.
4. **M:N relationships** — new junction table with FKs from both sides; composite PK.
5. **1:1 relationships** — FK added to the total-participation side, or to either side if both are partial.
6. **ISA hierarchies** — one table per subtype containing the supertype PK as both PK and FK; source badge: `isa-subtype`.
7. **Multivalued attributes** — separate table with the owner's PK as FK; composite PK = owner PK + attribute value; source badge: `multivalued`.

Warnings are emitted for: entities with no key attribute (a synthetic `id_<entity>` column is generated), and unresolvable relationship participants.

---

## Persistence

All state is held in React in-memory and persisted to `localStorage`:

| Key | Contents |
|---|---|
| `derup_snapshot` | Full `DiagramSnapshot` (nodes, connections, aggregations, view) |
| `derup_presets` | Editable attribute presets |
| `derup_hints` | AI modeling error hints (injected into future prompts) |
| `derup_keys` | API keys entered in the UI (never sent to git) |

JSON import/export uses `DiagramSnapshot` with Zod validation on import to reject malformed files.

---

## Test suite

Run with `npm run test`. All 204 tests must pass before merging.

| File | What is covered |
|---|---|
| `src/utils/chatParser.test.ts` | Chat command parsing: add entity, add attribute, connect, delete, edge cases |
| `src/utils/aiCommands.test.ts` | Command application to diagram state |
| `src/utils/ids.test.ts` | ID generation uniqueness and format |
| `src/utils/json.test.ts` | DiagramSnapshot serialization and Zod validation |
| `src/utils/schemas.test.ts` | Zod schema acceptance and rejection cases |
| `src/components/Canvas/Canvas.helpers.test.ts` | Canvas geometry helpers, free-slot placement |
| `src/hooks/useLocalStorage.test.ts` | Read/write/default behavior |
| `src/hooks/useContextMenu.test.ts` | Open/close/position state |

---

## Production notes

The production image is built with Docker multi-stage:

1. `build` stage — runs `npm ci` + `npm run build`, produces `dist/`.
2. `runtime` stage — installs only production dependencies, copies `server/` and `dist/`, runs as non-root user `appuser`.

The Node server serves the `dist/` directory for all non-API routes (SPA fallback). The `/health` endpoint is used by the Docker `HEALTHCHECK`.

Environment variables at runtime:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP port the server listens on |
| `HOST` | `0.0.0.0` | Bind address (all interfaces when `PORT` is set) |
| `GEMINI_API_KEY` | — | Optional; can be provided per-request from the UI |
| `XAI_API_KEY` | — | Optional; can be provided per-request from the UI |
| `NODE_ENV` | `production` | Set automatically by the Dockerfile |
