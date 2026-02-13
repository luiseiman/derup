# Guia de contribucion (ES)

## Alcance
Este proyecto prioriza soporte didactico para la catedra de Base de Datos (UTN FRRe).
Toda contribucion debe mejorar:
- precision conceptual ER/EER,
- usabilidad docente/estudiante,
- robustez del flujo de modelado por chat.

## Flujo recomendado
1. Crear rama desde `main`.
2. Implementar cambios pequenos y testeables.
3. Validar build/lint local.
4. Abrir PR con descripcion funcional y evidencia visual.

## Convenciones de codigo
- TypeScript estricto.
- Evitar dependencias innecesarias.
- Mantener parser y acciones de chat desacoplados.
- No hardcodear claves API ni secretos.

## Validaciones minimas antes de PR
```bash
npm run lint
npm run build
```

## Criterios funcionales
- No romper edicion manual del lienzo.
- No romper serializacion/import/export JSON.
- Si se cambia IA/chat:
  - cubrir caso sin API key,
  - cubrir proveedor desconectado,
  - cubrir fallback.

## UI/UX
- Priorizar claridad sobre efectos visuales.
- Mantener experiencia usable en desktop y touch.
- Evitar superposicion de nodos cuando se autogenera modelo.

## Issues y PR
Incluir siempre:
- problema actual,
- solucion implementada,
- impacto academico (docente/estudiante),
- pasos de prueba.

## Seguridad
- Nunca subir API keys.
- Si una clave fue expuesta, revocarla y rotarla.
