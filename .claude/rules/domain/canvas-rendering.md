---
globs: "src/components/Canvas/**,src/components/Shapes/**"
description: Canvas rendering patterns — React Flow, connectors, self-relationships, export
domain: er-modeling
last_verified: 2026-03-25
---

# Canvas Rendering

## Architecture
Custom canvas (not React Flow) — SVG-based connectors drawn over positioned div nodes.
`Canvas.tsx` owns: node drag, connection drawing, zoom/pan, selection, context menu.

## Connector Rendering
`getEndpoints(sourceId, targetId)` computes line endpoints from node bounding boxes.
Duplicate connectors between same pair get offset rendering to remain visually distinct.
`pairKey(sourceId, targetId)` normalizes direction for dedup — sort both IDs.

## Self-Relationships (Autorrelaciones)
Same entity on both ends of `connect-entities`.
Rendered as two separate curved connectors to distinguish recursive from identifying.
Fast path in AI prompt handling — separate code path from regular entity-entity connect.

## Total Participation Rendering
`isTotalParticipation: true` → thick/double line in SVG.
SVG export must reproduce this faithfully — html2canvas was replaced with SVG-from-data.

## Canvas Math Helpers (Testing)
Do NOT import Canvas React component to test pure math functions.
Copy the pure functions verbatim as local helpers in the test file — the component has
React side effects that break the Vitest test environment.

## isValidConnection (actual code, not spec)
Valid pairs: entity↔relationship, entity↔attribute, relationship↔attribute, entity↔isa.
`relationship-isa` is NOT a valid pair — spec comments may say otherwise; trust the code.

## Export
`exportSVG.ts` handles SVG-from-data export for PNG/PDF.
