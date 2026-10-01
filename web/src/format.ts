/** Short counts for tight panels: 950, 1.2k, 34k, 1.2M. */
export function compact(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return String(v);
  if (v < 999_500) return `${trim(v / 1000)}k`; // 999,999 reads 1M, not 1000k
  return `${trim(v / 1_000_000)}M`;
}

/** One decimal below 10, none above: 1.2k, 12k, 120k. */
const trim = (x: number) => (x < 10 ? x.toFixed(1).replace(/\.0$/, '') : String(Math.round(x)));

/** A span of seconds as "< 1 min", "42 min" or "3 h 5 min". */
export function duration(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  if (m < 1) return '< 1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}
