# Arquitectura Tecnica

## Descripcion general

derup tiene tres capas:

1. **Frontend React/Vite** — lienzo interactivo, pestanas de vistas multiples, interfaz de chat y orquestacion de IA.
2. **Proxy Node.js** (`server/gemini-server.js`) — reenvía solicitudes a Gemini (Google) y Grok (xAI), sirve el build estatico en produccion.
3. **Ollama / OpenClaw locales** — inferencia en el dispositivo accedida directamente via el proxy de Vite en desarrollo, o directamente via `localhost` en produccion.

```
Navegador (React)
  │
  ├─ /api/gemini   ──► Proxy Node :8787 ──► api.googleapis.com
  ├─ /api/grok     ──► Proxy Node :8787 ──► api.x.ai
  ├─ /api/openclaw ──► Proxy Node :8787 ──► localhost:18789
  └─ /api/ollama   ──► Proxy Vite        ──► localhost:11434
```

---

## Estructura del frontend

| Archivo / Directorio | Responsabilidad |
|---|---|
| `src/App.tsx` | Componente raiz. Mantiene todo el estado del diagrama, gestiona pestanas, chat, orquestacion de IA, import/export y persistencia en localStorage. |
| `src/components/Canvas/Canvas.tsx` | Lienzo SVG. Renderiza todos los nodos ER, conectores, cajas de agregacion, etiquetas de cardinalidad, etiquetas de rol y marcadores de participacion. Maneja drag, click y multi-seleccion. |
| `src/components/Views/RelationalSchemaView.tsx` | Renderiza el esquema relacional derivado automaticamente como lista de tablas con insignias PK/FK. |
| `src/components/Views/SQLView.tsx` | Renderiza sentencias `CREATE TABLE` con resaltado de sintaxis y boton de copiar. |
| `src/components/Properties/` | Panel de propiedades inline. Se abre automaticamente al seleccionar un nodo. |
| `src/components/Toolbar/` | Barra de herramientas con botones de creacion de nodos, controles de exportacion y selector de vista. |
| `src/components/ContextMenu/` | Menu contextual con clic derecho para operaciones del lienzo. |
| `src/components/Shapes/NodeDispatcher.tsx` | Despacha el renderizado SVG al componente de forma correcto segun el tipo de nodo. |
| `src/hooks/useLocalStorage.ts` | Hook generico para leer y escribir en localStorage con seguridad de tipos. |
| `src/hooks/useContextMenu.ts` | Hook que gestiona el estado de apertura/cierre y la posicion del menu contextual. |
| `src/utils/chatParser.ts` | Parsea comandos de chat en lenguaje natural a objetos `DiagramCommand` estructurados. |
| `src/utils/aiCommands.ts` | Aplica los comandos parseados al estado del diagrama (agregar entidad, agregar atributo, conectar, eliminar, etc.). |
| `src/utils/diagram.ts` | Utilidades puras del diagrama: ubicacion de nodos, escaneo de espacios libres, calculos de bounding box. |
| `src/utils/relationalSchema.ts` | Deriva un `RelationalSchema` desde el estado del diagrama (algoritmo Ramez y Navathe Cap. 9). |
| `src/utils/json.ts` | Serializa/deserializa `DiagramSnapshot` con validacion de esquema. |
| `src/utils/schemas.ts` | Esquemas Zod para `DiagramSnapshot` y tipos relacionados. |
| `src/utils/ids.ts` | Genera IDs unicos de nodos y conexiones via nanoid. |
| `src/types/er.ts` | Todas las definiciones de tipos del dominio. |

---

## Sistema de vistas multiples

La app muestra tres pestanas sobre el mismo estado del diagrama:

1. **Diagrama ER** — el lienzo interactivo (siempre la fuente de verdad).
2. **Esquema Relacional** — calculado bajo demanda desde `relationalSchema.ts`. Se muestra como lista de tablas con estilos. Las insignias de origen indican como se derivo cada tabla.
3. **SQL DDL** — generado a partir del esquema relacional por `SQLView.tsx`. Renderiza bloques `CREATE TABLE` con restricciones `PRIMARY KEY`, `FOREIGN KEY` y `NOT NULL`. Copiar al portapapeles usa la Clipboard API.

