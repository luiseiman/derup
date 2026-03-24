import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocalStorage } from './useLocalStorage';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('useLocalStorage', () => {
  it('returns defaultValue when localStorage is empty', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 42));
    expect(result.current[0]).toBe(42);
  });

  it('reads existing value from localStorage on mount', async () => {
    localStorage.setItem('test-key', JSON.stringify({ name: 'Luis' }));
    const { result } = renderHook(() =>
      useLocalStorage('test-key', { name: '' })
    );
    // wait for the useEffect to run
    await act(async () => {});
    expect(result.current[0]).toEqual({ name: 'Luis' });
  });

  it('writes to localStorage when state changes via setState', async () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 0));
    await act(async () => {});

    act(() => {
      result.current[1](99);
    });
    await act(async () => {});

    expect(localStorage.getItem('test-key')).toBe('99');
  });

  it('calls onError when localStorage.getItem throws', async () => {
    const onError = vi.fn();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new Error('getItem boom');
    });

    renderHook(() => useLocalStorage('test-key', 'default', { onError }));
    await act(async () => {});

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].message).toContain('test-key');
  });

  it('calls onError when localStorage.setItem throws', async () => {
    const onError = vi.fn();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('setItem boom');
    });

    const { result } = renderHook(() =>
      useLocalStorage('test-key', 'initial', { onError })
    );
    await act(async () => {});

    act(() => {
      result.current[1]('changed');
    });
    await act(async () => {});

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].message).toContain('test-key');
  });

  it('calls localStorage.removeItem when state is set to undefined', async () => {
    localStorage.setItem('test-key', JSON.stringify('hello'));
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem');

    const { result } = renderHook(() =>
      useLocalStorage<string | undefined>('test-key', 'hello')
    );
    await act(async () => {});

    act(() => {
      result.current[1](undefined);
    });
    await act(async () => {});

    expect(removeSpy).toHaveBeenCalledWith('test-key');
  });

  it('uses custom serializer when writing', async () => {
    const serializer = vi.fn((v: string) => `custom:${v}`);
    const { result } = renderHook(() =>
      useLocalStorage<string>('test-key', 'init', { serializer })
    );
    await act(async () => {});

    act(() => {
      result.current[1]('hello');
    });
    await act(async () => {});

    expect(serializer).toHaveBeenCalledWith('hello');
    expect(localStorage.getItem('test-key')).toBe('custom:hello');
  });

  it('uses custom deserializer when reading', async () => {
    localStorage.setItem('test-key', 'raw-value');
    const deserializer = vi.fn((_: string) => 'parsed-value');

    const { result } = renderHook(() =>
      useLocalStorage('test-key', 'default', { deserializer })
    );
    await act(async () => {});

    expect(deserializer).toHaveBeenCalledWith('raw-value');
    expect(result.current[0]).toBe('parsed-value');
  });

  it('calls onError on invalid JSON in storage', async () => {
    localStorage.setItem('test-key', '{not-valid-json}');
    const onError = vi.fn();

    renderHook(() => useLocalStorage('test-key', 'default', { onError }));
    await act(async () => {});

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].message).toContain('test-key');
  });
});
