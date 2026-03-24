# Docker Deployment

This guide covers deploying derup as a self-hosted Docker container. The production image bundles the Node.js AI proxy and the built React frontend into a single service.

---

## 1. Build the Docker image

From the repository root:

```bash
docker build -t derup:latest .
```

The Dockerfile uses a two-stage build:
- Stage `build`: installs all dependencies and produces the `dist/` directory via `npm run build`.
- Stage `runtime`: installs only production dependencies, copies `server/` and `dist/`, and runs as a non-root user.

---

## 2. Environment variables

Create an environment file (e.g. `derup.env`) on the host. Do not commit this file.

```bash
# HTTP port the server will listen on
PORT=8080

# Gemini (Google AI Studio) — optional if users enter keys in the UI
GEMINI_API_KEY=your_gemini_key_here

# Grok / xAI — optional if users enter keys in the UI
XAI_API_KEY=your_xai_key_here
```

All variables are optional at the server level. If omitted, users can enter their own keys in the UI settings panel, where keys are stored in browser `localStorage` and passed per-request to the proxy.

---

## 3. Run the container

```bash
docker run -d \
  --name derup \
  --network host \
  --env-file /path/to/derup.env \
  --restart unless-stopped \
  derup:latest
```

With `--network host`, the container uses the host network stack. This allows the server to reach locally running Ollama (`localhost:11434`) and OpenClaw (`localhost:18789`) without additional configuration.

If you prefer a bridge network, map the port explicitly and note that local Ollama/OpenClaw will not be reachable from the container without extra network configuration.

```bash
docker run -d \
  --name derup \
  -p 8080:8080 \
  --env-file /path/to/derup.env \
  --restart unless-stopped \
  derup:latest
```

---

## 4. Health check

The server exposes a health endpoint used by Docker's `HEALTHCHECK`:

```
GET http://localhost:8080/health
```

Response on success:
```json
{"status": "ok"}
```

You can verify the container is healthy with:

```bash
docker inspect --format='{{.State.Health.Status}}' derup
```

Expected output: `healthy`

---

## 5. Update procedure

Pull the latest code, rebuild the image, and swap the container:

```bash
# On the host, inside the repository directory
git pull

# Rebuild the image
docker build -t derup:latest .

# Stop and remove the old container
docker stop derup
docker rm derup

# Start the new container
docker run -d \
  --name derup \
  --network host \
  --env-file /path/to/derup.env \
  --restart unless-stopped \
  derup:latest
```

Verify the new container is healthy before removing the old one if you need zero-downtime deployment.

---

## Notes

- In production, the Node server handles all `/api/*` routes and serves the `dist/` directory for all other routes (SPA fallback). There is no Vite dev proxy.
- Ollama and OpenClaw are accessed at `localhost` on the host. If using a bridge network, configure `--add-host host.docker.internal:host-gateway` and update the client-side endpoints accordingly.
- Reverse proxy (nginx, Caddy, etc.) in front of the container is recommended for TLS termination and domain binding.
