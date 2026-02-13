# Arquitectura tecnica (ES)

## Vista general
La app se divide en 3 capas:
- Frontend React/Vite: UI de modelado y chat.
- Proxy local Node (`/server/gemini-server.js`): integra APIs remotas (Gemini y Grok).
- Ollama local: inferencia on-device a traves del proxy de Vite.

## Frontend
Archivo principal: `src/App.tsx`

Responsabilidades:
- Gestion del estado del diagrama (nodos, conexiones, agregaciones, zoom, seleccion).
- Edicion manual y por chat.
- Parsing de comandos de chat (`src/utils/chatParser.ts`).
- Generacion de modelo desde escenario completo (IA + saneamiento).
- Persistencia local (`localStorage`) de:
  - snapshot,
  - presets,
  - reglas de modelado,
  - API keys ingresadas en UI.

Canvas:
- `src/components/Canvas/Canvas.tsx`
- Render SVG de entidades, relaciones, atributos, ISA y conectores.
- Soporta flechas, cardinalidades, roles, participacion total y trazado curvo para reflexivas/duplicadas.

## Tipos de dominio
Archivo: `src/types/er.ts`

Elementos principales:
- Nodos: `entity`, `relationship`, `attribute`, `isa`.
- Conexion: `sourceId`, `targetId`, `cardinality`, `isTotalParticipation`, `role`.
- Agregacion: `memberIds` (grupo semantico en caja punteada).

## Proxy local de IA
Archivo: `server/gemini-server.js`

Endpoints:
- Gemini:
  - `POST /api/gemini/models`
  - `POST /api/gemini/health`
  - `POST /api/gemini`
- Grok:
  - `POST /api/grok/models`
  - `POST /api/grok/health`
  - `POST /api/grok`

Comportamiento:
- Lee `.env` al iniciar.
- Expone respuestas normalizadas en JSON.
- Propaga errores HTTP y mensajes de proveedor cuando es posible.

## Proxy Vite
Archivo: `vite.config.ts`

Rutas proxied:
- `/api/gemini` -> `http://127.0.0.1:8787`
- `/api/grok` -> `http://127.0.0.1:8787`
- `/api/ollama` -> `http://127.0.0.1:11434/api`

## Flujo IA (alto nivel)
1. Usuario envia prompt en chat.
2. Front valida proveedor/modelo/key.
3. Se solicita inferencia al proveedor primario.
4. Si falla, intenta fallback automatico en proveedores alternativos conectados.
5. La respuesta se parsea como comando o JSON de escenario.
6. Se sanea y renderiza el modelo en el lienzo.

## Modelo desde escenarios
- Prompt maestro con heuristicas ER/EER.
- Extraccion de `entities`, `relationships` y soporte para `isa` y `aggregations`.
- Validacion:
  - entidades duplicadas,
  - relaciones con participantes invalidos,
  - cardinalidades normalizadas,
  - consistencia de ISA/agregaciones.
- Si falla validacion, se ejecuta una etapa de reparacion asistida por IA.

## Persistencia
- `localStorage`:
  - snapshot diagrama,
  - presets,
  - reglas/hints,
  - claves de API (UI local).
- Export/Import JSON para versionado academico y entregas.

## Consideraciones para produccion
- No exponer API keys en frontend publico.
- Mover proxy a backend seguro con autenticacion.
- Agregar auditoria y versionado de cambios de modelo si se usa en evaluaciones.
