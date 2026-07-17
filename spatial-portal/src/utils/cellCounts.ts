import type { CellPoint } from '../types';

/** Count cells per type from a loaded cell array. */
export function countCellTypes(cells: CellPoint[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const cell of cells) {
    counts[cell.cellType] = (counts[cell.cellType] ?? 0) + 1;
  }
  return counts;
}

/** Sort cell types by count (desc), then name. */
export function sortedCellTypeEntries(
  counts: Record<string, number>,
): [string, number][] {
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
