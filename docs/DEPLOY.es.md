# Despliegue con Docker

Esta guia cubre el despliegue de derup como un contenedor Docker auto-hospedado. La imagen de produccion incluye el proxy Node.js de IA y el frontend React compilado en un unico servicio.

---

## 1. Construir la imagen Docker

Desde la raiz del repositorio:

```bash
docker build -t derup:latest .
```

El Dockerfile usa una construccion multi-stage:
- Stage `build`: instala todas las dependencias y produce el directorio `dist/` via `npm run build`.
- Stage `runtime`: instala solo dependencias de produccion, copia `server/` y `dist/`, y corre como usuario no root.

---

## 2. Variables de entorno

Crear un archivo de entorno (por ejemplo `derup.env`) en el host. No commitear este archivo.

```bash
# Puerto HTTP en el que escuchara el servidor
PORT=8080

# Gemini (Google AI Studio) — opcional si los usuarios ingresan keys en la UI
GEMINI_API_KEY=tu_key_gemini_aqui

# Grok / xAI — opcional si los usuarios ingresan keys en la UI
XAI_API_KEY=tu_key_xai_aqui
```

Todas las variables son opcionales a nivel servidor. Si se omiten, los usuarios pueden ingresar sus propias keys en el panel de configuracion de la UI, donde se almacenan en el `localStorage` del navegador y se envian por solicitud al proxy.

---

## 3. Ejecutar el contenedor

```bash
docker run -d \
  --name derup \
  --network host \
  --env-file /ruta/a/derup.env \
  --restart unless-stopped \
  derup:latest
```

Con `--network host`, el contenedor usa el stack de red del host. Esto permite que el servidor alcance Ollama (`localhost:11434`) y OpenClaw (`localhost:18789`) corriendo localmente sin configuracion adicional.

Si se prefiere una red bridge, mapear el puerto explicitamente y tener en cuenta que Ollama/OpenClaw locales no seran accesibles desde el contenedor sin configuracion de red adicional.

```bash
docker run -d \
  --name derup \
  -p 8080:8080 \
  --env-file /ruta/a/derup.env \
  --restart unless-stopped \
  derup:latest
```

---

## 4. Health check

El servidor expone un endpoint de health check utilizado por el `HEALTHCHECK` de Docker:

```
GET http://localhost:8080/health
```

Respuesta exitosa:
```json
{"status": "ok"}
```

Se puede verificar que el contenedor esta saludable con:

```bash
docker inspect --format='{{.State.Health.Status}}' derup
```

Resultado esperado: `healthy`

---

## 5. Procedimiento de actualizacion

Traer el ultimo codigo, reconstruir la imagen y reemplazar el contenedor:

```bash
# En el host, dentro del directorio del repositorio
git pull

# Reconstruir la imagen
docker build -t derup:latest .

# Detener y eliminar el contenedor anterior
docker stop derup
docker rm derup

# Iniciar el nuevo contenedor
docker run -d \
  --name derup \
  --network host \
  --env-file /ruta/a/derup.env \
  --restart unless-stopped \
  derup:latest
```

Verificar que el nuevo contenedor esta saludable antes de eliminar el anterior si se necesita un despliegue sin downtime.

---

## Notas

- En produccion, el servidor Node maneja todas las rutas `/api/*` y sirve el directorio `dist/` para todas las demas rutas (fallback SPA). No hay proxy de Vite.
- Ollama y OpenClaw se acceden en `localhost` del host. Si se usa una red bridge, configurar `--add-host host.docker.internal:host-gateway` y actualizar los endpoints del cliente en consecuencia.
- Se recomienda un proxy reverso (nginx, Caddy, etc.) frente al contenedor para terminacion TLS y configuracion de dominio.
