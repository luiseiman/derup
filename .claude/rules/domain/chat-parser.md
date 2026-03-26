---
globs: "src/utils/chatParser.ts,src/utils/chatParser.test.ts"
description: Natural language chat parser — fuzzy matching, entity/attribute extraction rules
domain: er-modeling
last_verified: 2026-03-25
---

# Chat Parser — Natural Language to ER Commands

## Fuzzy Match Algorithm (fuzzyMatch)
Order of evaluation — short-circuits on first hit:
1. Exact string equality
2. `token.startsWith(keyword)` — catches inflected forms ("debilidad" startsWith "debil" → match)
3. Skip Levenshtein if `keyword.length <= 3`
4. Levenshtein distance <= maxDistance

Implication: longer tokens that share a prefix with a keyword ALWAYS match step 2.
Never assume a longer word won't match a shorter keyword.

## Text Normalization Pipeline
`normalizeForMatch`: NFD decompose → strip combining marks → lowercase
`tokenize`: normalizeForMatch → split on whitespace → stripToken (trim non-alnum edges)

## Attribute Extraction: extractAttributesPart
- Matches `atribut\w*\s*[:−-]?\s*(.+)` first
- Falls back to looking after " con " — strips field-list preamble ("campos:", "siguientes atributos:")
- Stops at "dond\w*", "wher\w*", "siend\w*", "como"
- Returns null if what follows "con" is only "sus atributos" / generic placeholder

## extractAttributesForExistingEntity
Does NOT strip "de <EntityName> a" or "de esta entidad con" preambles.
Returns raw artifacts like `["de Cliente a nombre", "email"]`.
When asserting: test the clean trailing items, not the first artifact.

## clear-diagram Intent
Requires BOTH: deleteIntent AND the literal word "todo" in the text.
"reset" alone → null. "borrar el diagrama completo" (without "todo") → null.

## split-list Parsing
Splits by comma first, then by "y" (Spanish "and") within each segment.

## Verification
Always run `node --input-type=module` to test parser output before writing assertions.
Parser behavior can diverge from spec — read the source, don't trust comments.
