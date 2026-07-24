import type { Dataset } from '../types';

const CACHE_KEY = 'spatial-portal-datasets-v1';

/** Strip cell coordinates before persisting — they are re-fetched from the API. */
export function stripCellsForCache(datasets: Dataset[]): Dataset[] {
  return datasets.map(d => ({ ...d, cells: [] }));
}

export function saveDatasetCache(datasets: Dataset[]): void {
  try {
    const payload = stripCellsForCache(datasets);
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded or private browsing — ignore.
  }
}

export function loadDatasetCache(): Dataset[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Dataset[];
    return Array.isArray(parsed) ? parsed.map(d => ({ ...d, cells: d.cells ?? [] })) : [];
  } catch {
    return [];
  }
}

export function clearDatasetFromCache(id: string): void {
  const cached = loadDatasetCache().filter(d => d.id !== id);
  saveDatasetCache(cached);
}
