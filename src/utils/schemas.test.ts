import { describe, it, expect, vi } from 'vitest';
import {
  CardinalitySchema,
  PointSchema,
  EntityNodeSchema,
  RelationshipNodeSchema,
  AttributeNodeSchema,
  ISANodeSchema,
  ERNodeSchema,
  ConnectionSchema,
  AggregationSchema,
  DiagramViewSchema,
  DiagramSnapshotSchema,
  validateERNode,
  validateConnection,
  validateCardinality,
  validateDiagramSnapshot,
  safeCardinality,
} from './schemas';

// ─── helpers ───────────────────────────────────────────────────────────────

const validEntityNode = () => ({
  id: 'e1',
  type: 'entity' as const,
  position: { x: 0, y: 0 },
  label: 'Cliente',
  isWeak: false,
});

const validRelationshipNode = () => ({
  id: 'r1',
  type: 'relationship' as const,
  position: { x: 10, y: 20 },
  label: 'Trabaja',
  isIdentifying: false,
});

const validAttributeNode = () => ({
  id: 'a1',
  type: 'attribute' as const,
  position: { x: 5, y: 5 },
  label: 'nombre',
  isKey: true,
  isMultivalued: false,
  isDerived: false,
});

const validISANode = () => ({
  id: 'i1',
  type: 'isa' as const,
  position: { x: 15, y: 15 },
  label: 'ISA',
  isDisjoint: true,
  isTotal: false,
});

const validConnection = () => ({
  id: 'c1',
  sourceId: 'e1',
  targetId: 'r1',
  isTotalParticipation: false,
});

const validDiagramSnapshot = () => ({
  version: 1,
  nodes: [validEntityNode()],
  aggregations: [],
  connections: [validConnection()],
});

// ─── CardinalitySchema ──────────────────────────────────────────────────────

describe('CardinalitySchema', () => {
  it.each(['1', 'N', 'M'])('accepts valid cardinality "%s"', (value) => {
    expect(() => CardinalitySchema.parse(value)).not.toThrow();
  });

  it.each(['X', '0', '', 'n', 'm', '1N'])('rejects invalid cardinality "%s"', (value) => {
    expect(() => CardinalitySchema.parse(value)).toThrow();
  });
});

// ─── PointSchema ────────────────────────────────────────────────────────────

describe('PointSchema', () => {
  it('accepts valid point', () => {
    expect(() => PointSchema.parse({ x: 1, y: 2 })).not.toThrow();
  });

  it('rejects point with missing coordinate', () => {
    expect(() => PointSchema.parse({ x: 1 })).toThrow();
  });

  it('rejects point with non-number coordinate', () => {
    expect(() => PointSchema.parse({ x: '1', y: 2 })).toThrow();
  });
});

// ─── EntityNodeSchema ───────────────────────────────────────────────────────

describe('EntityNodeSchema', () => {
  it('accepts a valid entity node', () => {
    expect(() => EntityNodeSchema.parse(validEntityNode())).not.toThrow();
  });

  it('accepts entity with optional selected flag', () => {
    expect(() => EntityNodeSchema.parse({ ...validEntityNode(), selected: true })).not.toThrow();
  });

  it('rejects entity missing required id', () => {
    const { id: _id, ...noId } = validEntityNode();
    expect(() => EntityNodeSchema.parse(noId)).toThrow();
  });

  it('rejects entity with empty id', () => {
    expect(() => EntityNodeSchema.parse({ ...validEntityNode(), id: '' })).toThrow();
  });

  it('rejects entity with wrong type literal', () => {
    expect(() => EntityNodeSchema.parse({ ...validEntityNode(), type: 'relationship' })).toThrow();
  });

  it('rejects entity missing isWeak', () => {
    const { isWeak: _isWeak, ...noWeak } = validEntityNode();
    expect(() => EntityNodeSchema.parse(noWeak)).toThrow();
  });
});

// ─── RelationshipNodeSchema ──────────────────────────────────────────────────

