# derup — Modelador ER/EER

Modelador visual academico para diagramas entidad-relacion y entidad-relacion extendido. Creado para la catedra de **Base de Datos** de la carrera de **Ingenieria en Sistemas de Informacion** en la **UTN Facultad Regional Resistencia (UTN FRRe)**.

---

## Funcionalidades

### Lienzo y elementos del diagrama
- Entidades: fuertes y debiles (doble rectangulo)
- Relaciones: regulares e identificantes (doble rombo)
- Atributos: simples, clave (subrayado), multivaluados (doble ovalo), derivados (ovalo punteado)
- Jerarquias ISA: disjunto/solapado, cobertura total/parcial
- Agregaciones: agrupamiento semantico representado con caja punteada
- Conexiones con etiquetas de cardinalidad (1, N, M), participacion total/parcial (linea gruesa) y etiquetas de rol

### Pestanas de vistas multiples
- **Diagrama ER**: lienzo interactivo
- **Esquema Relacional**: tablas derivadas automaticamente con anotaciones PK/FK, PKs compuestas, tablas de subtipos ISA y etiquetas de origen (entity / relationship / multivalued / isa-subtype)
- **SQL DDL**: sentencias `CREATE TABLE` con resaltado de sintaxis y boton de copiar al portapapeles

### Exportacion
- Exporta la vista activa como PNG o PDF (html2canvas + jsPDF)

### Modelado asistido por IA
- Comandos en lenguaje natural (espanol) para agregar, editar, eliminar y conectar entidades, relaciones y atributos
- Entrada de escenario completo: pega un enunciado de requisitos y obtiene un diagrama ER completo generado en un solo paso
- Soporte multi-proveedor de IA: **Gemini** (Google AI Studio), **Grok** (xAI), **Ollama** (local), **OpenClaw**
- Verificacion de conectividad por proveedor y fallback automatico al siguiente disponible
- La IA aprende de los errores de modelado: los comandos fallidos se persisten como sugerencias correctivas que se inyectan en los prompts futuros

### Edicion y persistencia
- Panel de propiedades con edicion inline de todos los atributos del nodo; se abre automaticamente al seleccionar un nodo
- Ubicacion inteligente de nodos: los nuevos nodos aparecen en el primer espacio libre del area visible (escaneo de izquierda a derecha)
- Modo multi-seleccion: conectar, eliminar o agrupar nodos seleccionados en una agregacion
- Presets de atributos editables
- Importacion/exportacion JSON
- Snapshot local automatico (localStorage)
- Salas de colaboracion via WebSocket (experimental)

### Tests
- 204 tests automatizados que cubren utils, hooks, helpers del Canvas y validacion de esquemas (Vitest)

---

## Stack tecnico

| Capa | Tecnologia |
|---|---|
| Frontend | React 19, TypeScript strict, Vite 7 |
| Estilos | CSS custom properties |
| Proxy de IA | Node.js (`server/gemini-server.js`) |
| Testing | Vitest 4, @testing-library/react, jsdom |
| Validacion de esquemas | Zod |
| Exportacion | html2canvas, jsPDF |
| IDs | nanoid |
| WebSocket | ws |

---

## Requisitos

- Node.js 20+
- npm 10+
- Opcional: [Ollama](https://ollama.com) instalado localmente para inferencia en el dispositivo

---

## Instalacion

```bash
git clone https://github.com/luiseiman/derup.git
cd derup
npm install
```

---

## Ejecucion en desarrollo

Iniciar el proxy de IA (Gemini / Grok / OpenClaw):
```bash
npm run api
```

Iniciar el servidor de desarrollo del frontend en otra terminal:
```bash
npm run dev
```

Abrir `http://127.0.0.1:5173`.

Ambos procesos deben estar corriendo para que las funcionalidades de IA funcionen. Ollama se accede directamente via el proxy de Vite sin necesidad del servidor Node.

---

## Variables de entorno

Copia `.env.example` a `.env` y completa las keys que quieras precargar:

```bash
# Puerto del proxy de IA local
GEMINI_PORT=8787

# Gemini (Google AI Studio) — opcional si se ingresa en la UI
GEMINI_API_KEY=

# Grok / xAI — opcional si se ingresa en la UI
XAI_API_KEY=
# GROK_API_KEY=   # nombre alternativo, ambos son aceptados
```

Las keys son opcionales en `.env`: si se omiten, podras ingresarlas en el panel de configuracion de la UI. Se almacenan en `localStorage` y nunca se envian a ningun servidor que no sea el proveedor correspondiente.

---

## Ejemplos de comandos de chat

```
agregar una entidad Alumno con atributos: id, nombre, email donde id es clave
agrega atributos: telefono, fecha_nacimiento a la entidad Profesor
vincula la entidad Alumno con la entidad Curso relacion Cursa
eliminar la entidad Alumno
```

Para la generacion de escenarios completos, pega una descripcion completa de requisitos, activa la IA, elige un proveedor y modelo, y la app inferira entidades, relaciones, restricciones y renderizara el modelo completo.

---

## Configuracion de proveedores de IA

| Proveedor | Como obtener la key | Notas |
|---|---|---|
| Gemini | [Google AI Studio](https://aistudio.google.com/app/apikey) — tier gratuito disponible | Key en `.env` como `GEMINI_API_KEY` o en la UI |
| Grok | [xAI Console](https://console.x.ai) | Key en `.env` como `XAI_API_KEY` o en la UI |
| Ollama | Instalar desde [ollama.com](https://ollama.com), ejecutar `ollama serve` | Sin key; acceso via proxy de Vite en `/api/ollama` |
| OpenClaw | Endpoint local en `http://localhost:18789` | Sin key; debe estar corriendo localmente |

---

## Scripts

| Comando | Descripcion |
|---|---|
| `npm run dev` | Iniciar servidor de desarrollo Vite |
| `npm run api` | Iniciar servidor proxy de IA |
| `npm run build` | Compilacion TypeScript + build de produccion Vite |
| `npm run preview` | Previsualizar build de produccion localmente |
| `npm run lint` | Ejecutar ESLint |
| `npm run format` | Ejecutar Prettier sobre los archivos src |
| `npm run test` | Ejecutar suite de tests (Vitest) |
| `npm run test:watch` | Ejecutar tests en modo watch |

---

## Contribuciones

Ver [docs/CONTRIBUTING.es.md](docs/CONTRIBUTING.es.md).

---

## Seguridad

- **API keys**: nunca hardcodear keys en el codigo fuente. Usar `.env` (en .gitignore) o el input de la UI. Las keys ingresadas en la UI se almacenan solo en el `localStorage` del navegador.
- **Exclusiones de git**: los archivos `.env`, `*.key` y `*.pem` estan excluidos via `.gitignore`. Si una key se commitea accidentalmente, revocarla y rotarla de inmediato.
- **Servidor**: el proxy Node incluye proteccion contra path traversal en el servicio de archivos estaticos y corre como usuario sin privilegios root en Docker.
- **Docker**: la imagen de produccion corre como usuario no root (`appuser`) y usa `--omit=dev` para excluir dependencias de desarrollo.

---

## Licencia

Este proyecto es open source bajo la [Licencia MIT](LICENSE).
