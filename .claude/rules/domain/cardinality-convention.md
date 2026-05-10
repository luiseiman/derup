---
globs: ["*.json", "src/**/*.ts", "src/**/*.tsx"]
description: Cardinality convention used by derup — De Miguel / Piattini (participation), NOT Chen look-across
domain: er-modeling
last_verified: 2026-05-10
---

# Cardinality Convention — Participation (De Miguel / Piattini)

derup follows the **participation convention** (De Miguel, Piattini, Marcos — standard in
Argentine and Spanish CS curricula), NOT the Chen look-across convention.

## Rule

The `cardinality` on a connection `entity → relationship` describes **how many times THAT entity
participates in the relationship** — i.e. how many relationship instances are associated with a
single instance of that entity.

It does NOT describe "how many entities from the other side participate per one entity".

## Worked example

Scenario: "a user has many subscriptions; each subscription belongs to one user".

✅ Correct (participation):
```json
{"sourceId":"e-usuario","targetId":"r-tiene-susc","cardinality":"N"}      // un usuario participa N veces
{"sourceId":"r-tiene-susc","targetId":"e-suscripcion","cardinality":"1"}  // una suscripción participa 1 vez
```

❌ Wrong (look-across — what Elmasri/Navathe or Chen original uses):
```json
{"sourceId":"e-usuario","targetId":"r-tiene-susc","cardinality":"1"}      // mirando desde el otro lado
{"sourceId":"r-tiene-susc","targetId":"e-suscripcion","cardinality":"N"}
```

## How to remember

Read the cardinality as: **"how many times does THIS entity show up in the relationship?"** —
never as "how many of the other side".

For N:M (muchos a muchos): both sides get `N` (or `M`), describing each side's participation.

## When generating models

When writing a derup JSON from a natural-language scenario, for every binary relationship:
1. Decide each entity's participation count from the scenario text.
2. Place that count on the connection touching that entity.
3. Cross-check: read the diagram aloud — "an X has `card_X` Y's, a Y has `card_Y` X's".

## Render

`Canvas.tsx` renders the label at the midpoint of each segment (entity ↔ relationship). The
participation convention makes the label naturally read as belonging to the nearest entity.
Do NOT change the renderer to fix mis-labeled models — fix the JSON instead.
