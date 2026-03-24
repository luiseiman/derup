---
globs: "src/**/*.{ts,tsx,js,jsx}"
---

# React / Vite / TypeScript Rules

## Stack
React 18+, Vite, TypeScript strict mode, Tailwind CSS.

## Patterns
- Componentes funcionales exclusivamente. No class components.
- Styling: Tailwind utility classes. No hardcodear colores.

## TypeScript
- `strict: true` en tsconfig.json. Sin excepciones.
- Prohibido `any`. Usar `unknown` + type guard si el tipo es dinámico.
- Props types definidas junto al componente.

## Errores
- SIEMPRE manejar errores en catch. Nunca catch vacío.

## Build
- `npm run dev` → development
- `npm run build` → production (verificar 0 errores TS)
- `npm run lint` → eslint
