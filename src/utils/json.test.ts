import { describe, it, expect } from 'vitest';
import { extractJsonObject, extractJsonArray, parseJSON, isObject, isArray } from './json';

describe('extractJsonObject', () => {
  it('parses plain JSON object', () => {
    expect(extractJsonObject('{"type":"add-entity"}')).toEqual({ type: 'add-entity' });
  });

  it('extracts object from fenced code block', () => {
    const text = '```json\n{"type":"chat","message":"hola"}\n```';
    expect(extractJsonObject(text)).toEqual({ type: 'chat', message: 'hola' });
  });

  it('extracts object embedded in prose', () => {
    const text = 'Sure! Here is the command: {"type":"delete-entity","entityName":"Foo"} done.';
    expect(extractJsonObject(text)).toEqual({ type: 'delete-entity', entityName: 'Foo' });
  });

  it('returns null for empty string', () => {
    expect(extractJsonObject('')).toBeNull();
  });

  it('returns null for plain text without JSON', () => {
    expect(extractJsonObject('no json here')).toBeNull();
  });

  it('returns null when JSON is an array, not object', () => {
    expect(extractJsonObject('[1,2,3]')).toBeNull();
  });
});

describe('extractJsonArray', () => {
  it('parses plain JSON array', () => {
    expect(extractJsonArray('[{"type":"add-entity"},{"type":"clear-diagram"}]')).toEqual([
      { type: 'add-entity' },
      { type: 'clear-diagram' },
    ]);
  });

  it('extracts array from fenced code block', () => {
    const text = '```json\n[{"type":"chat","message":"hola"}]\n```';
    expect(extractJsonArray(text)).toEqual([{ type: 'chat', message: 'hola' }]);
  });

  it('extracts array embedded in prose', () => {
    const text = 'Commands: [{"type":"add-entity","entityName":"X"}] end.';
    expect(extractJsonArray(text)).toEqual([{ type: 'add-entity', entityName: 'X' }]);
  });

  it('returns null for empty string', () => {
    expect(extractJsonArray('')).toBeNull();
  });

  it('returns null for object, not array', () => {
    expect(extractJsonArray('{"type":"add-entity"}')).toBeNull();
  });
});

describe('parseJSON', () => {
  it('parses valid JSON', () => {
    expect(parseJSON('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('returns defaultValue on invalid JSON', () => {
    expect(parseJSON('invalid', { default: true })).toEqual({ default: true });
  });

  it('calls onError on failure', () => {
    const errors: string[] = [];
    parseJSON('bad', {}, (e) => errors.push(e.message));
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('JSON parse error');
  });
});

describe('isObject / isArray', () => {
  it('isObject returns true for plain objects', () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
  });

  it('isObject returns false for null and primitives', () => {
    expect(isObject(null)).toBe(false);
    expect(isObject('str')).toBe(false);
    expect(isObject(42)).toBe(false);
    expect(isObject(undefined)).toBe(false);
  });

  it('isArray returns true for arrays', () => {
    expect(isArray([])).toBe(true);
    expect(isArray([1, 2])).toBe(true);
  });

  it('isArray returns false for objects and primitives', () => {
    expect(isArray({})).toBe(false);
    expect(isArray(null)).toBe(false);
  });
});
