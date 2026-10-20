/**
 * SkillsAir Studio colour source of truth. `generate-admin-theme.mjs` turns this into
 * src/app/(payload)/styles/tokens.css (the --sa-* tokens) and theme.css (Payload's own
 * variables), and `check-admin-contrast.mjs` checks the text pairs below in both themes.
 * Edit here, then run `node scripts/generate-admin-theme.mjs`.
 */

export const STEPS = Array.from({ length: 21 }, (_, i) => i * 50)
export const SEMANTIC_STEPS = Array.from({ length: 19 }, (_, i) => (i + 1) * 50)

/** Elevation anchors: white to brand navy (light), deep navy to white (dark). Gaps are interpolated in OKLCH. */
export const elevation = {
  light: {
    0: '#ffffff', 50: '#f8fafc', 100: '#f1f5f9', 150: '#e2e8f0', 250: '#cbd5e1', 400: '#8f9cb3',
    500: '#5a6882', 650: '#3e4b66', 800: '#1d2a4c', 900: '#142149', 1000: '#0d1b4b',
  },
  dark: {
    0: '#0a1433', 50: '#0d1b4b', 100: '#13235a', 150: '#1d2d68', 250: '#2f3f7c', 400: '#5b6a99',
    500: '#8a96ba', 650: '#b4bdd6', 800: '#dfe4f0', 900: '#f1f5f9', 1000: '#ffffff',
  },
}

/** Semantic ramps (Payload inverts the theme-* mapping of these in dark mode by itself). */
export const semantic = {
  success: { 50: '#f0fdf4', 100: '#dcfce7', 300: '#86efac', 600: '#15803d', 950: '#052e16' },
  warning: { 50: '#fffbeb', 100: '#fef3c7', 300: '#fcd34d', 600: '#b45309', 950: '#451a03' },
  error: { 50: '#fef2f2', 100: '#fee2e2', 300: '#fca5a5', 600: '#b91c1c', 950: '#450a0a' },
  blue: { 50: '#eff6ff', 100: '#dbeafe', 300: '#93c5fd', 600: '#1e3a8a', 950: '#0a1433' },
}

/** Payload surfaces that are not simply an elevation step. */
export const surfaces = {
  light: { '--theme-bg': '#f8fafc', '--theme-input-bg': '#ffffff', '--theme-text': '#0f172a', '--theme-overlay': 'rgb(13 27 75 / 0.45)' },
  dark: { '--theme-bg': '#0a1433', '--theme-input-bg': '#0d1b4b', '--theme-text': '#f1f5f9', '--theme-overlay': 'rgb(4 8 24 / 0.72)' },
}

