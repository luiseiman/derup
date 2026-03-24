import React, { useEffect, useRef } from 'react';
import './ContextMenu.css';
import type { ContextMenuState } from '../../hooks/useContextMenu';

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onAction: (action: () => void) => void;
}

/**
 * ContextMenu Component
 * Renders a context menu at specified position with action items.
 * Mobile-friendly with large touch targets (44px minimum).
 * Supports desktop right-click and mobile long-press.
 */
export const ContextMenu: React.FC<ContextMenuProps> = ({
  state,
  onClose,
  onAction,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!state.isOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    // Close on backdrop click or touch
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [state.isOpen, onClose]);

  // Close on Escape key
  useEffect(() => {
    if (!state.isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [state.isOpen, onClose]);

  if (!state.isOpen || state.items.length === 0) {
    return null;
  }

  // Adjust position to keep menu within viewport
  let top = state.position.y;
  let left = state.position.x;

  // Will be adjusted by CSS if needed
  // const menuWidth = 200;
  // const menuHeight = state.items.length * 40;

  // if (left + menuWidth > window.innerWidth) {
  //   left = Math.max(0, window.innerWidth - menuWidth - 10);
  // }
  // if (top + menuHeight > window.innerHeight) {
  //   top = Math.max(0, window.innerHeight - menuHeight - 10);
  // }

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{
        top: `${top}px`,
        left: `${left}px`,
      }}
    >
      {state.items.map((item, index) => (
        <React.Fragment key={item.id || index}>
          {item.divider ? (
            <div key={`divider-${index}`} className="context-menu-divider" />
          ) : (
            <button
              className={`context-menu-item ${item.disabled ? 'disabled' : ''}`}
              onClick={() => {
                if (!item.disabled && item.action) {
                  onAction(item.action);
                }
              }}
              disabled={item.disabled}
            >
              {item.icon && (
                <span className="context-menu-icon">{item.icon}</span>
              )}
              <span className="context-menu-label">{item.label}</span>
            </button>
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default ContextMenu;
