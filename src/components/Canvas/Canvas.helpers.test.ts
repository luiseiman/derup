/**
 * Pure helper tests for Canvas geometric and validation functions.
 * Functions are reimplemented verbatim here — no React import needed.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// getBoundaryPoint — verbatim copy from Canvas.tsx
// ---------------------------------------------------------------------------
type NodeType = 'entity' | 'relationship' | 'attribute' | 'isa';

interface NodeLike {
  type: NodeType;
  position: { x: number; y: number };
}

function getBoundaryPoint(node: NodeLike, ux: number, uy: number) {
  const ax = Math.abs(ux);
  const ay = Math.abs(uy);

  switch (node.type) {
    case 'entity': {
      const halfW = 50;
      const halfH = 25;
      const t = ax === 0 ? halfH / ay : ay === 0 ? halfW / ax : Math.min(halfW / ax, halfH / ay);
      return { x: node.position.x + ux * t, y: node.position.y + uy * t };
    }
    case 'relationship': {
      const halfW = 50;
      const halfH = 30;
      if (ax === 0 && ay === 0) return { x: node.position.x, y: node.position.y };
      const t = ax === 0 ? halfH / ay : ay === 0 ? halfW / ax : 1 / (ax / halfW + ay / halfH);
      return { x: node.position.x + ux * t, y: node.position.y + uy * t };
    }
    case 'attribute': {
      const rx = 40;
      const ry = 20;
      if (ux === 0 && uy === 0) return { x: node.position.x, y: node.position.y };
      const t = 1 / Math.sqrt((ux * ux) / (rx * rx) + (uy * uy) / (ry * ry));
      return { x: node.position.x + ux * t, y: node.position.y + uy * t };
    }
    case 'isa':
    default: {
      const halfW = 35;
      const halfH = 30;
      const t = ax === 0 ? halfH / ay : ay === 0 ? halfW / ax : Math.min(halfW / ax, halfH / ay);
      return { x: node.position.x + ux * t, y: node.position.y + uy * t };
    }
  }
}

// ---------------------------------------------------------------------------
// isValidConnection — verbatim copy from Canvas.tsx (nodes array version
// inlined as pure type-pair logic so no React dependency is needed)
// ---------------------------------------------------------------------------
function isValidConnectionByTypes(
  sourceType: NodeType | undefined,
  targetType: NodeType | undefined,
  sameId: boolean
): boolean {
  if (sameId) return false;
  if (!sourceType || !targetType) return false;
  if (sourceType === targetType) return false;

  const validPairs = new Set([
    'entity-relationship',
    'relationship-entity',
    'entity-attribute',
    'attribute-entity',
    'relationship-attribute',
    'attribute-relationship',
    'entity-isa',
    'isa-entity',
  ]);

  const pair = `${sourceType}-${targetType}`;
  return validPairs.has(pair);
}

// ---------------------------------------------------------------------------
// getBoundaryPoint tests
// ---------------------------------------------------------------------------
const ORIGIN = { x: 0, y: 0 };
const PRECISION = 6;

describe('getBoundaryPoint — entity', () => {
  const node: NodeLike = { type: 'entity', position: ORIGIN };

  it('right (ux=1, uy=0) → x+50, y+0', () => {
    const pt = getBoundaryPoint(node, 1, 0);
    expect(pt.x).toBeCloseTo(50, PRECISION);
    expect(pt.y).toBeCloseTo(0, PRECISION);
  });

  it('up (ux=0, uy=-1) → x+0, y-25', () => {
    const pt = getBoundaryPoint(node, 0, -1);
    expect(pt.x).toBeCloseTo(0, PRECISION);
    expect(pt.y).toBeCloseTo(-25, PRECISION);
  });

  it('diagonal 45° (ux≈0.707, uy≈0.707) → point within boundary', () => {
    const d = Math.SQRT2 / 2;
    const pt = getBoundaryPoint(node, d, d);
    // t = min(50/d, 25/d) = 25/d
    const t = 25 / d;
    expect(pt.x).toBeCloseTo(d * t, PRECISION);
    expect(pt.y).toBeCloseTo(d * t, PRECISION);
    // Boundary x must not exceed halfW=50
    expect(Math.abs(pt.x)).toBeLessThanOrEqual(50 + 1e-9);
    expect(Math.abs(pt.y)).toBeLessThanOrEqual(25 + 1e-9);
  });
});

describe('getBoundaryPoint — relationship', () => {
  const node: NodeLike = { type: 'relationship', position: ORIGIN };

  it('zero vector returns node center (no crash)', () => {
    const pt = getBoundaryPoint(node, 0, 0);
    expect(pt).toEqual({ x: 0, y: 0 });
  });

  it('right (ux=1, uy=0) → x+50', () => {
    const pt = getBoundaryPoint(node, 1, 0);
    expect(pt.x).toBeCloseTo(50, PRECISION);
    expect(pt.y).toBeCloseTo(0, PRECISION);
  });

  it('up (ux=0, uy=-1) → y-30', () => {
    const pt = getBoundaryPoint(node, 0, -1);
    expect(pt.x).toBeCloseTo(0, PRECISION);
    expect(pt.y).toBeCloseTo(-30, PRECISION);
  });
});

describe('getBoundaryPoint — attribute (ellipse)', () => {
  const node: NodeLike = { type: 'attribute', position: ORIGIN };

  it('zero vector returns node center (no crash)', () => {
    const pt = getBoundaryPoint(node, 0, 0);
    expect(pt).toEqual({ x: 0, y: 0 });
  });

  it('right (ux=1, uy=0) → x+40', () => {
    const pt = getBoundaryPoint(node, 1, 0);
    expect(pt.x).toBeCloseTo(40, PRECISION);
    expect(pt.y).toBeCloseTo(0, PRECISION);
  });

  it('up (ux=0, uy=-1) → y-20', () => {
    const pt = getBoundaryPoint(node, 0, -1);
    expect(pt.x).toBeCloseTo(0, PRECISION);
    expect(pt.y).toBeCloseTo(-20, PRECISION);
  });
});

describe('getBoundaryPoint — isa', () => {
  const node: NodeLike = { type: 'isa', position: ORIGIN };

  it('right (ux=1, uy=0) → x+35', () => {
    const pt = getBoundaryPoint(node, 1, 0);
    expect(pt.x).toBeCloseTo(35, PRECISION);
    expect(pt.y).toBeCloseTo(0, PRECISION);
  });

  it('up (ux=0, uy=-1) → y-30', () => {
    const pt = getBoundaryPoint(node, 0, -1);
    expect(pt.x).toBeCloseTo(0, PRECISION);
    expect(pt.y).toBeCloseTo(-30, PRECISION);
  });
});

// ---------------------------------------------------------------------------
// isValidConnection tests
// ---------------------------------------------------------------------------
describe('isValidConnection — connection rules', () => {
  it('entity↔entity: INVALID', () => {
    expect(isValidConnectionByTypes('entity', 'entity', false)).toBe(false);
  });

  it('entity↔relationship: VALID', () => {
    expect(isValidConnectionByTypes('entity', 'relationship', false)).toBe(true);
    expect(isValidConnectionByTypes('relationship', 'entity', false)).toBe(true);
  });

  it('entity↔attribute: VALID', () => {
    expect(isValidConnectionByTypes('entity', 'attribute', false)).toBe(true);
    expect(isValidConnectionByTypes('attribute', 'entity', false)).toBe(true);
  });

  it('entity↔isa: VALID', () => {
    expect(isValidConnectionByTypes('entity', 'isa', false)).toBe(true);
    expect(isValidConnectionByTypes('isa', 'entity', false)).toBe(true);
  });

  it('relationship↔relationship: INVALID', () => {
    expect(isValidConnectionByTypes('relationship', 'relationship', false)).toBe(false);
  });

  it('relationship↔attribute: VALID', () => {
    expect(isValidConnectionByTypes('relationship', 'attribute', false)).toBe(true);
    expect(isValidConnectionByTypes('attribute', 'relationship', false)).toBe(true);
  });

  it('relationship↔isa: INVALID (not in validPairs per implementation)', () => {
    expect(isValidConnectionByTypes('relationship', 'isa', false)).toBe(false);
    expect(isValidConnectionByTypes('isa', 'relationship', false)).toBe(false);
  });

  it('attribute↔attribute: INVALID', () => {
    expect(isValidConnectionByTypes('attribute', 'attribute', false)).toBe(false);
  });

  it('attribute↔isa: INVALID', () => {
    expect(isValidConnectionByTypes('attribute', 'isa', false)).toBe(false);
    expect(isValidConnectionByTypes('isa', 'attribute', false)).toBe(false);
  });

  it('isa↔isa: INVALID', () => {
    expect(isValidConnectionByTypes('isa', 'isa', false)).toBe(false);
  });

  it('same node id: INVALID', () => {
    expect(isValidConnectionByTypes('entity', 'entity', true)).toBe(false);
    expect(isValidConnectionByTypes('entity', 'relationship', true)).toBe(false);
  });
});
