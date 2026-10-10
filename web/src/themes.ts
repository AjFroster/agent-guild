/**
 * The looks the guild's panels, chat and forms can wear (themes.css). The village is drawn
 * the same in all. Kept free of React so the browser tests can import it too.
 */
export const THEMES = [
  { id: 'control-room', name: 'Control Room', note: 'Graphite, hairlines and amber' },
  { id: 'telemetry', name: 'Telemetry', note: 'All mono, cyan on black' },
  { id: 'hazard', name: 'Hazard', note: 'Concrete, black rules, safety yellow' },
  { id: 'classic', name: 'Classic', note: 'The original look' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeId = 'control-room';

/** A stored theme name, or the default when it is missing or no longer exists. */
export function themeOf(value: unknown): ThemeId {
  return THEMES.some((t) => t.id === value) ? (value as ThemeId) : DEFAULT_THEME;
}
