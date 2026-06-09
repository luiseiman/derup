// ⚙️ Settings dropdown. Lives in the canvas-view-tabs header next to the
// export buttons. Exposes the three user-facing knobs from useSettings:
// theme (light/dark), font scale (- 100% +), and panel visibility.

import { useEffect, useRef, useState } from 'react';
import type { FC } from 'react';
import { useSettings } from '../hooks/useSettings';
import type { PanelVisibility } from '../hooks/useSettings';
import './SettingsMenu.css';

const PANEL_LABELS: Record<keyof PanelVisibility, string> = {
  algebraTables: 'Tablas (Álgebra/SQL)',
  algebraResult: 'Resultado (Álgebra/SQL)',
  appSidebar: 'Sidebar de la app',
  erToolbar: 'Toolbar del ER',
  erPanels: 'Properties + Chat (ER)',
};

const SettingsMenu: FC = () => {
  const { settings, toggleTheme, bumpFontScale, setFontScale, toggleFontBold, togglePanel, setResultLayout, reset } = useSettings();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside or pressing Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pct = Math.round(settings.fontScale * 100);

  return (
    <div className="settings-menu" ref={wrapRef}>
      <button
        type="button"
        className={`settings-toggle ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(v => !v)}
        title="Ajustes"
        aria-label="Ajustes"
        aria-expanded={open}
      >
        ⚙
      </button>

      {open && (
        <div className="settings-dropdown" role="menu">
          {/* Theme */}
          <div className="settings-section">
            <div className="settings-label">Tema</div>
            <div className="settings-row">
              <button
                type="button"
                className={`settings-pill ${settings.theme === 'light' ? 'active' : ''}`}
                onClick={() => { if (settings.theme !== 'light') toggleTheme(); }}
              >
                ☀ Claro
              </button>
              <button
                type="button"
                className={`settings-pill ${settings.theme === 'dark' ? 'active' : ''}`}
                onClick={() => { if (settings.theme !== 'dark') toggleTheme(); }}
              >
                ☾ Oscuro
              </button>
            </div>
          </div>

          {/* Font scale + bold — applies ONLY to the algebra/SQL editor body */}
          <div className="settings-section">
            <div className="settings-label">Tamaño de letra (editor)</div>
            <div className="settings-row">
              <button
                type="button"
                className="settings-step"
                onClick={() => bumpFontScale(-0.1)}
                disabled={settings.fontScale <= 0.7}
                title="Reducir"
              >A⁻</button>
              <button
                type="button"
                className="settings-step settings-step-reset"
                onClick={() => setFontScale(1.0)}
                title="Restablecer 100%"
              >{pct}%</button>
              <button
                type="button"
                className="settings-step"
                onClick={() => bumpFontScale(0.1)}
                disabled={settings.fontScale >= 1.5}
                title="Aumentar"
              >A⁺</button>
              <button
                type="button"
                className={`settings-step ${settings.fontBold ? 'active' : ''}`}
                onClick={toggleFontBold}
                title="Negrita global"
                style={{ fontWeight: 700 }}
              >B</button>
            </div>
          </div>

          {/* Panel visibility */}
          <div className="settings-section">
            <div className="settings-label">Paneles visibles</div>
            <div className="settings-checkboxes">
              {(Object.keys(PANEL_LABELS) as (keyof PanelVisibility)[]).map(panel => (
                <label key={panel} className="settings-check">
                  <input
                    type="checkbox"
                    checked={settings.panels[panel]}
                    onChange={() => togglePanel(panel)}
                  />
                  <span>{PANEL_LABELS[panel]}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Result panel layout (Algebra/SQL view only) */}
          <div className="settings-section">
            <div className="settings-label">Ubicación del resultado</div>
            <div className="settings-row">
              <button
                type="button"
                className={`settings-pill ${settings.resultLayout === 'side' ? 'active' : ''}`}
                onClick={() => setResultLayout('side')}
                title="Panel a la derecha del editor"
              >
                ⇥ Al costado
              </button>
              <button
                type="button"
                className={`settings-pill ${settings.resultLayout === 'below' ? 'active' : ''}`}
                onClick={() => setResultLayout('below')}
                title="Panel debajo del editor"
              >
                ⤓ Abajo
              </button>
            </div>
          </div>

          <div className="settings-footer">
            <button type="button" className="settings-reset" onClick={reset}>
              Restablecer todo
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsMenu;