Cambiar de pestana no muta el estado del diagrama. El esquema relacional y el SQL se re-derivan siempre del diagrama actual.

---

## Tipos del dominio (`src/types/er.ts`)

```
ERNode = EntityNode | RelationshipNode | AttributeNode | ISANode

EntityNode      { isWeak: boolean }
RelationshipNode{ isIdentifying: boolean }
AttributeNode   { isKey, isMultivalued, isDerived, parentId? }
ISANode         { isDisjoint, isTotal }

Connection      { sourceId, targetId, cardinality?, isTotalParticipation, role? }
Aggregation     { id, memberIds[], padding?, label? }
DiagramSnapshot { version, nodes[], aggregations[], connections[], view? }
```

Valores de cardinalidad: `'1' | 'N' | 'M'`.

---

## Proxy de IA (`server/gemini-server.js`)

### Endpoints

| Metodo | Ruta | Descripcion |
|---|---|---|
| `POST` | `/api/gemini/health` | Verifica validez de la API key de Gemini |
| `POST` | `/api/gemini/models` | Lista los modelos Gemini disponibles |
| `POST` | `/api/gemini` | Envia prompt a Gemini, devuelve texto de respuesta |
| `POST` | `/api/grok/health` | Verifica validez de la API key de Grok/xAI |
| `POST` | `/api/grok/models` | Lista los modelos Grok disponibles |
| `POST` | `/api/grok` | Envia prompt a Grok, devuelve texto de respuesta |
| `POST` | `/api/openclaw/health` | Verifica estado del endpoint local de OpenClaw |
| `POST` | `/api/openclaw/models` | Lista los modelos de OpenClaw |
| `POST` | `/api/openclaw` | Envia prompt a OpenClaw |
| `POST` | `/api/rooms` | Crea o une a una sala de colaboracion WebSocket |
| `GET` | `/health` | Health check del servidor (usado por Docker HEALTHCHECK) |

### Comportamiento de seguridad
- Carga `.env` al iniciar; las variables de entorno establecidas antes del lanzamiento tienen prioridad.
- El servicio de archivos estaticos normaliza y sanea la ruta de la solicitud para prevenir path traversal.
- Las API keys se leen del cuerpo de la solicitud (enviadas desde el frontend) y nunca se registran en logs.
- Los errores HTTP de los proveedores upstream se propagan con sus codigos de estado originales.

---

## Configuracion del proxy de Vite (`vite.config.ts`)

En desarrollo, el servidor de desarrollo de Vite hace proxy de estas rutas:

| Prefijo | Destino |
|---|---|
| `/api/gemini` | `http://127.0.0.1:8787` |
| `/api/grok` | `http://127.0.0.1:8787` |
| `/api/openclaw` | `http://127.0.0.1:8787` |
| `/api/ollama` | `http://127.0.0.1:11434/api` |

En produccion el servidor Node maneja todas las rutas `/api/*` y tambien sirve el directorio `dist/` generado.

---

## Flujo de IA

```
Usuario envia prompt
  │
  ├─ Frontend valida: proveedor seleccionado, modelo seleccionado, key presente
  │
  ├─ Solicitud enviada al proveedor primario via proxy
  │
  ├─ Si hay error → fallback automatico al siguiente proveedor conectado
  │
  ├─ Respuesta parseada:
  │    ├─ Comando simple  → chatParser.ts → aiCommands.ts → mutacion de estado
  │    └─ Escenario completo → JSON con entities/relationships/isa/aggregations
  │                             → validacion → saneamiento → mutacion de estado en lote
  │
  └─ Si la validacion falla → etapa de reparacion asistida por IA re-envia al proveedor
```

Las sugerencias de modelado persistidas (de errores pasados) se inyectan en el prompt del sistema antes de cada solicitud para que el modelo evite los errores observados anteriormente.

---

## Algoritmo de esquema relacional (`src/utils/relationalSchema.ts`)

