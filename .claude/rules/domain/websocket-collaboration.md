---
globs: "src/App.tsx,server*.js,src/hooks/**"
description: WebSocket collaboration rooms — room lifecycle, sync protocol, state broadcast
domain: er-modeling
last_verified: 2026-03-25
---

# WebSocket Collaboration

## Room Lifecycle
1. `POST /api/rooms` → returns `{ roomId: string }`
2. URL updated with `?room=<roomId>`
3. WebSocket opened: `ws(s)://<host>/?room=<roomId>`
4. On open: push current diagram state as first `update` message (don't wait for server push)
5. On leave: close WS, remove `?room` param from URL

## Sync Message Shape
```json
{ "type": "update", "nodes": [...], "connections": [...], "aggregations": [...] }
```
Sent whenever `nodes`, `connections`, or `aggregations` change while room is active.

## State Variables
- `roomId: string | null` — null when not in a room
- `wsRef: useRef<WebSocket | null>` — stable ref, not state
- Only send when `wsRef.current.readyState === WebSocket.OPEN`

## TS Strict Mode Trap
State variables updated by WS but never read in JSX → TS6133 "declared but never read".
Remove unused state or consume it in JSX — do not leave it declared.

## Server Hardening
Server targets 100+ concurrent users — do not add synchronous blocking operations
in the WebSocket message handler path.
