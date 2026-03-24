import { z } from 'zod';
import { extractJsonObject } from './json';

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
    relationshipName: z.string().optional(),
    cardinalityA: Cardinality.optional(),
    cardinalityB: Cardinality.optional(),
    totalA: z.boolean().optional(),
    totalB: z.boolean().optional(),
    roleA: z.string().optional(),
    roleB: z.string().optional(),
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
]);

export type AICommand = z.infer<typeof AICommandSchema>;

export function parseAICommandJson(text: string): AICommand | null {
  const raw = extractJsonObject(text);
  if (!raw) return null;
  const result = AICommandSchema.safeParse(raw);
  return result.success ? result.data : null;
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
