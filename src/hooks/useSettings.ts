// Global app settings — theme, font scale, panel visibility.
//
// Persisted in localStorage and re-applied to the DOM on every change:
//   - theme       → document.documentElement[data-theme]
//   - fontScale   → CSS custom property --ui-font-scale on :root
//   - panels.*    → consumed by individual views (each subscribes via useSettings)

import { useEffect, useMemo, useState } from 'react';

export type Theme = 'light' | 'dark';

export interface PanelVisibility {
  /** AlgebraView left panel (tables + imported relations + derived). */
  algebraTables: boolean;
  /** AlgebraView right panel (result + execution tree). */
  algebraResult: boolean;
  /** Global app sidebar (chat AI, settings, etc.). */
  appSidebar: boolean;
  /** ER tab top toolbar (add entity / relationship / etc.). */
  erToolbar: boolean;
  /** ER tab right-side panels (properties + chat). */
  erPanels: boolean;
}

export interface AppSettings {
  theme: Theme;
  /** Multiplier applied to base font size. Range [0.7, 1.5]. */
  fontScale: number;
  panels: PanelVisibility;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  fontScale: 1.0,
  panels: {
    algebraTables: true,
    algebraResult: true,
    appSidebar: true,
    erToolbar: true,
    erPanels: true,
  },
};

const STORAGE_KEY = 'derup.settings.v1';

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    // Defensive merge so a partial object stored by an older version
    // doesn't leave unset fields undefined at runtime.
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      panels: { ...DEFAULT_SETTINGS.panels, ...(parsed.panels ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Apply the settings to the DOM. Idempotent — safe to call every render.
 * Mutates only the root element (data-attr + CSS var) so no React re-render
 * is needed for theme/font changes outside of the SettingsMenu UI itself.
 */
function applyToDOM(s: AppSettings): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', s.theme);
  root.style.setProperty('--ui-font-scale', String(s.fontScale));
}

// Module-level singleton so multiple components see the same state without
// React Context. Subscribers are notified through a simple listener array.
let current = loadSettings();
const listeners = new Set<() => void>();
applyToDOM(current);

function setSettings(next: AppSettings): void {
  current = next;
  applyToDOM(next);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* full quota — ignore */ }
  listeners.forEach(l => l());
}

export interface UseSettingsApi {
  settings: AppSettings;
  setTheme(t: Theme): void;
  toggleTheme(): void;
  setFontScale(s: number): void;
  bumpFontScale(delta: number): void;
  setPanelVisible(panel: keyof PanelVisibility, visible: boolean): void;
  togglePanel(panel: keyof PanelVisibility): void;
  reset(): void;
}

/** Subscribe to the global settings store. Re-renders the calling component
 *  on any change. The returned API mutates the singleton and notifies all
 *  subscribers. */
export function useSettings(): UseSettingsApi {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force(n => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  return useMemo<UseSettingsApi>(() => ({
    settings: current,
    setTheme: (theme) => setSettings({ ...current, theme }),
    toggleTheme: () => setSettings({ ...current, theme: current.theme === 'light' ? 'dark' : 'light' }),
    setFontScale: (fontScale) => setSettings({
      ...current,
      fontScale: Math.max(0.7, Math.min(1.5, fontScale)),
    }),
    bumpFontScale: (delta) => setSettings({
      ...current,
      fontScale: Math.max(0.7, Math.min(1.5, Math.round((current.fontScale + delta) * 100) / 100)),
    }),
    setPanelVisible: (panel, visible) => setSettings({
      ...current,
      panels: { ...current.panels, [panel]: visible },
    }),
    togglePanel: (panel) => setSettings({
      ...current,
      panels: { ...current.panels, [panel]: !current.panels[panel] },
    }),
    reset: () => setSettings(DEFAULT_SETTINGS),
  }), []);
}

/** Read-only accessor for code paths that don't want to subscribe to renders
 *  (e.g. event handlers reading current visibility). */
export function readSettings(): AppSettings {
  return current;
}

// Re-export for callers that want a constant for the default values.
export const DEFAULTS = DEFAULT_SETTINGS;

