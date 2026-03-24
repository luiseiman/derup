import { z } from 'zod';
import type { Cardinality, ERNode, Connection } from '../types/er';

/**
 * Schema de validación para cardinality (1, N, M)
 */
export const CardinalitySchema = z.enum(['1', 'N', 'M'] as const);

/**
 * Schema para validar un punto (x, y)
 */
export const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

/**
 * Schema para validar nodos tipo Entity
 */
export const EntityNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('entity'),
  position: PointSchema,
  label: z.string(),
  isWeak: z.boolean(),
  selected: z.boolean().optional(),
});

/**
 * Schema para validar nodos tipo Relationship
 */
export const RelationshipNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('relationship'),
  position: PointSchema,
  label: z.string(),
  isIdentifying: z.boolean(),
  selected: z.boolean().optional(),
});

/**
 * Schema para validar nodos tipo Attribute
 */
export const AttributeNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('attribute'),
  position: PointSchema,
  label: z.string(),
  isKey: z.boolean(),
  isMultivalued: z.boolean(),
  isDerived: z.boolean(),
  parentId: z.string().optional(),
  selected: z.boolean().optional(),
});

/**
 * Schema para validar nodos tipo ISA
 */
export const ISANodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('isa'),
  position: PointSchema,
  label: z.string(),
  isDisjoint: z.boolean(),
  isTotal: z.boolean(),
  selected: z.boolean().optional(),
});

/**
 * Schema unificado para cualquier tipo de nodo ER
 */
export const ERNodeSchema = z.union([
  EntityNodeSchema,
  RelationshipNodeSchema,
  AttributeNodeSchema,
  ISANodeSchema,
]);

/**
 * Schema para validar conexiones
 */
export const ConnectionSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  cardinality: CardinalitySchema.optional(),
  isTotalParticipation: z.boolean(),
  role: z.string().optional(),
  selected: z.boolean().optional(),
});

/**
 * Schema para validar agregaciones
 */
export const AggregationSchema = z.object({
  id: z.string().min(1),
  memberIds: z.array(z.string().min(1)).min(2),
  padding: z.number().optional(),
  label: z.string().optional(),
});

/**
 * Schema para validar la vista del diagrama
 */
export const DiagramViewSchema = z.object({
  scale: z.number().min(0.1).max(5),
  offset: PointSchema,
});

/**
 * Schema para validar el snapshot completo del diagrama
 */
export const DiagramSnapshotSchema = z.object({
  version: z.number(),
  nodes: z.array(ERNodeSchema),
  aggregations: z.array(AggregationSchema),
  connections: z.array(ConnectionSchema),
  view: DiagramViewSchema.optional(),
});

/**
 * Valida un nodo ER contra el schema
 */
export const validateERNode = (data: unknown): data is ERNode => {
  try {
    ERNodeSchema.parse(data);
    return true;
  } catch {
    return false;
  }
};

/**
 * Valida una conexión contra el schema
 */
export const validateConnection = (data: unknown): data is Connection => {
  try {
    ConnectionSchema.parse(data);
    return true;
  } catch {
    return false;
  }
};

/**
 * Valida una cardinality
 */
export const validateCardinality = (value: string): value is Cardinality => {
  try {
    CardinalitySchema.parse(value);
    return true;
  } catch {
    return false;
  }
};

/**
 * Valida un snapshot completo
 */
export const validateDiagramSnapshot = (data: unknown) => {
  try {
    return DiagramSnapshotSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.warn('Diagram snapshot validation error:', error.issues);
    }
    return null;
  }
};

/**
 * Convierte una cardinality string de forma segura
 */
export const safeCardinality = (value: unknown): Cardinality | undefined => {
  if (validateCardinality(value as string)) {
    return value as Cardinality;
  }
  return undefined;
};
