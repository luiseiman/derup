## 2026-03-24 — OpenClaw proxy + VPS config

- **Learned:** `npm run lint` has pre-existing errors in Canvas.tsx (Math.random in render) and ContextMenu.tsx (prefer-const). These are not introduced by changes to gemini-server.js. The build (`npm run build`) is the authoritative check for TS correctness.
- **Learned:** OpenClaw gateway runs as process `openclaw-gateway` (no dedicated systemd service). Use `kill -HUP <pid>` to reload config after editing openclaw.json. Pid can drift across reboots — always do `ps aux | grep openclaw-gateway` first.
- **Learned:** The openclaw.json `gateway` section needed `"http": {"endpoints": {"chatCompletions": {"enabled": true}}}` — the gateway reloaded cleanly on HUP with no process restart required.
- **Avoid:** Assuming lint clean == build clean. In this project lint has known violations that predate current work.

## 2026-03-24 — AI Command Protocol (structured JSON)

- **Learned:** `updateNode` accepts `Partial<ERNode>` — for attribute-specific updates, use `Partial<AttributeNode>` which is assignable to it. No cast needed.
- **Learned:** `import('./types/er').EntityNode` inline import syntax works fine inside function bodies in App.tsx without adding to the top-level import list.
- **Learned:** The chat handler in App.tsx has TWO local `findEntityByLabel` definitions (around lines 3080 and 3180) inside specific `if (parsed.type === ...)` blocks. The component-level one (line 2336) is different. New helpers should go at component level alongside that one.
- **Avoid:** Adding `useCallback` to these helpers — they close over `nodes` and `connections` which are React state, so plain `const` inside the component body works fine and is simpler.

## 2026-03-24 — WebSocket collaboration rooms

- **Learned:** When a spec declares state variables that are only updated but never read in JSX (e.g., `roomPeers`), TS strict mode errors with TS6133 "declared but never read". Remove the state or use it — don't leave it declared.
- **Learned:** `replace_all` on `setRoomPeers(0)` left behind one occurrence that was indented differently — always grep after replace_all to confirm all instances gone.
- **Avoid:** Using `replace_all` when occurrences have different surrounding context; prefer targeted `old_string` with enough context to be unique.

## 2026-03-24 — Unit tests for chatParser / schemas / ids utilities

- **Learned:** `chatParser.ts` fuzzy-match uses `startsWith` before Levenshtein — "debilidad" startsWith "debil" → always triggers hasWeakKeyword. Never assume a longer word won't match a shorter keyword.
- **Learned:** `extractAttributesForExistingEntity` does NOT strip "de <EntityName> a" or "de esta entidad con" from the front — replace-attributes gets raw artifacts like `["de Cliente a nombre", "email"]`. Test for the clean trailing items, not the first artifact.
- **Learned:** `clear-diagram` requires both deleteIntent AND the word "todo" in the text. "reset" alone and "borrar el diagrama completo" (without "todo") both return null.
- **Learned:** `"añadir campo email a esta entidad"` — "campo email a esta entidad" gets parsed but the extractor returns an empty attributes list because "a esta entidad" is the entity reference, not stripped from the attribute segment.
- **Avoid:** Asserting parser output shape based on spec descriptions alone — always run the parser with `node --input-type=module` to verify actual output before writing assertions.

## 2026-03-24 — Documentation rewrite (README + docs/)

- **Learned:** Writing markdown files triggers the "file not read yet" guard even for files that exist. Always `Read` first even for docs that will be fully overwritten.
- **Learned:** `docs/` already had ARCHITECTURE/CONTRIBUTING/DEPLOY_GCP files — the new DEPLOY.en/es.md files were net-new (no prior read required), so `Write` worked directly.
- **Avoid:** Assuming a documentation file doesn't exist just because it wasn't in the recent git log — always check with `ls` first.

## 2026-03-24 — Unit tests for hooks and Canvas helpers

- **Learned:** `src/utils/chatParser.test.ts` has 7 pre-existing failures — not introduced by new work. Don't try to fix them unless explicitly asked.
- **Learned:** `isValidConnection` in Canvas.tsx does NOT include `relationship-isa` pairs in validPairs — the spec description was wrong. Always verify actual code rather than trusting spec comments for validation rules.
- **Learned:** For `renderHook` + `useEffect` tests: after the initial `renderHook()` call, an `await act(async () => {})` is needed to flush the initialization effect before asserting state. Without it, the deserialized value may not have been applied yet.
- **Learned:** `vi.useFakeTimers()` must be set in `beforeEach` and restored with `vi.useRealTimers()` in `afterEach` — not at module level — to avoid leaking fake timers into unrelated test files.
- **Avoid:** Importing the Canvas React component to test pure math functions — copy the pure functions verbatim into the test file as local helpers instead.
