---
globs: "src/utils/aiCommands.ts,src/utils/chatParser.ts,src/App.tsx"
description: Structured JSON AI command protocol for ER diagram mutations
domain: er-modeling
last_verified: 2026-03-25
---

# AI Command Protocol

## Protocol Shape
AI responses must be a JSON object (single command) or JSON array (batch).
All commands validated via Zod `AICommandSchema` discriminated union on `type`.

## Command Types
| type | key fields |
|------|-----------|
| `add-entity` | entityName, attributes[], keyAttributes[], useDefaultAttributes? |
| `add-attributes` | entityName, attributes[], keyAttributes[] |
| `replace-attributes` | entityName, attributes[], keyAttributes[] |
| `rename-entity` | entityName, newName |
| `connect-entities` | entityA, entityB, relationshipName?, cardinalityA?, cardinalityB?, totalA?, totalB?, roleA?, roleB? |
| `connect-entity-aggregation` | entityName, aggregationEntityA, aggregationEntityB, relationshipName? |
| `set-entity-weakness` | entityName, isWeak |
| `set-cardinality` | entityA, entityB, cardinalityA?, cardinalityB? |
| `set-participation` | entityName, relationshipName, isTotal |
| `set-attribute-type` | entityName, attributeName, isMultivalued?, isDerived?, isKey? |
| `set-connection-role` | entityName, relationshipName, role |
| `create-isa` | supertype, subtypes[], isDisjoint (default true), isTotal (default false), label? |
| `delete-entity` | entityName |
| `delete-relationship` | relationshipName |
| `rename-relationship` | relationshipName, newName |
| `clear-diagram` | (no fields) |
| `chat` | message |

## Parsing Functions
- `parseAICommandJson(text)` — extracts single command object
- `parseAICommandBatch(text)` — extracts array; skips invalid entries, returns null if empty

## Legacy Detection
`isLegacyAICommand(type)` guards backward compat for pre-batch command set.

## App.tsx Helper Rules
- `findEntityByLabel` defined at component level (~line 2336) — do not add duplicates inside `if` blocks
- Avoid `useCallback` on helpers that close over `nodes`/`connections` state — plain `const` suffices
- For `updateNode` with attribute-specific updates: `Partial<AttributeNode>` is assignable without cast
