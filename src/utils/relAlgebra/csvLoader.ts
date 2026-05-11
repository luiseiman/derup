// CSV loader with type inference.
// Hand-rolled parser — no papaparse dependency.

import type { Column, ColumnType, Relation, Value } from './types';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;
const TYPE_SAMPLE = 50;

/**
 * Split a single CSV line respecting double-quoted fields with embedded commas
 * and escaped quotes ("" → "). Returns the array of raw field strings.
 */
function splitCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Parse CSV text into a Relation. Throws Error on inconsistent column counts.
 *
 * First row is column headers. Subsequent rows are data. Empty cells become null.
 * Column types are inferred by inspecting the first N=50 non-null cells per column.
 */
export function parseCSV(text: string): Relation {
  // Normalize newlines and split lines respecting quoted newlines.
  const lines = splitLinesRespectingQuotes(text.replace(/\r\n?/g, '\n'));
  if (lines.length === 0) throw new Error('El CSV está vacío.');

  const headerCells = splitCSVLine(lines[0]).map(s => s.trim());
  if (headerCells.length === 0 || headerCells.every(c => c === '')) {
    throw new Error('La primera línea (encabezado) está vacía.');
  }

  const rawRows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const cells = splitCSVLine(line);
    if (cells.length !== headerCells.length) {
      throw new Error(
        `Línea ${i + 1}: esperaba ${headerCells.length} columnas, se encontraron ${cells.length}.`
      );
    }
    rawRows.push(cells);
  }

  // Infer column types from raw strings
  const columns: Column[] = headerCells.map((name, ci) => {
    const samples: string[] = [];
    for (const row of rawRows) {
      const cell = row[ci];
      if (cell !== '' && cell !== undefined && cell !== null) {
        samples.push(cell);
        if (samples.length >= TYPE_SAMPLE) break;
      }
    }
    return { name, type: inferType(samples) };
  });

  // Convert raw strings to typed Value[]
  const rows: Value[][] = rawRows.map(raw =>
    raw.map((cell, ci) => coerce(cell, columns[ci].type))
  );

  return { columns, rows };
}

/**
 * Split text into lines, but don't split inside double-quoted fields. This handles
 * CSV cells that contain a literal \n inside quotes.
 */
function splitLinesRespectingQuotes(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { cur += '""'; i++; continue; }
      inQuotes = !inQuotes;
      cur += ch;
    } else if (ch === '\n' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function inferType(samples: string[]): ColumnType {
  if (samples.length === 0) return 'string';

  // number — every sample must parse to a finite number
  let allNum = true;
  for (const s of samples) {
    const t = s.trim();
    if (t === '') { allNum = false; break; }
    const n = Number(t);
    if (!Number.isFinite(n)) { allNum = false; break; }
  }
  if (allNum) return 'number';

  // date — every sample matches ISO or parses to a valid Date and isn't a plain number
  let allDate = true;
  for (const s of samples) {
    const t = s.trim();
    if (!ISO_DATE_RE.test(t)) {
      const d = Date.parse(t);
      if (Number.isNaN(d)) { allDate = false; break; }
    }
  }
  if (allDate) return 'date';

  // boolean — only "true"/"false" (case-insensitive)
  let allBool = true;
  for (const s of samples) {
    const t = s.trim().toLowerCase();
    if (t !== 'true' && t !== 'false') { allBool = false; break; }
  }
  if (allBool) return 'boolean';

  return 'string';
}

function coerce(raw: string, type: ColumnType): Value {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  switch (type) {
    case 'number': {
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    }
    case 'date': {
      const d = new Date(trimmed);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    case 'boolean':
      return trimmed.toLowerCase() === 'true';
    default:
      return raw;
  }
}

/**
 * Serialize a Relation back to CSV text. Used by the export button.
 */
export function relationToCSV(rel: Relation): string {
  const escapeCell = (v: Value): string => {
    if (v === null || v === undefined) return '';
    let s: string;
    if (v instanceof Date) s = v.toISOString();
    else s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const header = rel.columns.map(c => escapeCell(c.name)).join(',');
  const body = rel.rows.map(r => r.map(escapeCell).join(',')).join('\n');
  return body.length > 0 ? `${header}\n${body}` : header;
}
