/** Format a numeric value for display; handles null/undefined/NaN/Inf from the API. */
export function formatNum(value: unknown, digits = 2): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

/** Format a numeric range (e.g. confidence interval bounds). */
export function formatRange(lower: unknown, upper: unknown, digits = 2): string {
  return `${formatNum(lower, digits)}–${formatNum(upper, digits)}`;
}
