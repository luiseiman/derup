# Derup ER Modeler

Academic ER/EER modeling app for the **Database course** in the **Information Systems Engineering program** at **Universidad Tecnologica Nacional - Facultad Regional Resistencia (UTN FRRe)**.

## Language / Idioma
- [README en Espanol](README.es.md)
- [README in English](README.en.md)

## Quick Start
```bash
npm install
npm run api
npm run dev
```

Open: `http://127.0.0.1:5173`

## Main Features
- Visual ER modeling: entities, relationships, attributes, keys, weak entities.
- Constraints: cardinality, participation, roles, identifying relationships.
- EER features: ISA hierarchies and aggregations.
- AI-assisted modeling from chat and full scenario text.
- Multi-provider AI support: Gemini, Grok (xAI), and Ollama with fallback.
- JSON import/export and local persistence.

## Project Docs
- [Architecture (ES)](docs/ARCHITECTURE.es.md)
- [Architecture (EN)](docs/ARCHITECTURE.en.md)
- [Contributing (ES)](docs/CONTRIBUTING.es.md)
- [Contributing (EN)](docs/CONTRIBUTING.en.md)
- [Publish to GitHub (ES)](docs/GITHUB_PUBLISH.es.md)
- [Publish to GitHub (EN)](docs/GITHUB_PUBLISH.en.md)
- [Deploy in Google Cloud (ES)](docs/DEPLOY_GCP.es.md)
- [Deploy in Google Cloud (EN)](docs/DEPLOY_GCP.en.md)

## Security Note
Never commit real API keys. Use `.env` and rotate compromised keys immediately.

## Open Source License
This project is open source under the [MIT License](LICENSE).
