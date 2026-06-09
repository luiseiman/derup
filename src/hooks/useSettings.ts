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

export type ResultLayout = 'side' | 'below';

export interface AppSettings {
  theme: Theme;
  /** Multiplier applied to base font size. Range [0.7, 1.5]. */
  fontScale: number;
  /** When true, the whole UI uses a heavier font-weight. Accessibility helper
   *  for users who prefer denser strokes; applied as --ui-font-weight on :root. */
  fontBold: boolean;
  panels: PanelVisibility;
  /** Show the execution tree (graphical view) in the result panel. */
  showResultTree: boolean;
  /** Show the rows table in the result panel. */
  showResultData: boolean;
  /** Where the result panel sits in the AlgebraView layout:
   *   'side'  → to the right of the editor (default)
   *   'below' → underneath the editor */
  resultLayout: ResultLayout;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  fontScale: 1.0,
  fontBold: false,
  panels: {
    algebraTables: true,
    algebraResult: true,
    appSidebar: true,
    erToolbar: true,
    erPanels: true,
  },
  showResultTree: true,
  showResultData: true,
  resultLayout: 'side',
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
  // 400 = normal, 600 = semi-bold. We don't go to 700 because some app fonts
  // get visually crowded at the larger sizes that combine with the scale.
  root.style.setProperty('--ui-font-weight', s.fontBold ? '600' : '400');
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
  toggleFontBold(): void;
  setPanelVisible(panel: keyof PanelVisibility, visible: boolean): void;
  togglePanel(panel: keyof PanelVisibility): void;
  setShowResultTree(v: boolean): void;
  setShowResultData(v: boolean): void;
  setResultLayout(layout: ResultLayout): void;
  reset(): void;
}

/** Subscribe to the global settings store. Re-renders the calling component
 *  on any change. The returned API mutates the singleton and notifies all
 *  subscribers.
 *
 *  Note: `settings` is read fresh on every render (NOT memoised) so React
 *  sees the latest value after a mutation. The action callbacks ARE memoised
 *  with [] because they read `current` lazily at invocation time — the
 *  module-level variable is mutable, so closing over it is fine.
 */
export function useSettings(): UseSettingsApi {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force(n => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  const actions = useMemo(() => ({
    setTheme: (theme: Theme) => setSettings({ ...current, theme }),
    toggleTheme: () => setSettings({ ...current, theme: current.theme === 'light' ? 'dark' : 'light' }),
    setFontScale: (fontScale: number) => setSettings({
      ...current,
      fontScale: Math.max(0.7, Math.min(1.5, fontScale)),
    }),
    bumpFontScale: (delta: number) => setSettings({
      ...current,
      fontScale: Math.max(0.7, Math.min(1.5, Math.round((current.fontScale + delta) * 100) / 100)),
    }),
    toggleFontBold: () => setSettings({ ...current, fontBold: !current.fontBold }),
    setPanelVisible: (panel: keyof PanelVisibility, visible: boolean) => setSettings({
      ...current,
      panels: { ...current.panels, [panel]: visible },
    }),
    togglePanel: (panel: keyof PanelVisibility) => setSettings({
      ...current,
      panels: { ...current.panels, [panel]: !current.panels[panel] },
    }),
    setShowResultTree: (v: boolean) => setSettings({ ...current, showResultTree: v }),
    setShowResultData: (v: boolean) => setSettings({ ...current, showResultData: v }),
    setResultLayout: (layout: ResultLayout) => setSettings({ ...current, resultLayout: layout }),
    reset: () => setSettings(DEFAULT_SETTINGS),
  }), []);

  // `current` is read FRESH on every render so the consumer always sees the
  // latest store state. Spreading actions (which never change) keeps the
  // returned API stable for downstream useEffect deps.
  return { settings: current, ...actions };
}

/** Read-only accessor for code paths that don't want to subscribe to renders
 *  (e.g. event handlers reading current visibility). */
export function readSettings(): AppSettings {
  return current;
}

// Re-export for callers that want a constant for the default values.
export const DEFAULTS = DEFAULT_SETTINGS;