Basado en Ramez Elmasri y Shamkant Navathe, *Fundamentos de Sistemas de Bases de Datos*, Cap. 9 (mapeo ER a relacional).

Pasos aplicados en orden:

1. **Entidades fuertes** — una tabla por entidad; los atributos clave se convierten en `PRIMARY KEY`; los atributos derivados se omiten.
2. **Entidades debiles** — la tabla incluye la PK del propietario como `FOREIGN KEY`; PK compuesta = PK del propietario + clave parcial.
3. **Relaciones 1:N** — FK agregada a la tabla de la entidad del lado N; participacion total genera `NOT NULL`.
4. **Relaciones M:N** — nueva tabla de union con FKs de ambos lados; PK compuesta.
5. **Relaciones 1:1** — FK agregada al lado de participacion total, o a cualquier lado si ambos son parciales.
6. **Jerarquias ISA** — una tabla por subtipo que contiene la PK del supertipo como PK y FK; insignia de origen: `isa-subtype`.
7. **Atributos multivaluados** — tabla separada con la PK del propietario como FK; PK compuesta = PK del propietario + valor del atributo; insignia de origen: `multivalued`.

Se emiten advertencias para: entidades sin atributo clave (se genera una columna sintetica `id_<entidad>`) y participantes de relacion no resolvibles.

---

## Persistencia

Todo el estado se mantiene en memoria en React y se persiste en `localStorage`:

| Clave | Contenido |
|---|---|
| `derup_snapshot` | `DiagramSnapshot` completo (nodos, conexiones, agregaciones, vista) |
| `derup_presets` | Presets de atributos editables |
| `derup_hints` | Sugerencias de errores de modelado de IA (inyectadas en prompts futuros) |
| `derup_keys` | API keys ingresadas en la UI (nunca se envian a git) |

La importacion/exportacion JSON usa `DiagramSnapshot` con validacion Zod al importar para rechazar archivos malformados.

---

## Suite de tests

Ejecutar con `npm run test`. Los 204 tests deben pasar antes de hacer merge.

| Archivo | Que se cubre |
|---|---|
| `src/utils/chatParser.test.ts` | Parseo de comandos de chat: agregar entidad, agregar atributo, conectar, eliminar, casos borde |
| `src/utils/aiCommands.test.ts` | Aplicacion de comandos al estado del diagrama |
| `src/utils/ids.test.ts` | Unicidad y formato de generacion de IDs |
| `src/utils/json.test.ts` | Serializacion de DiagramSnapshot y validacion Zod |
| `src/utils/schemas.test.ts` | Casos de aceptacion y rechazo de esquemas Zod |
| `src/components/Canvas/Canvas.helpers.test.ts` | Helpers de geometria del Canvas, ubicacion de espacios libres |
| `src/hooks/useLocalStorage.test.ts` | Comportamiento de lectura/escritura/defaults |
| `src/hooks/useContextMenu.test.ts` | Estado de apertura/cierre/posicion |

---

## Notas de produccion

La imagen de produccion se construye con Docker multi-stage:

1. Stage `build` — ejecuta `npm ci` + `npm run build`, produce `dist/`.
2. Stage `runtime` — instala solo dependencias de produccion, copia `server/` y `dist/`, corre como usuario no root `appuser`.

El servidor Node sirve el directorio `dist/` para todas las rutas que no son de API (fallback SPA). El endpoint `/health` es usado por el `HEALTHCHECK` de Docker.

Variables de entorno en runtime:

| Variable | Default | Descripcion |
|---|---|---|
| `PORT` | `8080` | Puerto HTTP en el que escucha el servidor |
| `HOST` | `0.0.0.0` | Direccion de bind (todas las interfaces cuando se establece `PORT`) |
| `GEMINI_API_KEY` | — | Opcional; puede proporcionarse por solicitud desde la UI |
| `XAI_API_KEY` | — | Opcional; puede proporcionarse por solicitud desde la UI |
| `NODE_ENV` | `production` | Establecido automaticamente por el Dockerfile |
