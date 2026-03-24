import type { ERNode, Connection, Aggregation, EntityNode, AttributeNode, RelationshipNode, ISANode } from '../types/er';

// ─── Output types ────────────────────────────────────────────────────────────

export interface RelationalColumn {
  name: string;
  sourceId?: string;   // ID of the originating AttributeNode (undefined for derived FK/PK cols)
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  referencedTable?: string;
  isNullable: boolean;
  isDerived?: boolean;
}

export interface ForeignKeyDef {
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT';
}

export interface RelationalTable {
  name: string;
  sourceId: string;    // ID of the originating ERNode
  columns: RelationalColumn[];
  primaryKey: string[];
  foreignKeys: ForeignKeyDef[];
  source: 'entity' | 'relationship' | 'multivalued' | 'isa-subtype';
  notes?: string[];
}

export interface RelationalSchema {
  tables: RelationalTable[];
  warnings: string[];
}

// ─── Internal helpers ────────────────────────────────────────────────────────

const snake = (label: string) =>
  label.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

/** Return all attribute nodes directly connected to a given parent id */
function getAttrsOf(parentId: string, nodes: ERNode[], connections: Connection[]): AttributeNode[] {
  const attrIds = new Set(
    connections
      .filter(
        (c) =>
          (c.sourceId === parentId || c.targetId === parentId) &&
          (nodes.find((n) => n.id === (c.sourceId === parentId ? c.targetId : c.sourceId))?.type === 'attribute')
      )
      .map((c) => (c.sourceId === parentId ? c.targetId : c.sourceId))
  );
  return nodes.filter((n): n is AttributeNode => n.type === 'attribute' && attrIds.has(n.id));
}

/** Return the PK column names for an entity table (already snake_cased) */
function getPKof(entityLabel: string, nodes: ERNode[], connections: Connection[]): string[] {
  const entity = nodes.find((n) => n.type === 'entity' && n.label === entityLabel);
  if (!entity) return [`id_${snake(entityLabel)}`];
  const attrs = getAttrsOf(entity.id, nodes, connections);
  const keys = attrs.filter((a) => a.isKey).map((a) => snake(a.label));
  return keys.length > 0 ? keys : [`id_${snake(entityLabel)}`];
}

// ─── Main conversion ─────────────────────────────────────────────────────────

