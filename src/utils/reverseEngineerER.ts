// Reverse-engineer an ER diagram from a set of imported CSV-backed relations.
//
// Heuristic approach (no ML, no fancy schema inference) — designed to make a
// reasonable first draft that the user can then refine in the ER tab:
//   1. Each relation becomes an entity.
//   2. Each column becomes an attribute connected to that entity.
//   3. Primary key inferred from column names ("id", "<table>_id", or first
//      column with all-unique non-null values).
//   4. Foreign keys inferred when a column name matches another relation's
//      PK name; a relationship node connects the two entities (cardinality
//      N on the FK side, 1 on the referenced side).

import type {
  AttributeNode, Connection, EntityNode, ERNode, RelationshipNode,
} from '../types/er';
import type { Relation } from './relAlgebra/types';

export interface ReverseEngineerResult {
  nodes: ERNode[];
  connections: Connection[];
  /** Diagnostic info shown to the user (relations seen, PKs detected, FKs found). */
  notes: string[];
}

const CELL_W = 380;
const CELL_H = 420;
const COLS_PER_ROW = 3;
const ATTR_RADIUS_X = 140;
const ATTR_RADIUS_Y = 90;

export function reverseEngineerER(rels: Map<string, Relation>): ReverseEngineerResult {
  const nodes: ERNode[] = [];
  const connections: Connection[] = [];
  const notes: string[] = [];
  let idSeq = 0;
  const mkId = () => `re${++idSeq}`;
  let connSeq = 0;
  const mkConn = () => `rc${++connSeq}`;

  // 1) Multi-pass PK detection that copes with junction tables.
  //
  //    Pass A: name-based PKs ("id", "<table>_id" …). Unambiguous.
  //    Pass B: classify each remaining relation by how many of its columns
  //            also appear in other relations:
  //              · sharedCount == 0 → standalone dimension; first unique
  //                column is PK.
  //              · sharedCount == 1 → dimension that's referenced by other
  //                tables; the single shared column is its PK.
  //              · sharedCount >= 2 → junction/fact table; NO own PK (all
  //                shared columns become foreign keys in step 3).
  //
  //    This is what gets us right answers like:
  //      emp(eid PK, ename, salary)     ← shared = 1 (eid)
  //      dept(did PK, dname, budget)    ← shared = 1 (did)
  //      works(eid FK, did FK, pct_time)← shared = 2, junction, no PK
  const pkByRel = new Map<string, string>();
  for (const [name, rel] of rels) {
    const namedPk = detectPKByName(name, rel);
    if (namedPk) pkByRel.set(name, namedPk);
  }

  // Count columns of each relation that ALSO appear in some other relation.
  const sharedCount = new Map<string, number>();
  for (const [aName, aRel] of rels) {
    let count = 0;
    for (const aCol of aRel.columns) {
      const aColLower = aCol.name.toLowerCase();
      for (const [bName, bRel] of rels) {
        if (bName === aName) continue;
        if (bRel.columns.some(c => c.name.toLowerCase() === aColLower)) { count++; break; }
      }
    }
    sharedCount.set(aName, count);
  }

  for (const [name, rel] of rels) {
    if (pkByRel.has(name)) continue;
    const shared = sharedCount.get(name) ?? 0;
    if (shared === 1) {
      // The shared column IS this relation's PK.
      const sharedCol = rel.columns.find(c => {
        const cLower = c.name.toLowerCase();
        return Array.from(rels.entries()).some(([n, r]) =>
          n !== name && r.columns.some(rc => rc.name.toLowerCase() === cLower));
      });
      if (sharedCol) pkByRel.set(name, sharedCol.name);
    } else if (shared === 0) {
      // Standalone: first unique column.
      const fb = detectPKByUniqueness(rel, new Set());
      if (fb) pkByRel.set(name, fb);
    }
    // shared >= 2 → junction; leave without a PK.
  }

  for (const [name] of rels) {
    if (pkByRel.has(name)) notes.push(`${name}: clave detectada → ${pkByRel.get(name)}`);
    else notes.push(`${name}: sin clave (tabla de unión)`);
  }

  // ── 2) Classify each relation as a DIMENSION (becomes an entity) or a
  //       JUNCTION (becomes a single N:M relationship between the entities
  //       it references). A junction is any relation that didn't get a PK
  //       in step 1 — typically because two or more of its columns point
  //       at other relations' PKs.
  const dimensions = Array.from(rels.keys()).filter(n => pkByRel.has(n));
  const junctions  = Array.from(rels.keys()).filter(n => !pkByRel.has(n));

  // ── 2a) Lay out the entities first (dimensions only). Attributes orbit. ─
  const entityIdByRel = new Map<string, string>();
  const entityCenterByRel = new Map<string, { x: number; y: number }>();
  dimensions.forEach((name, idx) => {
    const rel = rels.get(name)!;
    const cx = 280 + (idx % COLS_PER_ROW) * CELL_W;
    const cy = 280 + Math.floor(idx / COLS_PER_ROW) * CELL_H;
    const entityId = mkId();
    entityIdByRel.set(name, entityId);
    entityCenterByRel.set(name, { x: cx, y: cy });

    nodes.push({
      id: entityId,
      type: 'entity',
      position: { x: cx, y: cy },
      label: name,
      isWeak: false,
    } as EntityNode);

    const pk = pkByRel.get(name);
    const colCount = rel.columns.length || 1;
    rel.columns.forEach((col, ci) => {
      const angle = (Math.PI * 2 * ci) / colCount - Math.PI / 2;
      const ax = Math.round(cx + Math.cos(angle) * ATTR_RADIUS_X);
      const ay = Math.round(cy + Math.sin(angle) * ATTR_RADIUS_Y);
      const aid = mkId();
      nodes.push({
        id: aid,
        type: 'attribute',
        position: { x: ax, y: ay },
        label: col.name,
        isKey: col.name === pk,
        isMultivalued: false,
        isDerived: false,
      } as AttributeNode);
      connections.push({ id: mkConn(), sourceId: entityId, targetId: aid, isTotalParticipation: false });
    });
  });

  /** Detect which dimension a junction column points to. Returns the target
   *  relation name, or null if the column doesn't look like an FK. */
  const fkTargetOf = (colName: string): string | null => {
    const lower = colName.toLowerCase();
    for (const dimName of dimensions) {
      const dimPk = pkByRel.get(dimName);
      const dimLower = dimName.toLowerCase();
      const shapes = [dimPk?.toLowerCase(), `${dimLower}_id`, `${dimLower}id`, `id_${dimLower}`].filter(Boolean) as string[];
      if (shapes.includes(lower)) return dimName;
    }
    return null;
  };

  // ── 2b) Each junction becomes ONE relationship-node with the linked
  //       entities on either side, plus its non-FK columns as attributes of
  //       the relationship itself. ──────────────────────────────────────────
  junctions.forEach(jName => {
    const jRel = rels.get(jName)!;
    const fks: { col: string; target: string }[] = [];
    for (const col of jRel.columns) {
      const target = fkTargetOf(col.name);
      if (target) fks.push({ col: col.name, target });
    }
    if (fks.length < 2) {
      // Doesn't look like a real junction — fall back to treating it as
      // a standalone entity so we don't drop the data.
      notes.push(`${jName}: posible tabla aislada (sin claves foráneas claras), se modela como entidad`);
      const ix = entityIdByRel.size;
      const cx = 280 + (ix % COLS_PER_ROW) * CELL_W;
      const cy = 280 + Math.floor(ix / COLS_PER_ROW) * CELL_H;
      const entityId = mkId();
      entityIdByRel.set(jName, entityId);
      entityCenterByRel.set(jName, { x: cx, y: cy });
      nodes.push({ id: entityId, type: 'entity', position: { x: cx, y: cy }, label: jName, isWeak: false } as EntityNode);
      jRel.columns.forEach((col, ci) => {
        const angle = (Math.PI * 2 * ci) / jRel.columns.length - Math.PI / 2;
        const ax = Math.round(cx + Math.cos(angle) * ATTR_RADIUS_X);
        const ay = Math.round(cy + Math.sin(angle) * ATTR_RADIUS_Y);
        const aid = mkId();
        nodes.push({ id: aid, type: 'attribute', position: { x: ax, y: ay }, label: col.name, isKey: false, isMultivalued: false, isDerived: false } as AttributeNode);
        connections.push({ id: mkConn(), sourceId: entityId, targetId: aid, isTotalParticipation: false });
      });
      return;
    }

    // Center the relationship-node at the centroid of its target entities.
    const centers = fks.map(f => entityCenterByRel.get(f.target)!);
    const cx = Math.round(centers.reduce((s, c) => s + c.x, 0) / centers.length);
    const cy = Math.round(centers.reduce((s, c) => s + c.y, 0) / centers.length);
    const relId = mkId();
    nodes.push({
      id: relId,
      type: 'relationship',
      position: { x: cx, y: cy },
      label: jName,
      isIdentifying: false,
    } as RelationshipNode);

    // Connect every linked entity to the relationship (cardinality N — the
    // standard read for an M:N junction without further constraints).
    fks.forEach(({ target }) => {
      connections.push({
        id: mkConn(),
        sourceId: entityIdByRel.get(target)!,
        targetId: relId,
        cardinality: 'N',
        isTotalParticipation: false,
      });
    });

    // Columns that aren't FKs become attributes OF the relationship.
    const fkCols = new Set(fks.map(f => f.col));
    const attrCols = jRel.columns.filter(c => !fkCols.has(c.name));
    attrCols.forEach((col, i) => {
      const angle = (Math.PI * 2 * i) / Math.max(1, attrCols.length);
      const ax = Math.round(cx + Math.cos(angle) * ATTR_RADIUS_X);
      const ay = Math.round(cy + Math.sin(angle) * ATTR_RADIUS_Y) - 70;
      const aid = mkId();
      nodes.push({
        id: aid,
        type: 'attribute',
        position: { x: ax, y: ay },
        label: col.name,
        isKey: false,
        isMultivalued: false,
        isDerived: false,
      } as AttributeNode);
      connections.push({ id: mkConn(), sourceId: relId, targetId: aid, isTotalParticipation: false });
    });

    notes.push(`relación N:M: ${jName} (${fks.map(f => f.target).join(' ↔ ')})${attrCols.length ? ' — atributos: ' + attrCols.map(c => c.name).join(', ') : ''}`);
  });

  // ── 3) Detect FKs between dimensions (e.g. dept.managerid → emp). These
  //       are binary N:1 relationships. Skip the dimension's own PK and any
  //       column already used by a junction's relationship attribution. ──
  const seenPair = new Set<string>();
  for (const aName of dimensions) {
    const aRel = rels.get(aName)!;
    const aId = entityIdByRel.get(aName)!;
    const aCenter = entityCenterByRel.get(aName)!;
    const aPk = pkByRel.get(aName);
    for (const aCol of aRel.columns) {
      if (aPk && aCol.name === aPk) continue;
      const colLower = aCol.name.toLowerCase();
      for (const bName of dimensions) {
        if (bName === aName) continue;
        const bPk = pkByRel.get(bName);
        const bLower = bName.toLowerCase();
        const fkShapes = [bPk?.toLowerCase(), `${bLower}_id`, `${bLower}id`, `id_${bLower}`].filter(Boolean) as string[];
        if (!fkShapes.includes(colLower)) continue;

        const pairKey = `${aName}::${aCol.name}::${bName}`;
        if (seenPair.has(pairKey)) continue;
        seenPair.add(pairKey);

        const bId = entityIdByRel.get(bName)!;
        const bCenter = entityCenterByRel.get(bName)!;
        const midX = Math.round((aCenter.x + bCenter.x) / 2);
        const midY = Math.round((aCenter.y + bCenter.y) / 2);
        const relId = mkId();
        nodes.push({
          id: relId,
          type: 'relationship',
          position: { x: midX, y: midY },
          label: `${aName}_${bName}`.slice(0, 40),
          isIdentifying: false,
        } as RelationshipNode);
        connections.push({ id: mkConn(), sourceId: aId, targetId: relId, cardinality: 'N', isTotalParticipation: false });
        connections.push({ id: mkConn(), sourceId: relId, targetId: bId, cardinality: '1', isTotalParticipation: false });
        notes.push(`FK: ${aName}.${aCol.name} → ${bName} (${bPk ?? '?'})`);
      }
    }
  }

  return { nodes, connections, notes };
}

