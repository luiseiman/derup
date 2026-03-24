# Debug

Diagnóstico estructurado de un error.

## Argumentos
$ARGUMENTS: descripción del error, stack trace, o "último error" para buscar en logs.

## Proceso

1. **Recopilar evidencia**:
   - Si hay stack trace en $ARGUMENTS, parsearlo
   - Si no, buscar en logs recientes o preguntar al usuario
   - Leer el código del archivo/línea del error

2. **Análisis paso a paso**:
   - ¿Qué línea exacta falla?
   - ¿Qué valor tiene cada variable relevante?
   - ¿Qué condición no se cumple?
   - ¿Es reproducible? ¿Cuándo ocurre?

3. **Hipótesis** (mínimo 2):
   - Hipótesis A: causa más probable + evidencia
   - Hipótesis B: causa alternativa + evidencia

4. **Verificación**:
   - Ejecutar test que reproduce el error (o crear uno)
   - Confirmar cuál hipótesis es correcta

5. **Fix**:
   - Corregir la causa raíz (no el síntoma)
   - Ejecutar tests para verificar que el fix funciona
   - Verificar que no se rompió nada más

6. **Registro**:
   - Si existe CLAUDE_ERRORS.md, registrar el error con causa raíz y fix
   - Formato: `| fecha | área | error | causa | fix | regla |`
