/**
 * Pure SVG export for the ER diagram.
 * Generates an SVG string directly from model data — no DOM capture needed.
 * Mirrors the geometry of Canvas.tsx / Shape components exactly.
 */

import type { ERNode, Connection, Aggregation } from '../types/er';

// ── Node sizes (must match Shape components) ────────────────────────────────
const NODE_SIZE: Record<string, { w: number; h: number }> = {
  entity:       { w: 100, h: 50 },
  relationship: { w: 100, h: 60 },
  attribute:    { w: 80,  h: 40 },
  isa:          { w: 70,  h: 60 },
};

function nodeSize(type: string) {
  return NODE_SIZE[type] ?? { w: 80, h: 40 };
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

type Pt = { x: number; y: number };

function boundaryPoint(node: ERNode, ux: number, uy: number): Pt {
  const ax = Math.abs(ux);
  const ay = Math.abs(uy);
  switch (node.type) {
    case 'entity': {
      const halfW = 50, halfH = 25;
      const t = ax === 0 ? halfH / ay : ay === 0 ? halfW / ax : Math.min(halfW / ax, halfH / ay);
      return { x: node.position.x + ux * t, y: node.position.y + uy * t };
    }
    case 'relationship': {
      const halfW = 50, halfH = 30;
      if (ax === 0 && ay === 0) return node.position;
      const t = ax === 0 ? halfH / ay : ay === 0 ? halfW / ax : 1 / (ax / halfW + ay / halfH);
      return { x: node.position.x + ux * t, y: node.position.y + uy * t };
    }
    case 'attribute': {
      const rx = 40, ry = 20;
      if (ux === 0 && uy === 0) return node.position;
      const t = 1 / Math.sqrt((ux * ux) / (rx * rx) + (uy * uy) / (ry * ry));
      return { x: node.position.x + ux * t, y: node.position.y + uy * t };
    }
    default: {
      const halfW = 35, halfH = 30;
      const t = ax === 0 ? halfH / ay : ay === 0 ? halfW / ax : Math.min(halfW / ax, halfH / ay);
      return { x: node.position.x + ux * t, y: node.position.y + uy * t };
    }
  }
}

type AggBounds = { x: number; y: number; w: number; h: number; cx: number; cy: number };

function aggBoundaryPoint(b: AggBounds, ux: number, uy: number): Pt {
  const ax = Math.abs(ux);
  const ay = Math.abs(uy);
  const halfW = b.w / 2;
  const halfH = b.h / 2;
  const t = ax === 0 ? halfH / ay : ay === 0 ? halfW / ax : Math.min(halfW / ax, halfH / ay);
  return { x: b.cx + ux * t, y: b.cy + uy * t };
}

function calcAggBounds(agg: Aggregation, nodesById: Map<string, ERNode>): AggBounds | null {
  const members = agg.memberIds.map(id => nodesById.get(id)).filter(Boolean) as ERNode[];
  if (members.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const m of members) {
    const s = nodeSize(m.type);
    minX = Math.min(minX, m.position.x - s.w / 2);
    maxX = Math.max(maxX, m.position.x + s.w / 2);
    minY = Math.min(minY, m.position.y - s.h / 2);
    maxY = Math.max(maxY, m.position.y + s.h / 2);
  }
  const pad = typeof agg.padding === 'number' ? agg.padding : 16;
  const x = minX - pad, y = minY - pad;
  const w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Node SVG renderers ────────────────────────────────────────────────────────

function renderEntitySVG(node: ERNode): string {
  const { x, y } = node.position;
  const w = 100, h = 50;
  const x0 = x - w / 2, y0 = y - h / 2;
  const isWeak = (node as { isWeak?: boolean }).isWeak;
  return `
  <rect x="${x0 + 1}" y="${y0 + 1}" width="${w - 2}" height="${h - 2}" fill="white" stroke="#0f172a" stroke-width="1.5"/>
  ${isWeak ? `<rect x="${x0 + 6}" y="${y0 + 6}" width="${w - 12}" height="${h - 12}" fill="none" stroke="#0f172a" stroke-width="1"/>` : ''}
  <text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="bold" font-family="system-ui,sans-serif">${esc(node.label)}</text>`;
}

function renderRelationshipSVG(node: ERNode): string {
  const { x, y } = node.position;
  const w = 100, h = 60;
  const isIdentifying = (node as { isIdentifying?: boolean }).isIdentifying;
  const pts = `${x},${y - h / 2} ${x + w / 2},${y} ${x},${y + h / 2} ${x - w / 2},${y}`;
  const off = 7;
  const ipts = `${x},${y - h / 2 + off * 1.5} ${x + w / 2 - off * 1.5},${y} ${x},${y + h / 2 - off * 1.5} ${x - w / 2 + off * 1.5},${y}`;
  return `
  <polygon points="${pts}" fill="white" stroke="#0f172a" stroke-width="1.5"/>
  ${isIdentifying ? `<polygon points="${ipts}" fill="none" stroke="#0f172a" stroke-width="1"/>` : ''}
  <text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="bold" font-family="system-ui,sans-serif">${esc(node.label)}</text>`;
}

function renderAttributeSVG(node: ERNode): string {
  const { x, y } = node.position;
  const rx = 38, ry = 18;
  const isKey = (node as { isKey?: boolean }).isKey;
  const isMultivalued = (node as { isMultivalued?: boolean }).isMultivalued;
  const isDerived = (node as { isDerived?: boolean }).isDerived;
  const dash = isDerived ? 'stroke-dasharray="4"' : '';
  return `
  <ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="white" stroke="#0f172a" stroke-width="1.5" ${dash}/>
  ${isMultivalued ? `<ellipse cx="${x}" cy="${y}" rx="${rx - 5}" ry="${ry - 5}" fill="none" stroke="#0f172a" stroke-width="1" ${dash}/>` : ''}
  <text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-family="system-ui,sans-serif" ${isKey ? 'text-decoration="underline"' : ''}>${esc(node.label)}</text>`;
}

function renderISASVG(node: ERNode): string {
  const { x, y } = node.position;
  const w = 70, h = 60;
  const pts = `${x},${y - h / 2 + 2} ${x + w / 2 - 2},${y + h / 2 - 2} ${x - w / 2 + 2},${y + h / 2 - 2}`;
  const isDisjoint = (node as { isDisjoint?: boolean }).isDisjoint;
  const isTotal = (node as { isTotal?: boolean }).isTotal;
  const constraint = [isDisjoint ? 'd' : '', isTotal ? 't' : ''].filter(Boolean).join(',');
  return `
  <polygon points="${pts}" fill="white" stroke="#0f172a" stroke-width="2"/>
  <text x="${x}" y="${y - 2}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="bold" font-family="system-ui,sans-serif">${esc(node.label || 'ES')}</text>
  ${constraint ? `<text x="${x}" y="${y + 14}" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="#64748b" font-family="system-ui,sans-serif">${esc(constraint)}</text>` : ''}`;
}

// ── Connection SVG renderer ───────────────────────────────────────────────────

function renderConnectionsSVG(
  connections: Connection[],
  nodesById: Map<string, ERNode>,
  aggBoundsMap: Map<string, AggBounds>
): string {
  const pairKey = (a: string, b: string) => [a, b].sort().join('::');
  const pairCounts: Record<string, number> = {};
  const pairIndex: Record<string, number> = {};
  connections.forEach(c => {
    const k = pairKey(c.sourceId, c.targetId);
    pairCounts[k] = (pairCounts[k] || 0) + 1;
  });

  return connections.map(conn => {
    const srcNode = nodesById.get(conn.sourceId) ?? null;
    const tgtNode = nodesById.get(conn.targetId) ?? null;
    const srcAgg = aggBoundsMap.get(conn.sourceId) ?? null;
    const tgtAgg = aggBoundsMap.get(conn.targetId) ?? null;
    if (!srcNode && !srcAgg) return '';
    if (!tgtNode && !tgtAgg) return '';

    const srcPos = srcNode ? srcNode.position : { x: srcAgg!.cx, y: srcAgg!.cy };
    const tgtPos = tgtNode ? tgtNode.position : { x: tgtAgg!.cx, y: tgtAgg!.cy };

    const dx = tgtPos.x - srcPos.x;
    const dy = tgtPos.y - srcPos.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / len, uy = dy / len;

    const start = srcNode ? boundaryPoint(srcNode, ux, uy) : aggBoundaryPoint(srcAgg!, ux, uy);
    const end   = tgtNode ? boundaryPoint(tgtNode, -ux, -uy) : aggBoundaryPoint(tgtAgg!, -ux, -uy);

    const key = pairKey(conn.sourceId, conn.targetId);
    const isDuplicate = pairCounts[key] > 1;
    if (pairIndex[key] === undefined) pairIndex[key] = 0;
    const myIndex = pairIndex[key]++;

    const isTotalSrc = conn.isTotalParticipation;
    const strokeColor = '#0f172a';
    const strokeW = isTotalSrc ? 4 : 2;

    // Arrow marker for cardinality=1
    let markerEnd = '';
    let markerStart = '';
    if (conn.cardinality === '1') {
      const srcType = srcNode?.type ?? 'entity';
      const tgtType = tgtNode?.type ?? 'entity';
      if (srcType === 'relationship') markerStart = 'marker-start="url(#exp-arrow)"';
      else if (tgtType === 'relationship') markerEnd = 'marker-end="url(#exp-arrow)"';
    }

    let linesSVG = '';

    if (isDuplicate) {
      const px = -uy, py = ux;
      const direction = myIndex === 0 ? 1 : -1;
      const lo = 18;
      const osx = start.x + px * lo * direction, osy = start.y + py * lo * direction;
      const otx = end.x   + px * lo * direction, oty = end.y   + py * lo * direction;
      const cmx = (osx + otx) / 2, cmy = (osy + oty) / 2;
      const co = 55;
      const cx = cmx + px * co * direction, cy = cmy + py * co * direction;
      const pathD = `M ${osx} ${osy} Q ${cx} ${cy} ${otx} ${oty}`;
      linesSVG = `<path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="${strokeW}" ${markerStart} ${markerEnd}/>`;
    } else {
      linesSVG = `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${strokeColor}" stroke-width="${strokeW}" ${markerStart} ${markerEnd}/>`;
    }

    // Cardinality label
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    const labelOffset = 14;
    const cardLabelX = midX + uy * labelOffset;
    const cardLabelY = midY - ux * labelOffset;

    const cardLabel = conn.cardinality
      ? `<text x="${cardLabelX}" y="${cardLabelY}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-family="system-ui,sans-serif" fill="#0f172a">${esc(conn.cardinality)}</text>`
      : '';

    // Role label near source
    const roleX = start.x + (midX - start.x) * 0.25 + uy * labelOffset;
    const roleY = start.y + (midY - start.y) * 0.25 - ux * labelOffset;
    const roleLabel = conn.role
      ? `<text x="${roleX}" y="${roleY}" text-anchor="middle" dominant-baseline="middle" font-size="10" font-family="system-ui,sans-serif" fill="#64748b" font-style="italic">${esc(conn.role)}</text>`
      : '';

    return `<g>${linesSVG}${cardLabel}${roleLabel}</g>`;
  }).join('\n');
}

// ── Main export function ─────────────────────────────────────────────────────

export function generateDiagramSVG(
  nodes: ERNode[],
  connections: Connection[],
  aggregations: Aggregation[]
): string {
  if (nodes.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
      <rect width="400" height="200" fill="#f8f6ff"/>
      <text x="200" y="100" text-anchor="middle" dominant-baseline="middle" font-size="14" fill="#64748b" font-family="system-ui,sans-serif">Empty diagram</text>
    </svg>`;
  }

  const nodesById = new Map(nodes.map(n => [n.id, n]));

  // Build aggregation bounds
  const aggBoundsMap = new Map<string, AggBounds>();
  for (const agg of aggregations) {
    const b = calcAggBounds(agg, nodesById);
    if (b) aggBoundsMap.set(agg.id, b);
  }

  // Bounding box (include node extents + agg boxes)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const s = nodeSize(n.type);
    minX = Math.min(minX, n.position.x - s.w / 2);
    maxX = Math.max(maxX, n.position.x + s.w / 2);
    minY = Math.min(minY, n.position.y - s.h / 2);
    maxY = Math.max(maxY, n.position.y + s.h / 2);
  }
  for (const b of aggBoundsMap.values()) {
    minX = Math.min(minX, b.x);
    maxX = Math.max(maxX, b.x + b.w);
    minY = Math.min(minY, b.y);
    maxY = Math.max(maxY, b.y + b.h);
  }

  const PAD = 40;
  const vbX = minX - PAD;
  const vbY = minY - PAD;
  const vbW = maxX - minX + PAD * 2;
  const vbH = maxY - minY + PAD * 2;

  // Render aggregations
  const aggSVG = Array.from(aggBoundsMap.entries()).map(([id, b]) => {
    const agg = aggregations.find(a => a.id === id);
    return `
    <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="#666" stroke-width="1.5" stroke-dasharray="6 4"/>
    ${agg?.label ? `<text x="${b.x + 6}" y="${b.y - 6}" font-size="12" fill="#666" font-family="system-ui,sans-serif">${esc(agg.label)}</text>` : ''}`;
  }).join('\n');

  // Render connections
  const connSVG = renderConnectionsSVG(connections, nodesById, aggBoundsMap);

  // Render nodes
  const nodesSVG = nodes.map(n => {
    switch (n.type) {
      case 'entity':       return renderEntitySVG(n);
      case 'relationship': return renderRelationshipSVG(n);
      case 'attribute':    return renderAttributeSVG(n);
      case 'isa':          return renderISASVG(n);
      default:             return '';
    }
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg"
  viewBox="${vbX} ${vbY} ${vbW} ${vbH}"
  width="${vbW}" height="${vbH}">
  <defs>
    <marker id="exp-arrow" markerWidth="14" markerHeight="9" refX="14" refY="4.5" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
      <polygon points="0 0, 14 4.5, 0 9" fill="#0f172a"/>
    </marker>
  </defs>
  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#f0edff"/>
  ${aggSVG}
  ${connSVG}
  ${nodesSVG}
</svg>`;
}

// ── PNG download ──────────────────────────────────────────────────────────────

export async function svgToPng(svgString: string, scale = 2): Promise<string> {
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth  * scale;
      canvas.height = img.naturalHeight * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG render failed')); };
    img.src = url;
  });
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
