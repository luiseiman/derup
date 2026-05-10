# derup — ER Modeler

TypeScript Vite app con multi-AI provider para modelado entidad-relación.

## Role
ER modeling tool developer. Core concerns:
- Natural language → structured ER diagram mutations (chatParser → AICommand JSON → canvas state)
- AI-assisted diagram generation via structured JSON protocol (Zod-validated, batch-capable)
- Multi-AI provider integration: Gemini, Grok, Ollama, OpenClaw proxy (VPS gateway)
- Canvas rendering: custom SVG connectors, self-relationships, total participation, export
- WebSocket collaboration: room-based real-time diagram sync, DiagramSnapshot serialization

When modifying AI commands: verify against `AICommandSchema` discriminated union in `aiCommands.ts`.
When modifying the parser: run actual parser output — never trust spec comments over code.
When modifying Canvas: `npm run build` is the authoritative TS check (lint has known pre-existing violations).

## Build & Dev
`npm run dev` (Vite) · `npm run build` (tsc + vite build) · `npm run lint` (eslint)

## Stack
TypeScript strict + Vite + React + Tailwind. ESLint + Prettier. Zod for schema validation.

## Structure
```
src/
├── App.tsx              # Root component, provider wiring
├── components/
│   ├── Canvas/          # SVG rendering, connectors, self-rel, zoom/pan
│   ├── Toolbar/         # top-bar actions: add entity, undo/redo, export
│   ├── ContextMenu/     # right-click on entity/rel nodes
│   ├── Properties/      # side panel: attributes, cardinality, PK/FK
│   ├── Shapes/          # entity/relation/attribute primitives
│   └── Views/           # main editor views, chat, settings
├── hooks/               # useCanvas, useAI, useCollab, useHistory
├── types/               # AICommandSchema (Zod), DiagramSnapshot, WSMessage
├── utils/               # parser (chat→AICommand), exporters, serializers
└── test/                # vitest specs — parser, canvas ops, schema round-trip
```

## Architecture
- **Chat → AICommand → Canvas**: `chatParser` converts natural language to Zod-validated `AICommand` JSON, which mutates canvas state via reducer. Batch operations supported.
- **AI providers**: Gemini / Grok / Ollama / OpenClaw proxy — abstracted behind a single `AIProvider` interface. Provider selection is runtime via settings panel.
- **Collab layer**: room-based WebSocket sync. `DiagramSnapshot` is the transport format — full state dumps on join, deltas on mutation.
- **Canvas**: SVG-first, no external diagram lib. Self-relationships use a 3-point bezier trick; total-participation rendered as double line.

## Key files
- `src/types/aiCommands.ts` — `AICommandSchema` discriminated union. Source of truth for AI protocol.
- `src/utils/chatParser.ts` — natural language → AICommand JSON. Run actual parser output when editing, never trust comments.
- `src/components/Canvas/Canvas.tsx` — state reducer + SVG rendering. `npm run build` is the authoritative TS check.