describe('RelationshipNodeSchema', () => {
  it('accepts a valid relationship node', () => {
    expect(() => RelationshipNodeSchema.parse(validRelationshipNode())).not.toThrow();
  });

  it('accepts identifying relationship (isIdentifying: true)', () => {
    expect(() =>
      RelationshipNodeSchema.parse({ ...validRelationshipNode(), isIdentifying: true })
    ).not.toThrow();
  });

  it('rejects relationship missing isIdentifying', () => {
    const { isIdentifying: _id, ...node } = validRelationshipNode();
    expect(() => RelationshipNodeSchema.parse(node)).toThrow();
  });

  it('rejects relationship with wrong type', () => {
    expect(() =>
      RelationshipNodeSchema.parse({ ...validRelationshipNode(), type: 'entity' })
    ).toThrow();
  });
});

// ─── AttributeNodeSchema ────────────────────────────────────────────────────

describe('AttributeNodeSchema', () => {
  it('accepts a valid attribute node with all flags', () => {
    expect(() => AttributeNodeSchema.parse(validAttributeNode())).not.toThrow();
  });

  it('accepts attribute with optional parentId', () => {
    expect(() =>
      AttributeNodeSchema.parse({ ...validAttributeNode(), parentId: 'e1' })
    ).not.toThrow();
  });

  it('accepts attribute without parentId', () => {
    const node = { ...validAttributeNode() };
    delete (node as { parentId?: string }).parentId;
    expect(() => AttributeNodeSchema.parse(node)).not.toThrow();
  });

  it('accepts multivalued and derived flags', () => {
    expect(() =>
      AttributeNodeSchema.parse({ ...validAttributeNode(), isMultivalued: true, isDerived: true })
    ).not.toThrow();
  });

  it('rejects attribute missing isKey', () => {
    const { isKey: _k, ...node } = validAttributeNode();
    expect(() => AttributeNodeSchema.parse(node)).toThrow();
  });

  it('rejects attribute with wrong type', () => {
    expect(() =>
      AttributeNodeSchema.parse({ ...validAttributeNode(), type: 'isa' })
    ).toThrow();
  });
});

// ─── ISANodeSchema ───────────────────────────────────────────────────────────

describe('ISANodeSchema', () => {
  it('accepts a valid ISA node', () => {
    expect(() => ISANodeSchema.parse(validISANode())).not.toThrow();
  });

  it('accepts isDisjoint: false and isTotal: true', () => {
    expect(() =>
      ISANodeSchema.parse({ ...validISANode(), isDisjoint: false, isTotal: true })
    ).not.toThrow();
  });

  it('rejects ISA missing isDisjoint', () => {
    const { isDisjoint: _d, ...node } = validISANode();
    expect(() => ISANodeSchema.parse(node)).toThrow();
  });

  it('rejects ISA missing isTotal', () => {
    const { isTotal: _t, ...node } = validISANode();
    expect(() => ISANodeSchema.parse(node)).toThrow();
  });
});

// ─── ERNodeSchema (union) ────────────────────────────────────────────────────

describe('ERNodeSchema union', () => {
  it('accepts entity type', () => {
    expect(() => ERNodeSchema.parse(validEntityNode())).not.toThrow();
  });

  it('accepts relationship type', () => {
    expect(() => ERNodeSchema.parse(validRelationshipNode())).not.toThrow();
  });

  it('accepts attribute type', () => {
    expect(() => ERNodeSchema.parse(validAttributeNode())).not.toThrow();
  });

  it('accepts isa type', () => {
    expect(() => ERNodeSchema.parse(validISANode())).not.toThrow();
  });

  it('rejects unknown type', () => {
    expect(() => ERNodeSchema.parse({ id: 'x1', type: 'unknown', position: { x: 0, y: 0 }, label: 'x' })).toThrow();
  });
});

// ─── ConnectionSchema ────────────────────────────────────────────────────────

