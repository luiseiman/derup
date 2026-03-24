---
globs: "**/*.md,**/*.sh,**/*.yml,**/*.json,**/*.tmpl,**/*.py,**/*.ts,**/*.tsx,**/*.swift"
---

# Reglas de codigo

Reglas tecnicas por proyecto. Las reglas de comportamiento (comunicacion, planificacion, autonomia) estan en el CLAUDE.md global y no se repiten aca.

## Git
- Commits atomicos: un cambio logico por commit
- Mensajes en imperativo, primera linea <72 chars
- No commitear .env, secrets, keys, credenciales
- No force push a main/master sin confirmacion explicita
- Branch naming: feature/, fix/, refactor/, chore/

## Naming
- Variables/funciones descriptivas, no abreviaciones cripticas
- Constantes en UPPER_SNAKE_CASE
- No single-letter variables excepto iteradores (i, j, k) y lambdas

## Testing
- Funcionalidad nueva → test obligatorio
- Nombres de test descriptivos: test_<que>_<condicion>_<resultado_esperado>
- No mockear lo que se puede testear de verdad

## Errores
- Nunca catch vacio — siempre log o re-raise
- No exponer stack traces al usuario final

## Seguridad
- Inputs del usuario: sanitizar siempre
- Sin credenciales hardcodeadas — usar variables de entorno
- Queries parametrizadas (no string interpolation)
- Rate limiting en endpoints publicos

## Scope
- Solo modificar archivos estrictamente necesarios
- No agregar features no solicitadas

## Prompt Language
- All Claude-consumed content (rules, agent prompts, skill steps, system prompts) MUST be in English
- User-facing content (docs, CLAUDE.md project descriptions, changelog) may be in Spanish
- Prompts must be compact: high information density, no filler words, no hedging
- One instruction per line, imperative mood, no "please" or "you should consider"
- If a rule can be expressed in fewer words without losing meaning, rewrite it shorter