/** Pass A: detect PK by column name patterns. Returns null if no obvious
 *  name match — caller decides whether to fall back to uniqueness scan. */
function detectPKByName(name: string, rel: Relation): string | null {
  let pk = rel.columns.find(c => c.name.toLowerCase() === 'id');
  if (pk) return pk.name;
  const lname = name.toLowerCase();
  const candidates = [
    `${lname}_id`,
    `${lname}id`,
    `id_${lname}`,
    `${lname.replace(/s$/, '')}_id`,
  ];
  pk = rel.columns.find(c => candidates.includes(c.name.toLowerCase()));
  return pk?.name ?? null;
}

/** Pass B: fallback uniqueness scan. Skips columns whose name matches another
 *  relation's already-detected PK (those are almost certainly FKs). */
function detectPKByUniqueness(rel: Relation, otherPkNamesLower: Set<string>): string | null {
  if (rel.columns.length === 0 || rel.rows.length <= 1) return null;
  for (let ci = 0; ci < rel.columns.length; ci++) {
    const col = rel.columns[ci];
    if (otherPkNamesLower.has(col.name.toLowerCase())) continue;
    const vals = rel.rows.map(r => r[ci]).filter(v => v !== null && v !== undefined);
    if (vals.length === 0) continue;
    const keys = vals.map(v => v instanceof Date ? v.toISOString() : String(v));
    const unique = new Set(keys);
    if (unique.size === keys.length) return col.name;
  }
  return null;
}
