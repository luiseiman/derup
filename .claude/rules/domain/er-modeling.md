---
globs: "src/**/*.{ts,tsx}"
description: Core ER modeling type system and node/connection rules
domain: er-modeling
last_verified: 2026-03-25
---

# ER Modeling — Type System

## Node Types
- `entity` — rectangle; `isWeak: true` renders double rectangle
- `relationship` — diamond; `isIdentifying: true` renders double diamond
- `attribute` — oval; `isKey` underline, `isMultivalued` double oval, `isDerived` dashed oval
- `isa` — triangle/hierarchy node; `isDisjoint` vs overlap, `isTotal` vs partial

## Valid Connection Pairs (isValidConnection)
Allowed: `entity-relationship`, `relationship-entity`, `entity-attribute`, `attribute-entity`,
`relationship-attribute`, `attribute-relationship`, `entity-isa`, `isa-entity`.
NOT allowed: `relationship-isa`, same-type pairs.

## Connections
- `cardinality`: `'1' | 'N' | 'M'` — label on the connector line
- `isTotalParticipation`: thick/double line rendering
- `role`: optional role name label on connector

## Self-Relationships
- `connect-entities` with `entityA === entityB` — same entity on both sides
- Canvas renders dual connectors offset to visually distinguish recursive vs identifying

## Aggregations
- Group of entities + relationship treated as a single unit
- `Aggregation.memberIds` lists the participating node IDs
- Connected to external entities via `connect-entity-aggregation`

## DiagramSnapshot Format (persistence)
Fields: `version`, `nodes`, `aggregations`, `connections`, `view?`
Use this shape for localStorage serialization and WebSocket sync payloads.
