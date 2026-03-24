# derup — ER/EER Modeler

Visual entity-relationship and extended entity-relationship modeler with multi-AI provider support. Built for the Database course at UTN Facultad Regional Resistencia.

---

- [English documentation](README.en.md)
- [Documentacion en espanol](README.es.md)

---

## Quick start

```bash
npm install
npm run api      # AI proxy on :8787
npm run dev      # Vite dev server → http://127.0.0.1:5173
```

---

## Features

- Visual ER/EER canvas: entities (strong/weak), relationships (regular/identifying), attributes (simple/key/multivalued/derived), ISA hierarchies, aggregations
- Connections with cardinality (1, N, M), total/partial participation, role labels
- Multi-view tabs: ER Diagram / Relational Schema / SQL DDL
- Auto-derived relational schema with PK/FK, composite PKs, ISA subtype tables
- Syntax-highlighted SQL DDL with copy-to-clipboard
- Export diagram as PNG or PDF
- Natural language chat commands to add, edit, delete, and connect diagram elements
- AI-assisted modeling: describe a full scenario in text and get a complete ER diagram
- Multi-provider AI: Gemini (Google), Grok (xAI), Ollama (local), OpenClaw — with connectivity checks and automatic fallback
- AI learns from modeling errors and injects corrective hints into future prompts
- Properties panel with inline editing, auto-opens on node selection
- Smart node placement, multi-select, group into aggregation
- JSON import/export, local snapshot via localStorage
- WebSocket collaboration rooms (experimental)
- 204 automated tests (Vitest)

---

## Documentation

- [Architecture](docs/ARCHITECTURE.en.md) / [Arquitectura](docs/ARCHITECTURE.es.md)
- [Contributing](docs/CONTRIBUTING.en.md) / [Contribuir](docs/CONTRIBUTING.es.md)
- [Deploy](docs/DEPLOY.en.md) / [Despliegue](docs/DEPLOY.es.md)

---

**Security:** Never hardcode API keys. Use `.env` or enter them in the UI settings panel. See [security notes](README.en.md#security).

---

MIT License