export function erToRelationalSchema(
  nodes: ERNode[],
  connections: Connection[],
  aggregations: Aggregation[],
  filterIds?: Set<string>
): RelationalSchema {
  const tables: RelationalTable[] = [];
  const warnings: string[] = [];

  const entities = nodes.filter(
    (n): n is EntityNode =>
      n.type === 'entity' && (!filterIds || filterIds.has(n.id))
  );
  const relationships = nodes.filter(
    (n): n is RelationshipNode =>
      n.type === 'relationship' && (!filterIds || filterIds.has(n.id))
  );
  const isaNodes = nodes.filter(
    (n): n is ISANode =>
      n.type === 'isa' && (!filterIds || filterIds.has(n.id))
  );

  // Mapa: entityId → table name (built as we process entities)
  const entityTableName = new Map<string, string>();

  // ── A & B: Entities (strong and weak) ────────────────────────────────────
  for (const entity of entities) {
    const tName = snake(entity.label);
    entityTableName.set(entity.id, tName);

    const attrs = getAttrsOf(entity.id, nodes, connections);
    const directAttrs = attrs.filter((a) => !a.isMultivalued);
    const keyAttrs = directAttrs.filter((a) => a.isKey && !a.isDerived);
    const otherAttrs = directAttrs.filter((a) => !a.isKey && !a.isDerived);

    const pkCols: string[] =
      keyAttrs.length > 0 ? keyAttrs.map((a) => snake(a.label)) : [`id_${tName}`];

    const columns: RelationalColumn[] = [
      ...keyAttrs.map((a) => ({
        name: snake(a.label),
        sourceId: a.id,
        isPrimaryKey: true,
        isForeignKey: false,
        isNullable: false,
      })),
      ...(keyAttrs.length === 0 ? pkCols.map((col) => ({
        name: col,
        isPrimaryKey: true,
        isForeignKey: false,
        isNullable: false,
      })) : []),
      ...otherAttrs.map((a) => ({
        name: snake(a.label),
        sourceId: a.id,
        isPrimaryKey: false,
        isForeignKey: false,
        isNullable: true,
        isDerived: a.isDerived,
      })),
    ];

    const fks: ForeignKeyDef[] = [];
    const notes: string[] = [];

    // ── B: weak entity — find identifying relationship + owner
    if (entity.isWeak) {
      notes.push('Entidad débil');
      const identRel = relationships.find((r) => {
        if (!r.isIdentifying) return false;
        // Check if this relationship connects to our weak entity
        return connections.some(
          (c) =>
            (c.sourceId === r.id && c.targetId === entity.id) ||
            (c.targetId === r.id && c.sourceId === entity.id)
        );
      });
      if (identRel) {
        // Find the owner entity (the other entity connected to this identifying rel)
        const ownerConn = connections.find(
          (c) =>
            (c.sourceId === identRel.id || c.targetId === identRel.id) &&
            c.sourceId !== entity.id &&
            c.targetId !== entity.id
        );
        const ownerId = ownerConn
          ? ownerConn.sourceId === identRel.id
            ? ownerConn.targetId
            : ownerConn.sourceId
          : null;
        const ownerNode = ownerId ? nodes.find((n) => n.id === ownerId) : null;

        if (ownerNode && ownerNode.type === 'entity') {
          const ownerPKCols = getPKof(ownerNode.label, nodes, connections);
          const ownerTName = snake(ownerNode.label);
          // Add FK cols before other attrs
          const fkCols = ownerPKCols.map((col) => `${col}_${ownerTName}`);
          columns.unshift(
            ...fkCols.map((col) => ({
              name: col,
              isPrimaryKey: true,
              isForeignKey: true,
              referencedTable: ownerTName,
              isNullable: false,
            }))
          );
          // Update pkCols to include owner FK
          pkCols.unshift(...fkCols);
          fks.push({
            columns: fkCols,
            referencedTable: ownerTName,
            referencedColumns: ownerPKCols,
            onDelete: 'CASCADE',
          });
        } else {
          warnings.push(
            `Entidad débil "${entity.label}": no se encontró el owner. Verificar relación identificadora.`
          );
        }
      } else {
        warnings.push(
          `Entidad débil "${entity.label}": sin relación identificadora. Marcá la relación con isIdentifying.`
        );
      }
    }

    tables.push({
      name: tName,
      sourceId: entity.id,
      columns,
      primaryKey: [...new Set(pkCols)],
      foreignKeys: fks,
      source: 'entity',
      notes: notes.length > 0 ? notes : undefined,
    });
  }

  // ── C: Binary relationships ───────────────────────────────────────────────
  for (const rel of relationships) {
    if (rel.isIdentifying) continue; // handled in weak entity block

    // Collect the two entity connections for this relationship
    const relConns = connections.filter(
      (c) =>
        (c.sourceId === rel.id || c.targetId === rel.id) &&
        nodes.find((n) => {
          const otherId = c.sourceId === rel.id ? c.targetId : c.sourceId;
          return n.id === otherId && n.type === 'entity';
        })
    );

    if (relConns.length < 2) {
      // Unary (self) or incomplete — treat as M:N with same entity on both sides handled below
      if (relConns.length === 1) {
        // Self-relationship
        const connA = relConns[0];
        const entityId = connA.sourceId === rel.id ? connA.targetId : connA.sourceId;
        const entityNode = nodes.find((n) => n.id === entityId);
        if (entityNode) {
          const tName = snake(entityNode.label);
          const pkCols = getPKof(entityNode.label, nodes, connections);
          const relAttrs = getAttrsOf(rel.id, nodes, connections).filter((a) => !a.isDerived);
          const relTName = snake(rel.label) || `${tName}_${tName}`;
          const colA = pkCols.map((c) => `${c}_a`);
          const colB = pkCols.map((c) => `${c}_b`);
          tables.push({
            name: relTName,
            sourceId: rel.id,
            columns: [
              ...colA.map((col, i) => ({
                name: col,
                isPrimaryKey: true,
                isForeignKey: true,
                referencedTable: tName,
                isNullable: false,
                _fkRef: pkCols[i],
              })),
              ...colB.map((col, i) => ({
                name: col,
                isPrimaryKey: true,
                isForeignKey: true,
                referencedTable: tName,
                isNullable: false,
                _fkRef: pkCols[i],
              })),
              ...relAttrs.map((a) => ({
                name: snake(a.label),
                sourceId: a.id,
                isPrimaryKey: false,
                isForeignKey: false,
                isNullable: true,
              })),
            ],
            primaryKey: [...colA, ...colB],
            foreignKeys: [
              { columns: colA, referencedTable: tName, referencedColumns: pkCols, onDelete: 'CASCADE' },
              { columns: colB, referencedTable: tName, referencedColumns: pkCols, onDelete: 'CASCADE' },
            ],
            source: 'relationship',
            notes: ['Autorrelación'],
          });
        }
      }
      continue;
    }

    const connA = relConns[0];
    const connB = relConns[1];

    const entityAId = connA.sourceId === rel.id ? connA.targetId : connA.sourceId;
    const entityBId = connB.sourceId === rel.id ? connB.targetId : connB.sourceId;

    const entityA = nodes.find((n) => n.id === entityAId) as EntityNode | undefined;
    const entityB = nodes.find((n) => n.id === entityBId) as EntityNode | undefined;

    if (!entityA || !entityB) continue;

    const cardA = connA.cardinality ?? 'N';
    const cardB = connB.cardinality ?? 'N';

    const relAttrs = getAttrsOf(rel.id, nodes, connections).filter((a) => !a.isDerived);
    const relAttrCols: RelationalColumn[] = relAttrs.map((a) => ({
      name: snake(a.label),
      isPrimaryKey: false,
      isForeignKey: false,
      isNullable: true,
    }));

    const tNameA = snake(entityA.label);
    const tNameB = snake(entityB.label);
    const pkA = getPKof(entityA.label, nodes, connections);
    const pkB = getPKof(entityB.label, nodes, connections);

    // ── M:N ──
    if ((cardA === 'N' || cardA === 'M') && (cardB === 'N' || cardB === 'M')) {
      const junctionName = snake(rel.label) || `${tNameA}_${tNameB}`;
      const fkColsA = pkA.map((c) => `${c}_${tNameA}`);
      const fkColsB = pkB.map((c) => `${c}_${tNameB}`);

      // Avoid duplicate col names if both entities have same pk name
      const finalColsA = fkColsA;
      const finalColsB = fkColsA.some((c, i) => c === fkColsB[i])
        ? pkB.map((c) => `${c}_${tNameB}_b`)
        : fkColsB;

      tables.push({
        name: junctionName,
        sourceId: rel.id,
        columns: [
          ...finalColsA.map((col) => ({
            name: col,
            isPrimaryKey: true,
            isForeignKey: true,
            referencedTable: tNameA,
            isNullable: false,
          })),
          ...finalColsB.map((col) => ({
            name: col,
            isPrimaryKey: true,
            isForeignKey: true,
            referencedTable: tNameB,
            isNullable: false,
          })),
          ...relAttrCols,
        ],
        primaryKey: [...finalColsA, ...finalColsB],
        foreignKeys: [
          { columns: finalColsA, referencedTable: tNameA, referencedColumns: pkA, onDelete: 'CASCADE' },
          { columns: finalColsB, referencedTable: tNameB, referencedColumns: pkB, onDelete: 'CASCADE' },
        ],
        source: 'relationship',
      });
      continue;
    }

    // ── 1:N or 1:1 → inject FK into the N-side or total-participation side ──
    // The FK-receiving entity is on the "many" side
    let fkEntity: EntityNode;
    let fkEntityPK: string[];
    let fkEntityName: string;
    let refEntity: EntityNode;
    let refEntityPK: string[];
    let refEntityName: string;
    let totalParticipation: boolean;

    if (cardA === '1' && (cardB === 'N' || cardB === 'M')) {
      // A=1, B=N → FK goes into B's table
      fkEntity = entityB;
      fkEntityPK = pkB;
      fkEntityName = tNameB;
      refEntity = entityA;
      refEntityPK = pkA;
      refEntityName = tNameA;
      totalParticipation = connB.isTotalParticipation;
    } else if ((cardA === 'N' || cardA === 'M') && cardB === '1') {
      // A=N, B=1 → FK goes into A's table
      fkEntity = entityA;
      fkEntityPK = pkA;
      fkEntityName = tNameA;
      refEntity = entityB;
      refEntityPK = pkB;
      refEntityName = tNameB;
      totalParticipation = connA.isTotalParticipation;
    } else {
      // 1:1 → prefer total-participation side; default to B
      const useBSide = connB.isTotalParticipation || !connA.isTotalParticipation;
      fkEntity = useBSide ? entityB : entityA;
      fkEntityPK = useBSide ? pkB : pkA;
      fkEntityName = useBSide ? tNameB : tNameA;
      refEntity = useBSide ? entityA : entityB;
      refEntityPK = useBSide ? pkA : pkB;
      refEntityName = useBSide ? tNameA : tNameB;
      totalParticipation = useBSide ? connB.isTotalParticipation : connA.isTotalParticipation;
    }

    // Add FK columns to fkEntity's table
    const existingTable = tables.find((t) => t.name === fkEntityName);
    if (existingTable) {
      const fkColNames = refEntityPK.map((col) => `${col}_${refEntityName}`);
      existingTable.columns.push(
        ...fkColNames.map((col) => ({
          name: col,
          isPrimaryKey: false,
          isForeignKey: true,
          referencedTable: refEntityName,
          isNullable: !totalParticipation,
        })),
        ...relAttrCols
      );
      existingTable.foreignKeys.push({
        columns: fkColNames,
        referencedTable: refEntityName,
        referencedColumns: refEntityPK,
        onDelete: totalParticipation ? 'CASCADE' : 'RESTRICT',
      });
    }

    // Suppress unused variable warnings
    void fkEntityPK;
    void fkEntity;
    void refEntity;
  }

  // ── D: ISA hierarchies ────────────────────────────────────────────────────
  for (const isa of isaNodes) {
    // Supertype: entity connected to ISA via connection where ISA is source or target
    // In derup: supertype connects to ISA, ISA connects to subtypes
    // Supertype = entity connected from ISA "above"; subtypes = entities connected "below"
    // Convention: supertype is the entity that ISA has connection FROM (sourceId = entity, targetId = isa)
    // or we detect by looking at which entity has the most connections

    const connectedEntityIds = connections
      .filter(
        (c) =>
          (c.sourceId === isa.id || c.targetId === isa.id) &&
          nodes.find((n) => {
            const otherId = c.sourceId === isa.id ? c.targetId : c.sourceId;
            return n.id === otherId && n.type === 'entity';
          })
      )
      .map((c) => (c.sourceId === isa.id ? c.targetId : c.sourceId));

    if (connectedEntityIds.length < 2) continue;

    // Heuristic: supertype is the first connected entity (lowest index in nodes array)
    const sortedByIndex = connectedEntityIds
      .map((id) => ({ id, idx: nodes.findIndex((n) => n.id === id) }))
      .sort((a, b) => a.idx - b.idx);

    const supertypeId = sortedByIndex[0].id;
    const subtypeIds = sortedByIndex.slice(1).map((x) => x.id);

    const supertypeNode = nodes.find((n) => n.id === supertypeId) as EntityNode | undefined;
    if (!supertypeNode) continue;

    const supertypePK = getPKof(supertypeNode.label, nodes, connections);
    const supertypeTName = snake(supertypeNode.label);

    if (!isa.isDisjoint) {
      warnings.push(
        `Jerarquía ISA "${isa.label || supertypeNode.label}": solapada (overlapping). Una instancia puede pertenecer a múltiples subtipos.`
      );
    }

    for (const subtypeId of subtypeIds) {
      const subtypeNode = nodes.find((n) => n.id === subtypeId) as EntityNode | undefined;
      if (!subtypeNode) continue;

      const subTName = snake(subtypeNode.label);
      const subtypeAttrs = getAttrsOf(subtypeId, nodes, connections).filter(
        (a) => !a.isDerived
      );

      // Check if subtype table already exists (it was created in entities loop)
      const existingSubTable = tables.find((t) => t.name === subTName);

      // Add FK → supertype PK (becomes PK of subtype too)
      const fkCols = supertypePK.map((col) => `${col}`);

      if (existingSubTable) {
        // Mark its PK columns as FK too
        for (const col of fkCols) {
          const existing = existingSubTable.columns.find((c) => c.name === col);
          if (existing) {
            existing.isForeignKey = true;
            existing.referencedTable = supertypeTName;
          } else {
            existingSubTable.columns.unshift({
              name: col,
              isPrimaryKey: true,
              isForeignKey: true,
              referencedTable: supertypeTName,
              isNullable: false,
            });
          }
        }
        existingSubTable.foreignKeys.push({
          columns: fkCols,
          referencedTable: supertypeTName,
          referencedColumns: supertypePK,
          onDelete: 'CASCADE',
        });
        if (!existingSubTable.notes) existingSubTable.notes = [];
        existingSubTable.notes.push(`Subtipo de ${supertypeNode.label}`);
      } else {
        // Subtype entity was filtered out — create a minimal table
        tables.push({
          name: subTName,
          sourceId: subtypeId,
          columns: [
            ...fkCols.map((col) => ({
              name: col,
              isPrimaryKey: true,
              isForeignKey: true,
              referencedTable: supertypeTName,
              isNullable: false,
            })),
            ...subtypeAttrs.map((a) => ({
              name: snake(a.label),
              sourceId: a.id,
              isPrimaryKey: a.isKey,
              isForeignKey: false,
              isNullable: !a.isKey,
            })),
          ],
          primaryKey: fkCols,
          foreignKeys: [
            {
              columns: fkCols,
              referencedTable: supertypeTName,
              referencedColumns: supertypePK,
              onDelete: 'CASCADE',
            },
          ],
          source: 'isa-subtype',
          notes: [`Subtipo de ${supertypeNode.label}`],
        });
      }
    }
  }

  // ── E: Multivalued attributes ─────────────────────────────────────────────
  for (const entity of entities) {
    const attrs = getAttrsOf(entity.id, nodes, connections);
    const multiAttrs = attrs.filter((a) => a.isMultivalued);
    if (multiAttrs.length === 0) continue;

    const entityTName = snake(entity.label);
    const entityPK = getPKof(entity.label, nodes, connections);

    for (const attr of multiAttrs) {
      const attrName = snake(attr.label);
      const mvTName = `${entityTName}_${attrName}`;
      const fkCols = entityPK.map((col) => `${col}_${entityTName}`);

      tables.push({
        name: mvTName,
        sourceId: attr.id,
        columns: [
          ...fkCols.map((col) => ({
            name: col,
            isPrimaryKey: true,
            isForeignKey: true,
            referencedTable: entityTName,
            isNullable: false,
          })),
          {
            name: attrName,
            sourceId: attr.id,
            isPrimaryKey: true,
            isForeignKey: false,
            isNullable: false,
          },
        ],
        primaryKey: [...fkCols, attrName],
        foreignKeys: [
          {
            columns: fkCols,
            referencedTable: entityTName,
            referencedColumns: entityPK,
            onDelete: 'CASCADE',
          },
        ],
        source: 'multivalued',
        notes: [`Atributo multivaluado de ${entity.label}`],
      });
    }
  }

  // ── F: Aggregations ───────────────────────────────────────────────────────
  // Aggregations wrap a relationship. If an external entity connects to the aggregation,
  // that entity gets a FK to the junction table of the wrapped relationship.
  // (Only relevant when the wrapped relationship is M:N and has its own junction table)
  void aggregations; // Used for future extension — complex cases handled via relationship mapping above

  return { tables, warnings };
}

