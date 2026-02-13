import type {
  Aggregation,
  Cardinality,
  Connection,
  DiagramSnapshot,
  DiagramView,
  ERNode,
  NodeType,
  Point,
} from '../types/er';

export const DIAGRAM_VERSION = 1;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPoint = (value: unknown): value is Point =>
  isObject(value) && typeof value.x === 'number' && typeof value.y === 'number';

const isNodeType = (value: unknown): value is NodeType =>
  value === 'entity' || value === 'relationship' || value === 'attribute' || value === 'isa';

const isCardinality = (value: unknown): value is Cardinality =>
  value === '1' || value === 'N' || value === 'M';

const normalizeNode = (value: unknown): ERNode | null => {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (!isNodeType(value.type)) return null;
  if (!isPoint(value.position)) return null;
  if (typeof value.label !== 'string') return null;

  const base = {
    id: value.id,
    type: value.type,
    position: value.position,
    label: value.label,
  } as const;

  switch (value.type) {
    case 'entity':
      return {
        ...base,
        type: 'entity',
        isWeak: typeof value.isWeak === 'boolean' ? value.isWeak : false,
      };
    case 'relationship':
      return {
        ...base,
        type: 'relationship',
        isIdentifying: typeof value.isIdentifying === 'boolean' ? value.isIdentifying : false,
      };
    case 'attribute':
      return {
        ...base,
        type: 'attribute',
        isKey: typeof value.isKey === 'boolean' ? value.isKey : false,
        isMultivalued: typeof value.isMultivalued === 'boolean' ? value.isMultivalued : false,
        isDerived: typeof value.isDerived === 'boolean' ? value.isDerived : false,
        parentId: typeof value.parentId === 'string' ? value.parentId : undefined,
      };
    case 'isa':
      return {
        ...base,
        type: 'isa',
        isDisjoint: typeof value.isDisjoint === 'boolean' ? value.isDisjoint : false,
        isTotal: typeof value.isTotal === 'boolean' ? value.isTotal : false,
      };
    default:
      return null;
  }
};

const normalizeConnection = (value: unknown): Connection | null => {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.sourceId !== 'string') return null;
  if (typeof value.targetId !== 'string') return null;

  const cardinality = isCardinality(value.cardinality) ? value.cardinality : undefined;

  return {
    id: value.id,
    sourceId: value.sourceId,
    targetId: value.targetId,
    cardinality,
    isTotalParticipation: typeof value.isTotalParticipation === 'boolean' ? value.isTotalParticipation : false,
    role: typeof value.role === 'string' ? value.role : undefined,
  };
};

const normalizeView = (value: unknown): DiagramView | null => {
  if (!isObject(value)) return null;
  if (typeof value.scale !== 'number') return null;
  if (!isPoint(value.offset)) return null;
  return { scale: value.scale, offset: value.offset };
};

const normalizeAggregation = (value: unknown): Aggregation | null => {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (!Array.isArray(value.memberIds) || !value.memberIds.every(id => typeof id === 'string')) return null;

  return {
    id: value.id,
    memberIds: value.memberIds,
    padding: typeof value.padding === 'number' ? value.padding : undefined,
    label: typeof value.label === 'string' ? value.label : undefined,
  };
};

export const serializeDiagram = (
  nodes: ERNode[],
  aggregations: Aggregation[],
  connections: Connection[],
  view: DiagramView,
): DiagramSnapshot => ({
  version: DIAGRAM_VERSION,
  nodes,
  aggregations,
  connections,
  view,
});

export const parseDiagramSnapshot = (raw: unknown): DiagramSnapshot | null => {
  if (!isObject(raw)) return null;

  const nodesRaw = raw.nodes;
  const aggregationsRaw = raw.aggregations;
  const connectionsRaw = raw.connections;

  if (!Array.isArray(nodesRaw) || !Array.isArray(connectionsRaw)) return null;

  const nodes = nodesRaw.map(normalizeNode).filter((node): node is ERNode => node !== null);
  const aggregations = Array.isArray(aggregationsRaw)
    ? aggregationsRaw.map(normalizeAggregation).filter((agg): agg is Aggregation => agg !== null)
    : [];
  const connections = connectionsRaw
    .map(normalizeConnection)
    .filter((conn): conn is Connection => conn !== null);

  if (nodes.length !== nodesRaw.length || connections.length !== connectionsRaw.length) return null;
  if (Array.isArray(aggregationsRaw) && aggregations.length !== aggregationsRaw.length) return null;

  const view = normalizeView(raw.view);

  return {
    version: typeof raw.version === 'number' ? raw.version : DIAGRAM_VERSION,
    nodes,
    aggregations,
    connections,
    view: view ?? undefined,
  };
};
