# Derup ER Modeler (Espanol)

Aplicacion academica para modelado ER/EER, pensada para dar soporte a docentes y estudiantes de la catedra de **Base de Datos** de la carrera de **Ingenieria en Sistemas de Informacion** de la **UTN - Facultad Regional Resistencia**.

## Objetivo academico
- Facilitar la construccion de diagramas ER en clase, practicas y evaluaciones.
- Permitir que el estudiante modele de forma manual y tambien asistida por IA.
- Reflejar restricciones semanticas del dominio (clave, participacion, roles, jerarquias y agregaciones).

## Funcionalidades
- Lienzo ER con:
  - Entidades, relaciones, atributos.
  - Atributos clave, multivaluados y derivados.
  - Entidad debil y relacion identificante.
  - Cardinalidad y participacion total/parcial.
  - Roles en conexiones.
- Extensiones EER:
  - Jerarquias de clases (ISA, por defecto etiqueta `ES`, editable).
  - Agregaciones.
- Chat de modelado:
  - Comandos naturales para crear/editar entidades y relaciones.
  - Inferencia de atributos (maximo 5 por entidad, incluyendo una clave).
  - Interpretacion de escenarios completos y generacion del modelo.
- Integracion IA multi-proveedor:
  - Gemini.
  - Grok (xAI).
  - Ollama local.
  - Deteccion de conectividad y fallback automatico.
- Persistencia y portabilidad:
  - Snapshot local automatico.
  - Import/Export JSON del diagrama.
  - Presets de atributos editables (alta, baja, modificacion).

## Stack tecnico
- Frontend: React + TypeScript + Vite.
- Proxy local de IA: Node.js (`server/gemini-server.js`) para Gemini y Grok.
- Ollama: consumo local via proxy de Vite (`/api/ollama`).

## Requisitos
- Node.js 20+ (recomendado).
- npm 10+.
- Opcional: Ollama instalado para inferencia local.

## Instalacion
```bash
npm install
```

## Ejecucion en desarrollo
1. Levantar proxy local de IA:
```bash
npm run api
```
2. Levantar frontend:
```bash
npm run dev
```
3. Abrir `http://127.0.0.1:5173`.

## Variables de entorno
Crea un archivo `.env` en la raiz (puedes usar `.env.example`):

```bash
GEMINI_PORT=8787
GEMINI_API_KEY=
XAI_API_KEY=
```

Notas:
- `GEMINI_API_KEY` es opcional si cargas la key en la UI.
- `XAI_API_KEY` (o `GROK_API_KEY`) es opcional si cargas la key en la UI.
- Nunca subas keys reales al repositorio.

## Uso rapido (chat)
Ejemplos:
- `agregar una entidad Alumno con atributos: id, nombre, email donde id es clave`
- `agrega atributos: telefono, fecha_nacimiento a la entidad Profesor`
- `vincula la entidad Alumno con la entidad Curso relacion Cursa`
- `la relacion Supervisa debe relacionar Profesor con una agregacion entre EstudianteGraduado y Proyecto`

Para escenarios completos:
- Pega el enunciado completo.
- Activa IA y elige proveedor/modelo.
- La app intentara inferir entidades, relaciones, restricciones y dibujar el modelo.

## Flujo de trabajo recomendado en catedra
1. Modelado inicial manual en clase.
2. Refinamiento con chat IA (correcciones iterativas).
3. Revision de restricciones en panel Properties.
4. Export JSON para entrega o versionado.

## Scripts
- `npm run dev`: frontend en modo desarrollo.
- `npm run api`: proxy IA local (Gemini/Grok).
- `npm run build`: compilacion de produccion.
- `npm run preview`: previsualizacion del build.
- `npm run lint`: lint de codigo.

## Documentacion complementaria
- [Arquitectura](docs/ARCHITECTURE.es.md)
- [Contribucion](docs/CONTRIBUTING.es.md)
- [Publicar en GitHub](docs/GITHUB_PUBLISH.es.md)

## Licencia
Este proyecto es open source y se distribuye bajo licencia [MIT](LICENSE).