// ─── SQL DDL generation ───────────────────────────────────────────────────────

function colType(col: RelationalColumn): string {
  if (col.isPrimaryKey || col.isForeignKey) return 'INTEGER';
  return 'VARCHAR(255)';
}

export function buildSQLDDL(schema: RelationalSchema): string {
  if (schema.tables.length === 0) return '-- No hay tablas en el modelo.';

  const lines: string[] = [];

  for (const table of schema.tables) {
    if (table.notes && table.notes.length > 0) {
      lines.push(`-- ${table.notes.join(' | ')}`);
    }
    lines.push(`CREATE TABLE ${table.name} (`);

    const colLines: string[] = [];

    for (const col of table.columns) {
      if (col.isDerived) continue;
      const nullable = col.isNullable ? 'NULL' : 'NOT NULL';
      colLines.push(`  ${col.name} ${colType(col)} ${nullable}`);
    }

    if (table.primaryKey.length > 0) {
      colLines.push(`  PRIMARY KEY (${table.primaryKey.join(', ')})`);
    }

    for (const fk of table.foreignKeys) {
      const onDelete = fk.onDelete !== 'RESTRICT' ? ` ON DELETE ${fk.onDelete}` : '';
      colLines.push(
        `  FOREIGN KEY (${fk.columns.join(', ')}) REFERENCES ${fk.referencedTable}(${fk.referencedColumns.join(', ')})${onDelete}`
      );
    }

    lines.push(colLines.join(',\n'));
    lines.push(');\n');
  }

  if (schema.warnings.length > 0) {
    lines.push('-- ADVERTENCIAS:');
    for (const w of schema.warnings) {
      lines.push(`-- ⚠ ${w}`);
    }
  }

  return lines.join('\n');
}