/** Semantic Studio tokens. Components use only these. */
export const tokens = {
  light: {
    surface: '#f8fafc',
    'surface-raised': '#ffffff',
    'surface-sunken': '#f1f5f9',
    ink: '#0f172a',
    'ink-muted': '#475569',
    'ink-subtle': '#5a6882',
    line: '#e2e8f0',
    'line-strong': '#cbd5e1',
    accent: '#c2410c',
    'accent-hover': '#9a3412',
    'accent-ink': '#ffffff',
    'accent-soft': '#fff7ed',
    'accent-soft-ink': '#9a3412',
    'accent-bright': '#f97316',
    navy: '#0d1b4b',
    'navy-raised': '#16255c',
    'navy-ink': '#ffffff',
    'navy-ink-muted': '#cbd5e1',
    'navy-ink-subtle': '#94a3c4',
    positive: '#15803d',
    'positive-soft': '#dcfce7',
    'positive-ink': '#166534',
    caution: '#b45309',
    'caution-soft': '#fef3c7',
    'caution-ink': '#92400e',
    critical: '#b91c1c',
    'critical-soft': '#fee2e2',
    'critical-ink': '#991b1b',
    info: '#1e3a8a',
    'info-soft': '#dbeafe',
    'info-ink': '#1e3a8a',
    'neutral-soft': '#f1f5f9',
    'neutral-ink': '#334155',
    'whatsapp': '#0e7a6d',
    'whatsapp-ink': '#ffffff',
    'bubble-in': '#ffffff',
    'bubble-out': '#dcfce7',
    'chart-1': '#1e3a8a',
    'chart-2': '#f97316',
    'chart-3': '#0f766e',
    'chart-4': '#d97706',
    'chart-5': '#6d28d9',
    'chart-6': '#64748b',
    'focus-inner': '#fed7aa',
    'focus-outer': '#c2410c',
  },
  dark: {
    surface: '#0a1433',
    'surface-raised': '#0d1b4b',
    'surface-sunken': '#081029',
    ink: '#f1f5f9',
    'ink-muted': '#c3cbe0',
    'ink-subtle': '#9aa6c7',
    line: '#24346f',
    'line-strong': '#3a4a85',
    accent: '#f97316',
    'accent-hover': '#fb923c',
    'accent-ink': '#0d1b4b',
    'accent-soft': '#3a1d12',
    'accent-soft-ink': '#fdba74',
    'accent-bright': '#f97316',
    navy: '#081029',
    'navy-raised': '#13235a',
    'navy-ink': '#ffffff',
    'navy-ink-muted': '#cbd5e1',
    'navy-ink-subtle': '#9aa6c7',
    positive: '#4ade80',
    'positive-soft': '#0f2e22',
    'positive-ink': '#86efac',
    caution: '#fbbf24',
    'caution-soft': '#3a2a0b',
    'caution-ink': '#fcd34d',
    critical: '#f87171',
    'critical-soft': '#3d1518',
    'critical-ink': '#fca5a5',
    info: '#93c5fd',
    'info-soft': '#13235a',
    'info-ink': '#bfdbfe',
    'neutral-soft': '#13235a',
    'neutral-ink': '#cbd5e1',
    'whatsapp': '#25d366',
    'whatsapp-ink': '#0a1433',
    'bubble-in': '#13235a',
    'bubble-out': '#0f3a2a',
    'chart-1': '#93c5fd',
    'chart-2': '#f97316',
    'chart-3': '#2dd4bf',
    'chart-4': '#fbbf24',
    'chart-5': '#a78bfa',
    'chart-6': '#94a3b8',
    'focus-inner': '#7c2d12',
    'focus-outer': '#fb923c',
  },
}

/**
 * Text-on-surface pairs to check: [foreground token, background token, minimum ratio].
 * Tokens starting with "--" are Payload variables; others are --sa-* names.
 */
export const contrastPairs = [
  ['ink', 'surface', 4.5], ['ink', 'surface-raised', 4.5], ['ink', 'surface-sunken', 4.5],
  ['ink-muted', 'surface', 4.5], ['ink-muted', 'surface-raised', 4.5], ['ink-muted', 'surface-sunken', 4.5],
  ['ink-subtle', 'surface', 4.5], ['ink-subtle', 'surface-raised', 4.5],
  ['accent', 'surface-raised', 4.5], ['accent', 'surface', 4.5], ['accent-ink', 'accent', 4.5], ['accent-ink', 'accent-hover', 4.5],
  ['accent-soft-ink', 'accent-soft', 4.5],
  ['navy-ink', 'navy', 4.5], ['navy-ink-muted', 'navy', 4.5], ['navy-ink-subtle', 'navy', 4.5], ['navy-ink-muted', 'navy-raised', 4.5],
  ['positive-ink', 'positive-soft', 4.5], ['caution-ink', 'caution-soft', 4.5], ['critical-ink', 'critical-soft', 4.5],
  ['info-ink', 'info-soft', 4.5], ['neutral-ink', 'neutral-soft', 4.5],
  ['positive', 'surface-raised', 3], ['caution', 'surface-raised', 3], ['critical', 'surface-raised', 3], ['info', 'surface-raised', 3],
  ['critical', 'surface-raised', 4.5],
  ['whatsapp-ink', 'whatsapp', 4.5], ['ink', 'bubble-in', 4.5], ['ink', 'bubble-out', 4.5],
  ['line-strong', 'surface-raised', 1.4],
  ['--theme-text', '--theme-bg', 4.5], ['--theme-text', '--theme-input-bg', 4.5], ['--theme-text', '--theme-elevation-50', 4.5],
  ['--theme-elevation-800', '--theme-bg', 4.5], ['--theme-elevation-650', '--theme-bg', 4.5],
  ['--theme-elevation-500', '--theme-bg', 4.5], ['--theme-elevation-500', '--theme-elevation-0', 4.5],
  ['--theme-elevation-500', '--theme-elevation-50', 4.5],
  ['--theme-elevation-1000', '--theme-elevation-100', 4.5],
  ['--theme-elevation-250', '--theme-bg', 1.4],
]
