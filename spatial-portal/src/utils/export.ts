/** Download helpers for analysis tables and results. */

function escapeCsvCell(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  if (rows.length === 0) return '';
  const cols = columns ?? Object.keys(rows[0]);
  const header = cols.map(escapeCsvCell).join(',');
  const body = rows.map(row => cols.map(c => escapeCsvCell(row[c])).join(',')).join('\n');
  return `${header}\n${body}`;
}

export function downloadText(content: string, filename: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(rows: Array<Record<string, unknown>>, filename: string, columns?: string[]): void {
  downloadText(rowsToCsv(rows, columns), filename, 'text/csv;charset=utf-8');
}

export function downloadJson(data: unknown, filename: string): void {
  downloadText(JSON.stringify(data, null, 2), filename, 'application/json;charset=utf-8');
}
