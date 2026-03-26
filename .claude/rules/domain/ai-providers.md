---
globs: "src/App.tsx,src/*.ts,server*.js"
description: Multi-AI provider integration — Gemini, Grok, Ollama, OpenClaw proxy
domain: er-modeling
last_verified: 2026-03-25
---

# Multi-AI Provider Integration

## Provider Enum
`AIProvider = 'gemini' | 'grok' | 'ollama' | 'openclaw'`

## Connectivity States
`AIConnectivityStatus`: `'unknown' | 'checking' | 'connected' | 'disconnected' | 'missing-key'`
Each provider tracks status + reason string independently.

## Provider APIs
- **Gemini**: `/api/gemini/models` (POST with apiKey) + `/api/gemini/chat`
- **Grok**: `/api/grok/chat` (requires `grokApiKey`)
- **Ollama**: `/api/ollama/tags` (GET, 2 s timeout) + `/api/ollama/chat`
- **OpenClaw**: `/api/openclaw/chat` — proxy to VPS gateway; model in `aiModel` state

## Ollama Notes
- Connectivity check uses 2000 ms timeout
- If model not installed: `ollama pull <model>` — surface this message to the user
- Model list fetched from tags endpoint on connectivity check

## OpenClaw Gateway (VPS)
- Process: `openclaw-gateway` (no systemd)
- Config reload: `kill -HUP <pid>` — always `ps aux | grep openclaw-gateway` for live PID
- Config: `openclaw.json` → `gateway.http.endpoints.chatCompletions.enabled: true`

## Error Handling
`describeAIError(error, provider)` maps normalized error messages to user-friendly strings.
Always include provider context when describing errors — same error string has different causes per provider.

## Fallback Tracking
`lastAIProviderUsed` + `lastAIFallbackFrom` — used to surface which provider answered and why.
