import React from 'react';
import './Toolbar.css';

export interface ToolbarItem {
  id: string;
  label: string;
  icon: string;
  action: () => void;
  disabled?: boolean;
  active?: boolean;
  badge?: number;
  separator?: boolean;
}

interface ToolbarProps {
  items: ToolbarItem[];
}

export const Toolbar: React.FC<ToolbarProps> = ({ items }) => {
  return (
    <div className="toolbar" role="toolbar" aria-label="Herramientas del diagrama">
      {items.map((item, index) => (
        <React.Fragment key={item.id}>
          {item.separator && index > 0 && (
            <div className="toolbar-sep" role="separator" />
          )}
          <button
            className={`toolbar-btn ${item.active ? 'active' : ''}`}
            onClick={item.action}
            disabled={item.disabled}
            title={item.label}
            aria-label={item.label}
            aria-pressed={item.active || undefined}
          >
            <span className="toolbar-btn-icon">{item.icon}</span>
            <span className="toolbar-btn-label">{item.label}</span>
            {item.badge != null && item.badge > 0 && (
              <span className="toolbar-badge">{item.badge}</span>
            )}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};

export default Toolbar;
