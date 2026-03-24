# Auditar proyecto

Ejecutá una auditoría del proyecto actual contra la plantilla claude-kit.

## Steps

1. Detectar el stack del proyecto:
   - `pyproject.toml` o `requirements.txt` → python
   - `package.json` con react/vite → react-vite-ts
   - `Package.swift` o `*.xcodeproj` → swift-swiftui
   - `supabase/` o referencias a Supabase → supabase
   - `*.db` o `*.sqlite` o notebooks → data-analysis
   - `docker-compose*` o `Dockerfile*` → docker-deploy

2. Leer el checklist de auditoría: `~/Documents/GitHub/claude-kit/audit/checklist.md`

3. Evaluar cada item del checklist contra el proyecto actual:
   - ¿Existe CLAUDE.md? ¿Tiene >20 líneas útiles?
   - ¿Existe .claude/settings.json con permisos explícitos?
   - ¿Hay rules contextuales en .claude/rules/?
   - ¿Hay hook block-destructive?
   - ¿Los comandos build/test están documentados?
   - Items recomendados del checklist

4. Calcular score según `~/Documents/GitHub/claude-kit/audit/scoring.md`

5. Generar reporte con formato:
```
═══ AUDITORÍA: <proyecto> ═══
Stack detectado: <stacks>
Score: X.X/10

OBLIGATORIO:
✅ CLAUDE.md (X líneas)
❌ .claude/rules/ (no existe)
...

RECOMENDADO:
⚠️ CLAUDE_ERRORS.md (no existe)
...

GAPS CRÍTICOS:
1. <qué falta> → <qué hacer>
2. ...

SIGUIENTE PASO: /forge sync para aplicar plantilla
```
