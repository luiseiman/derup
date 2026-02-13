export type NodeType = 'entity' | 'relationship' | 'attribute' | 'isa';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface BaseNode {
  id: string;
  type: NodeType;
  position: Point;
  label: string;
  selected?: boolean;
}

export interface EntityNode extends BaseNode {
  type: 'entity';
  isWeak: boolean; // Double rectangle
}

export interface RelationshipNode extends BaseNode {
  type: 'relationship';
  isIdentifying: boolean; // Double diamond
}

export interface AttributeNode extends BaseNode {
  type: 'attribute';
  isKey: boolean; // Underline
  isMultivalued: boolean; // Double oval
  isDerived: boolean; // Dashed oval
  parentId?: string; // ID of the entity or relationship it belongs to
}

export interface ISANode extends BaseNode {
  type: 'isa';
  isDisjoint: boolean; // Disjoint vs overlap
  isTotal: boolean; // Total vs partial
}

export type ERNode = EntityNode | RelationshipNode | AttributeNode | ISANode;

export type Cardinality = '1' | 'N' | 'M';

export interface Aggregation {
  id: string;
  memberIds: string[];
  padding?: number;
  label?: string;
}

export interface Connection {
  id: string;
  sourceId: string;
  targetId: string;
  cardinality?: Cardinality; // Label on line
  isTotalParticipation: boolean; // Thick line or double line
  role?: string; // Role name on line
}

export interface DiagramState {
  nodes: ERNode[];
  connections: Connection[];
}

export interface DiagramView {
  scale: number;
  offset: Point;
}

export interface DiagramSnapshot {
  version: number;
  nodes: ERNode[];
  aggregations: Aggregation[];
  connections: Connection[];
  view?: DiagramView;
}
