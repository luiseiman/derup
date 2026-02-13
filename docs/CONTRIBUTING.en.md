# Contributing Guide (EN)

## Scope
This project is focused on educational support for the Database course (UTN FRRe).
Every contribution should improve:
- ER/EER conceptual accuracy,
- teacher/student usability,
- robustness of the chat-based modeling workflow.

## Recommended workflow
1. Create a branch from `main`.
2. Implement small, testable changes.
3. Validate local lint/build.
4. Open a PR with functional description and visual evidence.

## Coding conventions
- Strict TypeScript.
- Avoid unnecessary dependencies.
- Keep chat parser and command actions decoupled.
- Never hardcode API keys or secrets.

## Minimum checks before PR
```bash
npm run lint
npm run build
```

## Functional criteria
- Do not break manual canvas editing.
- Do not break JSON serialize/import/export.
- If AI/chat is changed:
  - cover missing API key,
  - cover disconnected provider,
  - cover fallback behavior.

## UI/UX
- Prioritize clarity over visual effects.
- Keep experience usable on desktop and touch devices.
- Avoid node overlap in auto-generated models.

## Issues and PRs
Always include:
- current problem,
- implemented solution,
- academic impact (teacher/student),
- test steps.

## Security
- Never commit API keys.
- If a key is exposed, revoke and rotate it immediately.
