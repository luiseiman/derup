// Drag handle between two panels.
//
// Lives between siblings in either a flex row (orientation='vertical' —
// drags horizontally, resizing widths) or flex column (orientation='horizontal'
// — drags vertically, resizing heights). On drag the parent receives a
// callback with the delta in pixels and updates its own width/height state.

import { useCallback, useRef, useEffect } from 'react';

interface SplitterProps {
  /** 'vertical' = thin vertical bar, drag changes WIDTHS (column splitter).
   *  'horizontal' = thin horizontal bar, drag changes HEIGHTS. */
  orientation?: 'vertical' | 'horizontal';
  /** Fired on each drag step with the cumulative delta in px since the user
   *  pressed down. The sign matches the drag direction:
   *    vertical:  positive = mouse moved right
   *    horizontal: positive = mouse moved down */
  onDrag: (deltaPx: number) => void;
  /** Fired once at mousedown so the parent can snapshot whatever baseline
   *  width/height it intends to adjust during the drag. */
  onDragStart?: () => void;
  /** Optional callback when the user releases the mouse. */
  onDragEnd?: () => void;
  /** className override (e.g. to highlight a specific splitter). */
  className?: string;
  /** Inline style override (e.g. to set grid-row when the splitter sits in
   *  a CSS-grid layout that needs an explicit row span). */
  style?: React.CSSProperties;
  /** Tooltip on hover. */
  title?: string;
}

const Splitter: React.FC<SplitterProps> = ({
  orientation = 'vertical',
  onDrag,
  onDragStart,
  onDragEnd,
  className = '',
  style,
  title,
}) => {
  // Track the starting cursor position so onDrag receives a cumulative delta.
  const startRef = useRef<number>(0);
  const draggingRef = useRef(false);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!draggingRef.current) return;
    const current = orientation === 'vertical' ? e.clientX : e.clientY;
    onDrag(current - startRef.current);
  }, [orientation, onDrag]);

  const handleMouseUp = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    onDragEnd?.();
  }, [onDragEnd]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    startRef.current = orientation === 'vertical' ? e.clientX : e.clientY;
    // Prevent text selection while dragging; switch cursor globally so it
    // doesn't flicker when the mouse leaves the splitter strip.
    document.body.style.userSelect = 'none';
    document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize';
    onDragStart?.();
  };

  return (
    <div
      className={`splitter splitter-${orientation} ${className}`}
      role="separator"
      aria-orientation={orientation === 'vertical' ? 'vertical' : 'horizontal'}
      title={title ?? (orientation === 'vertical' ? 'Arrastrar para cambiar el ancho' : 'Arrastrar para cambiar el alto')}
      style={style}
      onMouseDown={handleMouseDown}
    />
  );
};

export default Splitter;
