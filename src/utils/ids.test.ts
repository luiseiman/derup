import { describe, it, expect } from 'vitest';
import { createId } from './ids';

describe('createId', () => {
  it('returns a string', () => {
    expect(typeof createId()).toBe('string');
  });

  it('returns 21 characters (nanoid default length)', () => {
    expect(createId()).toHaveLength(21);
  });

  it('generates no collisions across 1000 calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => createId()));
    expect(ids.size).toBe(1000);
  });

  it('only uses URL-safe characters [A-Za-z0-9_-]', () => {
    const urlSafe = /^[A-Za-z0-9_-]+$/;
    for (let i = 0; i < 100; i++) {
      expect(createId()).toMatch(urlSafe);
    }
  });
});
