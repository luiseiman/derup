import { z } from 'zod';
import { extractJsonObject, extractJsonArray } from './json';

const Cardinality = z.enum(['1', 'N', 'M']);

export const AICommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add-entity'),
    entityName: z.string(),
    attributes: z.array(z.string()).default([]),
    keyAttributes: z.array(z.string()).default([]),
    useDefaultAttributes: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('add-attributes'),
    entityName: z.string(),
    attributes: z.array(z.string()).default([]),
    keyAttributes: z.array(z.string()).default([]),
    useDefaultAttributes: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('replace-attributes'),
    entityName: z.string(),
    attributes: z.array(z.string()),
    keyAttributes: z.array(z.string()).default([]),
  }),
  z.object({
    type: z.literal('rename-entity'),
    entityName: z.string(),
    newName: z.string(),
  }),
  z.object({
    type: z.literal('connect-entities'),
    entityA: z.string(),
    entityB: z.string(),
    entityC: z.string().optional(),
    relationshipName: z.string().optional(),
    cardinalityA: Cardinality.optional(),
    cardinalityB: Cardinality.optional(),
    cardinalityC: Cardinality.optional(),
    totalA: z.boolean().optional(),
    totalB: z.boolean().optional(),
    totalC: z.boolean().optional(),
    roleA: z.string().optional(),
    roleB: z.string().optional(),
    roleC: z.string().optional(),
  }),
  z.object({
    type: z.literal('connect-entity-aggregation'),
    entityName: z.string(),
    aggregationEntityA: z.string(),
    aggregationEntityB: z.string(),
    relationshipName: z.string().optional(),
  }),
  z.object({
    type: z.literal('set-entity-weakness'),
    entityName: z.string(),
    isWeak: z.boolean(),
  }),
  z.object({ type: z.literal('clear-diagram') }),
  z.object({
    type: z.literal('set-cardinality'),
    entityA: z.string(),
    entityB: z.string(),
    cardinalityA: Cardinality.optional(),
    cardinalityB: Cardinality.optional(),
  }),
  z.object({
    type: z.literal('set-participation'),
    entityName: z.string(),
    relationshipName: z.string(),
    isTotal: z.boolean(),
  }),
  z.object({
    type: z.literal('set-attribute-type'),
    entityName: z.string(),
    attributeName: z.string(),
    isMultivalued: z.boolean().optional(),
    isDerived: z.boolean().optional(),
    isKey: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('set-connection-role'),
    entityName: z.string(),
    relationshipName: z.string(),
    role: z.string(),
  }),
  z.object({
    type: z.literal('create-isa'),
    supertype: z.string(),
    subtypes: z.array(z.string()),
    isDisjoint: z.boolean().default(true),
    isTotal: z.boolean().default(false),
    label: z.string().optional(),
  }),
  z.object({ type: z.literal('delete-entity'), entityName: z.string() }),
  z.object({ type: z.literal('delete-relationship'), relationshipName: z.string() }),
  z.object({
    type: z.literal('rename-relationship'),
    relationshipName: z.string(),
    newName: z.string(),
  }),
  z.object({ type: z.literal('chat'), message: z.string() }),
  // Algebra-tab specific: insert a query into the algebra editor and
  // optionally auto-execute it. The chat assistant uses this when the user
  // asks something executable ("listar emp", "filtrar por edad > 30", etc.)
  // instead of explaining how to do it in prose.
  z.object({
    type: z.literal('algebra-query'),
    query: z.string(),
    run: z.boolean().optional(),       // default true
    message: z.string().optional(),    // brief Spanish confirmation
  }),
  // Algebra-tab ABM: data manipulation commands. The user confirms each one
  // before it's applied. Five actions cover full CRUD on the algebra
  // workspace's tables.
  z.object({
    type: z.literal('algebra-data'),
    /** What operation to apply. */
    action: z.enum(['append', 'replace', 'update-row', 'delete-rows', 'create-relation']),
    /** Relation to operate on (existing for the first four actions; created
     *  by 'create-relation'). */
    relation: z.string(),
    /** For 'create-relation': column definitions. */
    columns: z.array(z.object({
      name: z.string(),
      type: z.enum(['number', 'string', 'date', 'boolean']),
    })).optional(),
    /** For append/replace/create-relation: rows to add. Each row is an array
     *  whose values map positionally to the relation's columns. */
    rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).optional(),
    /** For update-row: which row (0-based) and the new values per column. */
    rowIndex: z.number().int().nonnegative().optional(),
    values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    /** For delete-rows: explicit 0-based indices to remove. */
    rowIndices: z.array(z.number().int().nonnegative()).optional(),
    /** Brief Spanish confirmation shown to the user. */
    message: z.string().optional(),
  }),
]);

export type AICommand = z.infer<typeof AICommandSchema>;

export function parseAICommandJson(text: string): AICommand | null {
  const raw = extractJsonObject(text);
  if (!raw) return null;
  const result = AICommandSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function parseAICommandBatch(text: string): AICommand[] | null {
  const raw = extractJsonArray(text);
  if (!raw || raw.length === 0) return null;
  const commands: AICommand[] = [];
  for (const item of raw) {
    const result = AICommandSchema.safeParse(item);
    if (result.success) commands.push(result.data);
  }
  return commands.length > 0 ? commands : null;
}

const LEGACY_TYPES = new Set([
  'add-entity',
  'add-attributes',
  'replace-attributes',
  'rename-entity',
  'connect-entities',
  'connect-entity-aggregation',
  'set-entity-weakness',
  'clear-diagram',
]);

export const isLegacyAICommand = (type: string): boolean => LEGACY_TYPES.has(type);
