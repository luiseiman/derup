import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useContextMenu, type MenuItem } from './useContextMenu';

const sampleItems: MenuItem[] = [
  { id: '1', label: 'Item 1', action: vi.fn() },
  { id: '2', label: 'Item 2', action: vi.fn() },
];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useContextMenu', () => {
  it('initial state: isOpen=false, empty items', () => {
    const { result } = renderHook(() => useContextMenu());
    expect(result.current.state.isOpen).toBe(false);
    expect(result.current.state.items).toHaveLength(0);
  });

  it('show() sets isOpen=true with correct position and items', () => {
    const { result } = renderHook(() => useContextMenu());

    act(() => {
      result.current.show(100, 200, sampleItems, 'node', 'node-1');
    });

    expect(result.current.state.isOpen).toBe(true);
    expect(result.current.state.position).toEqual({ x: 100, y: 200 });
    expect(result.current.state.items).toEqual(sampleItems);
    expect(result.current.state.contextType).toBe('node');
    expect(result.current.state.targetId).toBe('node-1');
  });

  it('hide() sets isOpen=false', () => {
    const { result } = renderHook(() => useContextMenu());

    act(() => {
      result.current.show(10, 20, sampleItems);
    });
    expect(result.current.state.isOpen).toBe(true);

    act(() => {
      result.current.hide();
    });
    expect(result.current.state.isOpen).toBe(false);
  });

  it('handleContextMenu calls preventDefault + stopPropagation and opens menu', () => {
    const { result } = renderHook(() => useContextMenu());

    const mockEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 150,
      clientY: 250,
    } as unknown as React.MouseEvent;

    act(() => {
      result.current.handleContextMenu(mockEvent, sampleItems, 'canvas');
    });

    expect(mockEvent.preventDefault).toHaveBeenCalledOnce();
    expect(mockEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(result.current.state.isOpen).toBe(true);
    expect(result.current.state.position).toEqual({ x: 150, y: 250 });
    expect(result.current.state.contextType).toBe('canvas');
  });

  it('handleTouchStart: after 500ms the menu opens', () => {
    const { result } = renderHook(() => useContextMenu());

    const mockTouchEvent = {
      preventDefault: vi.fn(),
      touches: [{ clientX: 80, clientY: 90 }],
    } as unknown as React.TouchEvent;

    act(() => {
      result.current.handleTouchStart(mockTouchEvent, sampleItems, 'node', 'n1');
    });

    expect(result.current.state.isOpen).toBe(false);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.state.isOpen).toBe(true);
    expect(result.current.state.position).toEqual({ x: 80, y: 90 });
  });

  it('handleTouchStart: touch cancelled by handleTouchEnd before 500ms does NOT open menu', () => {
    const { result } = renderHook(() => useContextMenu());

    const mockTouchEvent = {
      preventDefault: vi.fn(),
      touches: [{ clientX: 80, clientY: 90 }],
    } as unknown as React.TouchEvent;

    act(() => {
      result.current.handleTouchStart(mockTouchEvent, sampleItems);
    });

    act(() => {
      result.current.handleTouchEnd();
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.state.isOpen).toBe(false);
  });

  it('handleTouchMove cancels pending long-press', () => {
    const { result } = renderHook(() => useContextMenu());

    const mockTouchEvent = {
      preventDefault: vi.fn(),
      touches: [{ clientX: 10, clientY: 20 }],
    } as unknown as React.TouchEvent;

    act(() => {
      result.current.handleTouchStart(mockTouchEvent, sampleItems);
    });

    act(() => {
      result.current.handleTouchMove();
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.state.isOpen).toBe(false);
  });

  it('handleTouchStart: rapid successive calls clear previous timer and only one menu opens', () => {
    const { result } = renderHook(() => useContextMenu());

    const makeEvent = (x: number, y: number) =>
      ({
        preventDefault: vi.fn(),
        touches: [{ clientX: x, clientY: y }],
      } as unknown as React.TouchEvent);

    act(() => {
      result.current.handleTouchStart(makeEvent(10, 20), sampleItems);
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    // Second touch before first fires
    act(() => {
      result.current.handleTouchStart(makeEvent(50, 60), sampleItems);
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.state.isOpen).toBe(true);
    // Position should be from the second touch
    expect(result.current.state.position).toEqual({ x: 50, y: 60 });
  });

  it('handleKeyDown Escape closes open menu', () => {
    const { result } = renderHook(() => useContextMenu());

    act(() => {
      result.current.show(10, 20, sampleItems);
    });
    expect(result.current.state.isOpen).toBe(true);

    act(() => {
      result.current.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(result.current.state.isOpen).toBe(false);
  });

  it('handleKeyDown Escape is no-op when menu is closed', () => {
    const { result } = renderHook(() => useContextMenu());
    expect(result.current.state.isOpen).toBe(false);

    // Should not throw
    act(() => {
      result.current.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(result.current.state.isOpen).toBe(false);
  });

  it('executeAction calls the provided action and closes the menu', () => {
    const { result } = renderHook(() => useContextMenu());
    const action = vi.fn();

    act(() => {
      result.current.show(10, 20, sampleItems);
    });
    expect(result.current.state.isOpen).toBe(true);

    act(() => {
      result.current.executeAction(action);
    });

    expect(action).toHaveBeenCalledOnce();
    expect(result.current.state.isOpen).toBe(false);
  });
});
