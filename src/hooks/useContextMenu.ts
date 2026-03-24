import { useState, useRef, useCallback } from 'react';

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  action?: () => void;
  divider?: boolean;
  disabled?: boolean;
}

export interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  items: MenuItem[];
  contextType?: 'node' | 'connection' | 'aggregation' | 'canvas';
  targetId?: string;
}

const LONG_PRESS_DURATION = 500; // milliseconds

/**
 * Custom hook for managing context menu state and interactions.
 * Handles desktop right-click, mobile long-press, and keyboard shortcuts.
 */
export const useContextMenu = () => {
  const [state, setState] = useState<ContextMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
    items: [],
  });

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);

  /**
   * Show context menu at specified position with items
   */
  const show = useCallback(
    (
      x: number,
      y: number,
      items: MenuItem[],
      contextType?: 'node' | 'connection' | 'aggregation' | 'canvas',
      targetId?: string
    ) => {
      setState({
        isOpen: true,
        position: { x, y },
        items,
        contextType,
        targetId,
      });
    },
    []
  );

  /**
   * Hide context menu
   */
  const hide = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isOpen: false,
    }));
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  /**
   * Handle right-click (desktop) - immediately show menu
   */
  const handleContextMenu = useCallback(
    (
      e: React.MouseEvent,
      items: MenuItem[],
      contextType?: 'node' | 'connection' | 'aggregation' | 'canvas',
      targetId?: string
    ) => {
      e.preventDefault();
      e.stopPropagation();
      show(e.clientX, e.clientY, items, contextType, targetId);
    },
    [show]
  );

  /**
   * Handle touch start - initiate long-press timer
   */
  const handleTouchStart = useCallback(
    (
      e: React.TouchEvent,
      items: MenuItem[],
      contextType?: 'node' | 'connection' | 'aggregation' | 'canvas',
      targetId?: string
    ) => {
      touchStartPos.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };

      // Clear any previous timer
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
      }

      // Start long-press timer
      longPressTimer.current = setTimeout(() => {
        e.preventDefault();
        const touch = e.touches[0];
        show(touch.clientX, touch.clientY, items, contextType, targetId);
      }, LONG_PRESS_DURATION);
    },
    [show]
  );

  /**
   * Handle touch end - cancel long-press if touch ends too quickly
   */
  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  /**
   * Handle touch move - cancel long-press if user drags
   */
  const handleTouchMove = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  /**
   * Handle keyboard (close menu on Escape)
   */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state.isOpen) {
        hide();
      }
    },
    [state.isOpen, hide]
  );

  /**
   * Execute action and close menu
   */
  const executeAction = useCallback((action: () => void) => {
    action();
    hide();
  }, [hide]);

  return {
    state,
    show,
    hide,
    handleContextMenu,
    handleTouchStart,
    handleTouchEnd,
    handleTouchMove,
    handleKeyDown,
    executeAction,
  };
};
