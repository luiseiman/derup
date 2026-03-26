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
TypeScript strict + Vite + React + Tailwind. ESLint + Prettier.
