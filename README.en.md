# Derup ER Modeler (English)

Academic ER/EER modeling app designed to support teachers and students from the **Database course** in the **Information Systems Engineering** program at **UTN - Facultad Regional Resistencia**.

## Academic purpose
- Make ER diagram construction easier for classes, labs, and assessments.
- Let students model manually and also with AI assistance.
- Capture domain semantics through constraints (keys, participation, roles, hierarchies, and aggregations).

## Features
- ER canvas with:
  - Entities, relationships, and attributes.
  - Key, multivalued, and derived attributes.
  - Weak entities and identifying relationships.
  - Cardinality and total/partial participation.
  - Role labels on connections.
- EER support:
  - Class hierarchies (ISA, default label `ES`, editable).
  - Aggregations.
- Modeling chat:
  - Natural-language commands for create/edit operations.
  - Attribute inference (up to 5 attributes per entity, including one key).
  - Full scenario interpretation and model generation.
- Multi-provider AI:
  - Gemini.
  - Grok (xAI).
  - Local Ollama.
  - Connectivity checks and automatic fallback.
- Persistence and portability:
  - Automatic local snapshot.
  - Diagram JSON import/export.
  - Editable attribute presets (add, edit, delete).

## Tech stack
- Frontend: React + TypeScript + Vite.
- Local AI proxy: Node.js (`server/gemini-server.js`) for Gemini and Grok.
- Ollama: local access through Vite proxy (`/api/ollama`).

## Requirements
- Node.js 20+ (recommended).
- npm 10+.
- Optional: Ollama installed for local inference.

## Installation
```bash
npm install
```

## Run in development
1. Start local AI proxy:
```bash
npm run api
```
2. Start frontend:
```bash
npm run dev
```
3. Open `http://127.0.0.1:5173`.

## Environment variables
Create a `.env` file at root (you can use `.env.example`):

```bash
GEMINI_PORT=8787
GEMINI_API_KEY=
XAI_API_KEY=
```

Notes:
- `GEMINI_API_KEY` is optional if you enter the key in the UI.
- `XAI_API_KEY` (or `GROK_API_KEY`) is optional if you enter the key in the UI.
- Never commit real keys.

## Quick chat examples
- `agregar una entidad Alumno con atributos: id, nombre, email donde id es clave`
- `agrega atributos: telefono, fecha_nacimiento a la entidad Profesor`
- `vincula la entidad Alumno con la entidad Curso relacion Cursa`
- `la relacion Supervisa debe relacionar Profesor con una agregacion entre EstudianteGraduado y Proyecto`

For full scenarios:
- Paste the full requirements text.
- Enable AI and choose provider/model.
- The app will infer entities, relationships, constraints, and render the model.

## Recommended classroom flow
1. Build the initial model manually.
2. Refine with AI chat feedback (iterative corrections).
3. Review constraints in Properties panel.
4. Export JSON for submission or versioning.

## Scripts
- `npm run dev`: frontend dev server.
- `npm run api`: local AI proxy (Gemini/Grok).
- `npm run build`: production build.
- `npm run preview`: preview production build.
- `npm run lint`: code linting.

## Extra docs
- [Architecture](docs/ARCHITECTURE.en.md)
- [Contributing](docs/CONTRIBUTING.en.md)
- [Publish to GitHub](docs/GITHUB_PUBLISH.en.md)

## License
This project is open source and distributed under the [MIT License](LICENSE).
