// Dummy row generator for a RelationalTable. Lets the user try queries without
// loading a real CSV. Heuristics over column names produce semi-plausible data.

import type { RelationalTable } from '../relationalSchema';
import type { Column, ColumnType, Relation, Value } from './types';

const NAMES = ['Ana', 'Luis', 'Pedro', 'María', 'Sofía', 'Carlos', 'Lucía', 'Diego', 'Valentina', 'Tomás', 'Camila', 'Mateo'];
const APELLIDOS = ['García', 'Pérez', 'Martínez', 'González', 'López', 'Rodríguez', 'Fernández', 'Sosa', 'Romero', 'Acosta'];
const CIUDADES = ['Buenos Aires', 'Córdoba', 'Rosario', 'Mendoza', 'Resistencia', 'Salta', 'Tucumán', 'La Plata'];
const CATEGORIAS = ['servicios', 'productos', 'electrónica', 'alimentos', 'transporte'];
const ESTADOS = ['activo', 'inactivo', 'pendiente', 'bloqueado'];
const MONEDAS = ['ARS', 'USD', 'EUR', 'BTC'];

let seedCounter = 1;
function nextSeed(): number {
  seedCounter = (seedCounter * 1103515245 + 12345) & 0x7fffffff;
  return seedCounter;
}
function pick<T>(arr: T[]): T { return arr[nextSeed() % arr.length]; }
function randInt(min: number, max: number): number { return min + (nextSeed() % (max - min + 1)); }

function inferColumnType(name: string): ColumnType {
  const n = name.toLowerCase();
  if (/^(id|nro|numero|cantidad|cant|edad|plazo|cuotas|year|año|max|min|volumen)/.test(n)) return 'number';
  if (/(saldo|monto|importe|precio|costo|comision|cft|tna|porcentaje)/.test(n)) return 'number';
  if (/^fecha/.test(n) || /_fecha$/.test(n)) return 'date';
  if (/^(es_|is_|tiene_|activo|completado|cobrado|debito|marcada)/.test(n)) return 'boolean';
  return 'string';
}

function generateValue(name: string, type: ColumnType, rowIdx: number, tableName: string): Value {
  const n = name.toLowerCase();
  switch (type) {
    case 'number':
      if (/^id|_id$/.test(n) || n === 'codigo' || n === 'nro' || n === 'numero') return rowIdx + 1;
      if (/(saldo|monto|importe|precio|costo)/.test(n)) return randInt(100, 100000);
      if (/(tna|cft|porcentaje)/.test(n)) return randInt(1, 99);
      if (/^(cuit|cuil|dni)/.test(n)) return randInt(20000000, 45000000);
      if (/^cvu/.test(n)) return randInt(1, 999999999);
      return randInt(1, 1000);
    case 'date': {
      const base = new Date(2024, 0, 1).getTime();
      const offset = randInt(0, 365 * 2) * 86400000;
      return new Date(base + offset);
    }
    case 'boolean':
      return nextSeed() % 2 === 0;
    case 'string':
    default:
      if (/(nombre|name)/.test(n)) return pick(NAMES);
      if (/(apellido|surname)/.test(n)) return pick(APELLIDOS);
      if (/(direccion|domicilio|localidad|ciudad)/.test(n)) return pick(CIUDADES);
      if (/(categoria|tipo)/.test(n)) return pick(CATEGORIAS);
      if (/(estado|status)/.test(n)) return pick(ESTADOS);
      if (/(moneda|currency)/.test(n)) return pick(MONEDAS);
      if (/email|mail/.test(n)) return `${pick(NAMES).toLowerCase()}${randInt(1, 999)}@example.com`;
      if (/(tel|phone)/.test(n)) return `+54-9-${randInt(11, 99)}-${randInt(1000, 9999)}-${randInt(1000, 9999)}`;
      return `${tableName}_${name}_${rowIdx + 1}`;
  }
}

/**
 * Generate `n` synthetic rows for the given relational table. Column types are
 * inferred from column names because the upstream schema is typeless.
 */
export function generateSampleRelation(table: RelationalTable, n: number = 10): Relation {
  // Reset seed per table for reproducibility within a single generation
  seedCounter = (table.name.length * 17 + 31) & 0x7fffffff;

  const columns: Column[] = table.columns
    .filter(c => !c.isDerived)
    .map(c => ({ name: c.name, type: inferColumnType(c.name) }));

  const rows: Value[][] = [];
  for (let i = 0; i < n; i++) {
    rows.push(columns.map(c => generateValue(c.name, c.type, i, table.name)));
  }
  return { columns, rows };
}
