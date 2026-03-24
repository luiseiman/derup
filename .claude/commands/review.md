# Code Review

Ejecutá un code review como senior engineer para producción.

## Argumentos
$ARGUMENTS: archivos o directorio a revisar. Si está vacío, revisar archivos modificados (git diff --name-only).

## Proceso

1. Identificar archivos a revisar:
   - Si se proporcionaron archivos específicos, usar esos
   - Si no, `git diff --name-only` para archivos modificados
   - Si no hay diff, preguntar qué revisar

2. Evaluar en este orden de prioridad:

### Bugs y casos edge (crítico)
- Null/undefined no manejados
- Off-by-one errors
- Race conditions en async
- Inputs no validados

### Seguridad (crítico)
- SQL injection
- XSS
- Secrets hardcodeados
- Permisos excesivos

### Performance (si hay problema real)
- N+1 queries
- Loops innecesarios sobre colecciones grandes
- Memory leaks (event listeners, subscriptions sin cleanup)

### Legibilidad y mantenibilidad
- Nombres descriptivos
- Funciones <50 líneas
- Single responsibility
- Error handling adecuado

### Best practices del lenguaje
- Idiomático para el lenguaje/framework
- Patrones del proyecto respetados

3. Para cada problema encontrado:
```
🔴|🟡|🟢 [ÁREA] archivo:línea
Issue: qué está mal
Impacto: qué puede pasar
Fix: cómo corregirlo
```

4. Al final, código corregido completo de los archivos con problemas.
