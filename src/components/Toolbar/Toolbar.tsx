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
  zoomControls: {
    scale: number;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onZoomChange: (value: number) => void;
  };
}

export const Toolbar: React.FC<ToolbarProps> = ({ items, zoomControls }) => {
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
      <div className="toolbar-sep" role="separator" />
      <div className="toolbar-zoom">
        <button onClick={zoomControls.onZoomOut} aria-label="Zoom out" className="toolbar-btn">
          <span className="toolbar-btn-icon">−</span>
        </button>
        <input
          type="range"
          min={0.1}
          max={5}
          step={0.1}
          value={zoomControls.scale}
          onChange={e => zoomControls.onZoomChange(Number(e.target.value))}
          aria-label="Zoom level"
        />
        <button onClick={zoomControls.onZoomIn} aria-label="Zoom in" className="toolbar-btn">
          <span className="toolbar-btn-icon">+</span>
        </button>
        <span className="toolbar-zoom-label">{Math.round(zoomControls.scale * 100)}%</span>
      </div>
    </div>
  );
};

export default Toolbar;
