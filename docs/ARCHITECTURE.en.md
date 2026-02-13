# Technical Architecture (EN)

## Overview
The app has 3 layers:
- React/Vite frontend: modeling UI and chat.
- Local Node proxy (`/server/gemini-server.js`): remote API integration (Gemini and Grok).
- Local Ollama: on-device inference through Vite proxy.

## Frontend
Main file: `src/App.tsx`

Responsibilities:
- Diagram state management (nodes, edges, aggregations, zoom, selection).
- Manual and chat-based editing.
- Chat command parsing (`src/utils/chatParser.ts`).
- Full-scenario model generation (AI + sanitization).
- Local persistence (`localStorage`) for:
  - snapshots,
  - presets,
  - modeling hints,
  - API keys entered in UI.

Canvas:
- `src/components/Canvas/Canvas.tsx`
- SVG rendering for entities, relationships, attributes, ISA, and connectors.
- Supports arrows, cardinalities, roles, total participation, and curved lines for reflexive/duplicate links.

## Domain types
File: `src/types/er.ts`

Main elements:
- Nodes: `entity`, `relationship`, `attribute`, `isa`.
- Connection: `sourceId`, `targetId`, `cardinality`, `isTotalParticipation`, `role`.
- Aggregation: `memberIds` (semantic group rendered as dashed box).

## Local AI proxy
File: `server/gemini-server.js`

Endpoints:
- Gemini:
  - `POST /api/gemini/models`
  - `POST /api/gemini/health`
  - `POST /api/gemini`
- Grok:
  - `POST /api/grok/models`
  - `POST /api/grok/health`
  - `POST /api/grok`

Behavior:
- Loads `.env` at startup.
- Returns normalized JSON responses.
- Propagates HTTP errors and provider messages when possible.

## Vite proxy
File: `vite.config.ts`

Proxied routes:
- `/api/gemini` -> `http://127.0.0.1:8787`
- `/api/grok` -> `http://127.0.0.1:8787`
- `/api/ollama` -> `http://127.0.0.1:11434/api`

## AI flow (high level)
1. User submits a prompt in chat.
2. Frontend validates provider/model/key.
3. Request goes to primary provider.
4. If it fails, automatic fallback tries connected alternatives.
5. Response is parsed as command or scenario JSON.
6. Model is sanitized and rendered on canvas.

## Scenario-to-model pipeline
- Master prompt with ER/EER heuristics.
- Extracts `entities`, `relationships`, with support for `isa` and `aggregations`.
- Validation checks:
  - duplicate entities,
  - invalid relationship participants,
  - normalized cardinalities,
  - ISA/aggregation consistency.
- If validation fails, an AI-assisted repair stage is executed.

## Persistence
- `localStorage`:
  - diagram snapshot,
  - presets,
  - modeling hints,
  - API keys (local UI storage).
- JSON export/import for coursework submissions and versioning.

## Production considerations
- Do not expose API keys in a public frontend.
- Move proxy logic to a secure backend with authentication.
- Add model-change audit/versioning if used for graded workflows.