describe('ConnectionSchema', () => {
  it('accepts a valid connection', () => {
    expect(() => ConnectionSchema.parse(validConnection())).not.toThrow();
  });

  it('accepts connection with optional cardinality', () => {
    expect(() =>
      ConnectionSchema.parse({ ...validConnection(), cardinality: 'N' })
    ).not.toThrow();
  });

  it('accepts connection with optional role', () => {
    expect(() =>
      ConnectionSchema.parse({ ...validConnection(), role: 'empleado' })
    ).not.toThrow();
  });

  it('accepts connection with selected flag', () => {
    expect(() =>
      ConnectionSchema.parse({ ...validConnection(), selected: true })
    ).not.toThrow();
  });

  it('rejects invalid cardinality value', () => {
    expect(() =>
      ConnectionSchema.parse({ ...validConnection(), cardinality: 'X' })
    ).toThrow();
  });

  it('rejects connection with empty sourceId', () => {
    expect(() =>
      ConnectionSchema.parse({ ...validConnection(), sourceId: '' })
    ).toThrow();
  });

  it('rejects connection missing isTotalParticipation', () => {
    const { isTotalParticipation: _tp, ...node } = validConnection();
    expect(() => ConnectionSchema.parse(node)).toThrow();
  });
});

// ─── AggregationSchema ───────────────────────────────────────────────────────

describe('AggregationSchema', () => {
  it('accepts valid aggregation with 2 memberIds', () => {
    expect(() =>
      AggregationSchema.parse({ id: 'agg1', memberIds: ['e1', 'e2'] })
    ).not.toThrow();
  });

  it('accepts aggregation with optional padding and label', () => {
    expect(() =>
      AggregationSchema.parse({ id: 'agg1', memberIds: ['e1', 'e2'], padding: 20, label: 'Grupo' })
    ).not.toThrow();
  });

  it('rejects aggregation with fewer than 2 memberIds', () => {
    expect(() =>
      AggregationSchema.parse({ id: 'agg1', memberIds: ['e1'] })
    ).toThrow();
  });

  it('rejects aggregation with empty memberIds array', () => {
    expect(() =>
      AggregationSchema.parse({ id: 'agg1', memberIds: [] })
    ).toThrow();
  });

  it('rejects aggregation with empty string memberId', () => {
    expect(() =>
      AggregationSchema.parse({ id: 'agg1', memberIds: ['e1', ''] })
    ).toThrow();
  });
});

// ─── DiagramViewSchema ───────────────────────────────────────────────────────

describe('DiagramViewSchema', () => {
  it('accepts valid view', () => {
    expect(() => DiagramViewSchema.parse({ scale: 1, offset: { x: 0, y: 0 } })).not.toThrow();
  });

  it('accepts scale at lower bound 0.1', () => {
    expect(() => DiagramViewSchema.parse({ scale: 0.1, offset: { x: 0, y: 0 } })).not.toThrow();
  });

  it('accepts scale at upper bound 5', () => {
    expect(() => DiagramViewSchema.parse({ scale: 5, offset: { x: 0, y: 0 } })).not.toThrow();
  });

  it('rejects scale below 0.1', () => {
    expect(() => DiagramViewSchema.parse({ scale: 0.09, offset: { x: 0, y: 0 } })).toThrow();
  });

  it('rejects scale above 5', () => {
    expect(() => DiagramViewSchema.parse({ scale: 5.01, offset: { x: 0, y: 0 } })).toThrow();
  });

  it('rejects missing offset', () => {
    expect(() => DiagramViewSchema.parse({ scale: 1 })).toThrow();
  });
});

// ─── DiagramSnapshotSchema ───────────────────────────────────────────────────

