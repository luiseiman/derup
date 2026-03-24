# Health check del proyecto

Verificar que la configuración de Claude Code del proyecto está sana.

## Steps

1. Verificar que CLAUDE.md existe y no está vacío
2. Verificar que .claude/settings.json existe y es JSON válido
3. Verificar que los hooks referenciados en settings.json existen y son ejecutables
4. Verificar que las rules referenciadas tienen frontmatter `globs:` válido
5. Verificar que CLAUDE_ERRORS.md existe (advertir si no)
6. Verificar que no hay secrets en archivos trackeados por git (.env, *.key, *.pem)
7. Reportar estado: ✅ sano / ⚠️ advertencias / ❌ problemas
