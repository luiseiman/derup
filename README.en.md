# derup — ER/EER Modeler

Academic visual modeler for entity-relationship and extended entity-relationship diagrams. Built to support the **Database course** in the **Information Systems Engineering** program at **UTN Facultad Regional Resistencia (UTN FRRe)**.

---

## Features

### Canvas and diagram elements
- Entities: strong and weak (double rectangle)
- Relationships: regular and identifying (double diamond)
- Attributes: simple, key (underlined), multivalued (double oval), derived (dashed oval)
- ISA hierarchies: disjoint/overlapping, total/partial coverage
- Aggregations: semantic grouping rendered as dashed bounding box
- Connections with cardinality labels (1, N, M), total/partial participation (thick line), and role labels

### Multi-view tabs
- **ER Diagram**: interactive canvas
- **Relational Schema**: auto-derived tables with PK/FK annotations, composite PKs, ISA subtype tables, and source badges (entity / relationship / multivalued / isa-subtype)
- **SQL DDL**: syntax-highlighted `CREATE TABLE` statements with copy-to-clipboard

### Export
- Export the active view as PNG or PDF (html2canvas + jsPDF)

### AI-assisted modeling
- Natural language chat commands (Spanish) to add, edit, delete, and connect entities, relationships, and attributes
- Full scenario input: paste a requirements text and get a complete ER diagram generated in one step
- Multi-provider AI support: **Gemini** (Google AI Studio), **Grok** (xAI), **Ollama** (local), **OpenClaw**
- Per-provider connectivity checks and automatic fallback to the next available provider
- AI learns from modeling errors: failed diagram commands are persisted as corrective hints injected into future prompts

### Editing and persistence
- Properties panel with inline editing of all node attributes; auto-opens when a node is selected
- Smart node placement: new nodes appear in the first free slot in the visible area (top-left scan)
- Multi-select mode: connect, delete, or group selected nodes into an aggregation
- Editable attribute presets
- JSON import/export
- Automatic local snapshot (localStorage)
- WebSocket collaboration rooms (experimental)

### Testing
- 204 automated tests covering utils, hooks, Canvas helpers, and schema validation (Vitest)

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript strict, Vite 7 |
| Styling | CSS custom properties |
| AI proxy | Node.js (`server/gemini-server.js`) |
| Testing | Vitest 4, @testing-library/react, jsdom |
| Schema validation | Zod |
| Export | html2canvas, jsPDF |
| IDs | nanoid |
| WebSocket | ws |

---

## Requirements

- Node.js 20+
- npm 10+
- Optional: [Ollama](https://ollama.com) installed locally for on-device inference

---

## Installation

```bash
git clone https://github.com/luiseiman/derup.git
cd derup
npm install
```

---

## Running in development

Start the AI proxy (Gemini / Grok / OpenClaw):
```bash
npm run api
```

Start the frontend dev server in a separate terminal:
```bash
npm run dev
```

Open `http://127.0.0.1:5173`.

Both processes must be running for AI features to work. Ollama is accessed directly via the Vite proxy without the Node server.

---

## Environment variables

Copy `.env.example` to `.env` and fill in any keys you want to pre-load:

```bash
# Local AI proxy port
GEMINI_PORT=8787

# Gemini (Google AI Studio) — optional if entered in the UI
GEMINI_API_KEY=

# Grok / xAI — optional if entered in the UI
XAI_API_KEY=
# GROK_API_KEY=   # alternative name, both accepted
```

Keys are optional in `.env`: if omitted, you can enter them in the UI settings panel. They are stored in `localStorage` and never sent to any server other than the respective provider.

---

## Chat command examples

```
agregar una entidad Alumno con atributos: id, nombre, email donde id es clave
agrega atributos: telefono, fecha_nacimiento a la entidad Profesor
vincula la entidad Alumno con la entidad Curso relacion Cursa
eliminar la entidad Alumno
```

For full-scenario generation, paste a complete requirements description, enable AI, choose a provider and model, and the app will infer entities, relationships, constraints, and render the full model.

---

## AI providers setup

| Provider | How to get a key | Notes |
|---|---|---|
| Gemini | [Google AI Studio](https://aistudio.google.com/app/apikey) — free tier available | Key goes in `.env` as `GEMINI_API_KEY` or in the UI |
| Grok | [xAI Console](https://console.x.ai) | Key goes in `.env` as `XAI_API_KEY` or in the UI |
| Ollama | Install from [ollama.com](https://ollama.com), run `ollama serve` | No key required; accessed via Vite proxy at `/api/ollama` |
| OpenClaw | Local endpoint at `http://localhost:18789` | No key required; must be running locally |

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run api` | Start AI proxy server |
| `npm run build` | TypeScript compile + Vite production build |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier on src files |
| `npm run test` | Run test suite (Vitest) |
| `npm run test:watch` | Run tests in watch mode |

---

## Contributing

See [docs/CONTRIBUTING.en.md](docs/CONTRIBUTING.en.md).

---

## Security

- **API keys**: never hardcode keys in source files. Use `.env` (git-ignored) or the UI input. Keys entered in the UI are stored only in the browser's `localStorage`.
- **Git exclusions**: `.env`, `*.key`, and `*.pem` files are excluded via `.gitignore`. If a key is accidentally committed, revoke and rotate it immediately.
- **Server**: the Node proxy includes path traversal protection for static file serving and runs as a non-root user in Docker.
- **Docker**: the production image runs as a non-root user (`appuser`) and uses `--omit=dev` to exclude development dependencies.

---

## License

This project is open source under the [MIT License](LICENSE).
