## 2026-03-24 — OpenClaw proxy + VPS config

- **Learned:** `npm run lint` has pre-existing errors in Canvas.tsx (Math.random in render) and ContextMenu.tsx (prefer-const). These are not introduced by changes to gemini-server.js. The build (`npm run build`) is the authoritative check for TS correctness.
- **Learned:** OpenClaw gateway runs as process `openclaw-gateway` (no dedicated systemd service). Use `kill -HUP <pid>` to reload config after editing openclaw.json. Pid can drift across reboots — always do `ps aux | grep openclaw-gateway` first.
- **Learned:** The openclaw.json `gateway` section needed `"http": {"endpoints": {"chatCompletions": {"enabled": true}}}` — the gateway reloaded cleanly on HUP with no process restart required.
- **Avoid:** Assuming lint clean == build clean. In this project lint has known violations that predate current work.