describe('DiagramSnapshotSchema', () => {
  it('accepts a full valid snapshot', () => {
    expect(() => DiagramSnapshotSchema.parse(validDiagramSnapshot())).not.toThrow();
  });

  it('accepts snapshot with optional view', () => {
    expect(() =>
      DiagramSnapshotSchema.parse({
        ...validDiagramSnapshot(),
        view: { scale: 1.5, offset: { x: 10, y: -5 } },
      })
    ).not.toThrow();
  });

  it('accepts snapshot with multiple node types', () => {
    expect(() =>
      DiagramSnapshotSchema.parse({
        version: 2,
        nodes: [validEntityNode(), validRelationshipNode(), validAttributeNode(), validISANode()],
        aggregations: [{ id: 'agg1', memberIds: ['e1', 'r1'] }],
        connections: [validConnection()],
      })
    ).not.toThrow();
  });

  it('rejects snapshot missing version', () => {
    const { version: _v, ...noVersion } = validDiagramSnapshot();
    expect(() => DiagramSnapshotSchema.parse(noVersion)).toThrow();
  });

  it('rejects snapshot with invalid node in nodes array', () => {
    expect(() =>
      DiagramSnapshotSchema.parse({
        ...validDiagramSnapshot(),
        nodes: [{ id: 'bad', type: 'unknown', position: { x: 0, y: 0 }, label: 'x' }],
      })
    ).toThrow();
  });
});

// ─── validateERNode ──────────────────────────────────────────────────────────

describe('validateERNode', () => {
  it('returns true for valid entity node', () => {
    expect(validateERNode(validEntityNode())).toBe(true);
  });

  it('returns true for valid attribute node', () => {
    expect(validateERNode(validAttributeNode())).toBe(true);
  });

  it('returns false for invalid node (missing type)', () => {
    expect(validateERNode({ id: 'x', position: { x: 0, y: 0 }, label: 'x' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(validateERNode(null)).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(validateERNode({})).toBe(false);
  });
});

// ─── validateConnection ──────────────────────────────────────────────────────

describe('validateConnection', () => {
  it('returns true for valid connection', () => {
    expect(validateConnection(validConnection())).toBe(true);
  });

  it('returns false for invalid connection (missing isTotalParticipation)', () => {
    const { isTotalParticipation: _tp, ...bad } = validConnection();
    expect(validateConnection(bad)).toBe(false);
  });

  it('returns false for null', () => {
    expect(validateConnection(null)).toBe(false);
  });
});

// ─── validateCardinality ────────────────────────────────────────────────────

describe('validateCardinality', () => {
  it.each(['1', 'N', 'M'])('returns true for valid "%s"', (value) => {
    expect(validateCardinality(value)).toBe(true);
  });

  it.each(['X', '0', '', 'n', 'm', 'MN', '1N'])('returns false for invalid "%s"', (value) => {
    expect(validateCardinality(value)).toBe(false);
  });
});

// ─── validateDiagramSnapshot ─────────────────────────────────────────────────

describe('validateDiagramSnapshot', () => {
  it('returns parsed snapshot object for valid input', () => {
    const result = validateDiagramSnapshot(validDiagramSnapshot());
    expect(result).not.toBeNull();
    expect(result?.version).toBe(1);
  });

  it('returns null for invalid input (missing version)', () => {
    const { version: _v, ...bad } = validDiagramSnapshot();
    expect(validateDiagramSnapshot(bad)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(validateDiagramSnapshot(null)).toBeNull();
  });

  it('returns null for completely wrong shape', () => {
    expect(validateDiagramSnapshot({ foo: 'bar' })).toBeNull();
  });

  it('suppresses console.warn (does not throw)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = validateDiagramSnapshot({ invalid: true });
    expect(result).toBeNull();
    warnSpy.mockRestore();
  });
});

// ─── safeCardinality ────────────────────────────────────────────────────────

describe('safeCardinality', () => {
  it('returns "1" for valid input "1"', () => {
    expect(safeCardinality('1')).toBe('1');
  });

  it('returns "N" for valid input "N"', () => {
    expect(safeCardinality('N')).toBe('N');
  });

  it('returns "M" for valid input "M"', () => {
    expect(safeCardinality('M')).toBe('M');
  });

  it('returns undefined for invalid string "X"', () => {
    expect(safeCardinality('X')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(safeCardinality('')).toBeUndefined();
  });

  it('returns undefined for numeric 1', () => {
    expect(safeCardinality(1)).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(safeCardinality(null)).toBeUndefined();
  });
});
