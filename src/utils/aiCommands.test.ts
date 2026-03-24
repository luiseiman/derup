import { describe, it, expect } from 'vitest';
import { parseAICommandJson, parseAICommandBatch, isLegacyAICommand } from './aiCommands';

describe('parseAICommandJson', () => {
  it('parses add-entity command', () => {
    const cmd = parseAICommandJson('{"type":"add-entity","entityName":"Cliente","attributes":["nombre"],"keyAttributes":["nombre"]}');
    expect(cmd).not.toBeNull();
    expect(cmd?.type).toBe('add-entity');
    if (cmd?.type === 'add-entity') {
      expect(cmd.entityName).toBe('Cliente');
      expect(cmd.attributes).toEqual(['nombre']);
    }
  });

  it('parses chat command', () => {
    const cmd = parseAICommandJson('{"type":"chat","message":"Hola!"}');
    expect(cmd?.type).toBe('chat');
    if (cmd?.type === 'chat') expect(cmd.message).toBe('Hola!');
  });

  it('parses connect-entities command with optional fields', () => {
    const cmd = parseAICommandJson(
      '{"type":"connect-entities","entityA":"Empleado","entityB":"Departamento","cardinalityA":"N","cardinalityB":"1","totalA":false,"totalB":true}'
    );
    expect(cmd?.type).toBe('connect-entities');
    if (cmd?.type === 'connect-entities') {
      expect(cmd.cardinalityA).toBe('N');
      expect(cmd.cardinalityB).toBe('1');
      expect(cmd.totalB).toBe(true);
    }
  });

  it('returns null for unknown type', () => {
    expect(parseAICommandJson('{"type":"unknown-command"}')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseAICommandJson('not json')).toBeNull();
  });

  it('extracts command from prose with embedded JSON', () => {
    const cmd = parseAICommandJson('Here you go: {"type":"delete-entity","entityName":"Foo"} done.');
    expect(cmd?.type).toBe('delete-entity');
  });

  it('parses create-isa with defaults', () => {
    const cmd = parseAICommandJson('{"type":"create-isa","supertype":"Persona","subtypes":["Alumno","Empleado"]}');
    expect(cmd?.type).toBe('create-isa');
    if (cmd?.type === 'create-isa') {
      expect(cmd.isDisjoint).toBe(true);
      expect(cmd.isTotal).toBe(false);
      expect(cmd.subtypes).toEqual(['Alumno', 'Empleado']);
    }
  });
});

describe('parseAICommandBatch', () => {
  it('parses array of commands', () => {
    const text = '[{"type":"add-entity","entityName":"A","attributes":[],"keyAttributes":[]},{"type":"add-entity","entityName":"B","attributes":[],"keyAttributes":[]}]';
    const batch = parseAICommandBatch(text);
    expect(batch).not.toBeNull();
    expect(batch?.length).toBe(2);
    expect(batch?.[0].type).toBe('add-entity');
    expect(batch?.[1].type).toBe('add-entity');
  });

  it('skips invalid commands in array, returns valid ones', () => {
    const text = '[{"type":"add-entity","entityName":"A","attributes":[],"keyAttributes":[]},{"type":"invalid-type"}]';
    const batch = parseAICommandBatch(text);
    expect(batch?.length).toBe(1);
    expect(batch?.[0].type).toBe('add-entity');
  });

  it('returns null for empty array', () => {
    expect(parseAICommandBatch('[]')).toBeNull();
  });

  it('returns null for non-array JSON', () => {
    expect(parseAICommandBatch('{"type":"add-entity"}')).toBeNull();
  });

  it('returns null for plain text', () => {
    expect(parseAICommandBatch('no json')).toBeNull();
  });

  it('extracts array from fenced code block', () => {
    const text = '```json\n[{"type":"clear-diagram"}]\n```';
    const batch = parseAICommandBatch(text);
    expect(batch?.length).toBe(1);
    expect(batch?.[0].type).toBe('clear-diagram');
  });
});

describe('isLegacyAICommand', () => {
  it('returns true for legacy types', () => {
    expect(isLegacyAICommand('add-entity')).toBe(true);
    expect(isLegacyAICommand('connect-entities')).toBe(true);
    expect(isLegacyAICommand('clear-diagram')).toBe(true);
  });

  it('returns false for new types', () => {
    expect(isLegacyAICommand('set-cardinality')).toBe(false);
    expect(isLegacyAICommand('create-isa')).toBe(false);
    expect(isLegacyAICommand('chat')).toBe(false);
  });
});
