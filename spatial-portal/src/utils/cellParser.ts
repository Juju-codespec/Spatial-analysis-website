import type { CellPoint } from '../types';

export interface ParseResult {
  cells: CellPoint[];
  error: string | null;
  detectedHeaders: string[];
  isMultiPhenotype: boolean;
}

/**
 * Properly splits a CSV line respecting quoted fields that may contain commas.
 * e.g. `"core[1,1,F]",2,hello` → ["core[1,1,F]", "2", "hello"]
 */
function splitCSVLine(line: string, sep: string): string[] {
  if (sep === '\t') return line.split('\t').map(c => c.trim());

  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Handle escaped quote ("")
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// Priority-ordered mapping: phenotype column suffix → cell type label.
// Earlier entries take precedence over later ones.
const PHENOTYPE_MAP: Array<{ suffix: string; cellType: string }> = [
  { suffix: 'cd8',    cellType: 'CD8+ T Cell' },
  { suffix: 'cd4',    cellType: 'CD4+ T Cell' },
  { suffix: 'cd3',    cellType: 'T Cell'       },
  { suffix: 'cd68',   cellType: 'Macrophage'   },
  { suffix: 'cd163',  cellType: 'Macrophage'   },
  { suffix: 'cd19',   cellType: 'B Cell'       },
  { suffix: 'cd20',   cellType: 'B Cell'       },
  { suffix: 'cd56',   cellType: 'NK Cell'      },
  { suffix: 'ck',     cellType: 'Tumor'        },
  { suffix: 'panck',  cellType: 'Tumor'        },
  { suffix: 'epcam',  cellType: 'Tumor'        },
  { suffix: 'fap',    cellType: 'CAF'          },
  { suffix: 'asma',   cellType: 'CAF'          },
  { suffix: 'sma',    cellType: 'CAF'          },
];

export function detectFormat(headers: string[]): 'multi-phenotype' | 'single-celltype' {
  const lower = headers.map(h => h.toLowerCase());
  const hasPhenotypeCols = lower.some(h => h.startsWith('phenotype_'));
  return hasPhenotypeCols ? 'multi-phenotype' : 'single-celltype';
}

/**
 * Parses a CSV/TSV whose cell type is encoded across multiple `phenotype_*` boolean columns
 * (values like "CD8+", "CD8-"). Derives a single cell type label per row using PHENOTYPE_MAP.
 * Marker expression values are inferred as 1 (positive) or 0 (negative) from these columns.
 */
export async function parseMultiPhenotypeFile(
  file: File,
  colMap: { x: string; y: string },
): Promise<ParseResult> {
  const text = await file.text();
  const sep = file.name.endsWith('.tsv') ? '\t' : ',';
  const rawLines = text.trim().split(/\r?\n/);
  if (rawLines.length < 2) {
    return { cells: [], error: 'File appears empty or has only a header row.', detectedHeaders: [], isMultiPhenotype: true };
  }

  const detectedHeaders = splitCSVLine(rawLines[0], sep).map(h => h.replace(/^"|"$/g, ''));

  const xIdx = detectedHeaders.indexOf(colMap.x);
  const yIdx = detectedHeaders.indexOf(colMap.y);

  const missingCoords = [
    xIdx === -1 && `"${colMap.x}"`,
    yIdx === -1 && `"${colMap.y}"`,
  ].filter(Boolean) as string[];

  if (missingCoords.length) {
    return {
      cells: [],
      error: `Coordinate column${missingCoords.length > 1 ? 's' : ''} not found: ${missingCoords.join(', ')}. ` +
        `Detected headers: ${detectedHeaders.slice(0, 10).join(', ')}${detectedHeaders.length > 10 ? '…' : ''}.`,
      detectedHeaders,
      isMultiPhenotype: true,
    };
  }

  // Resolve which phenotype columns are present, in priority order
  const resolvedPhenotypes = PHENOTYPE_MAP
    .map(({ suffix, cellType }) => {
      const idx = detectedHeaders.findIndex(h => h.toLowerCase() === `phenotype_${suffix}`);
      return idx !== -1 ? { suffix, cellType, idx } : null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const cells: CellPoint[] = [];

  for (const line of rawLines.slice(1)) {
    if (!line.trim()) continue;
    const cols = splitCSVLine(line, sep);
    const x = parseFloat(cols[xIdx]);
    const y = parseFloat(cols[yIdx]);
    if (isNaN(x) || isNaN(y)) continue;

    // Derive cell type: first positive phenotype marker wins
    let cellType = 'Other';
    const markers: Record<string, number> = {};

    for (const { suffix, cellType: ct, idx } of resolvedPhenotypes) {
      const raw = cols[idx]?.trim() ?? '';
      const isPositive = raw.endsWith('+');
      markers[suffix.toUpperCase()] = isPositive ? 1 : 0;
      if (isPositive && cellType === 'Other') cellType = ct;
    }

    cells.push({
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      cellType,
      markers,
    });
  }

  if (cells.length === 0) {
    return {
      cells: [],
      error: 'No valid rows could be parsed. Verify that x/y columns contain numeric coordinates.',
      detectedHeaders,
      isMultiPhenotype: true,
    };
  }

  return { cells, error: null, detectedHeaders, isMultiPhenotype: true };
}

/**
 * Unified entry point. Auto-detects the file format from its headers and
 * dispatches to the appropriate parser.
 */
export async function parseFile(
  file: File,
  colMap: { x: string; y: string; cellType: string; markers: string[] },
): Promise<ParseResult> {
  const text = await file.text();
  const sep = file.name.endsWith('.tsv') ? '\t' : ',';
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  const detectedHeaders = splitCSVLine(firstLine, sep).map(h => h.replace(/^"|"$/g, ''));
  const format = detectFormat(detectedHeaders);

  if (format === 'multi-phenotype') {
    return parseMultiPhenotypeFile(file, { x: colMap.x, y: colMap.y });
  }

  // ── Single cell-type column format ──────────────────────────────────────
  const rawLines = text.trim().split(/\r?\n/);
  if (rawLines.length < 2) {
    return { cells: [], error: 'File appears empty or has only a header row.', detectedHeaders, isMultiPhenotype: false };
  }

  const xIdx = detectedHeaders.indexOf(colMap.x);
  const yIdx = detectedHeaders.indexOf(colMap.y);
  const ctIdx = detectedHeaders.indexOf(colMap.cellType);

  const missing = [
    xIdx === -1 && `"${colMap.x}"`,
    yIdx === -1 && `"${colMap.y}"`,
    ctIdx === -1 && `"${colMap.cellType}"`,
  ].filter(Boolean) as string[];

  if (missing.length) {
    return {
      cells: [],
      error: `Column${missing.length > 1 ? 's' : ''} not found: ${missing.join(', ')}. ` +
        `Detected headers: ${detectedHeaders.slice(0, 8).join(', ')}${detectedHeaders.length > 8 ? '…' : ''}.`,
      detectedHeaders,
      isMultiPhenotype: false,
    };
  }

  const markerCols = colMap.markers
    .map(m => ({ name: m, idx: detectedHeaders.indexOf(m) }))
    .filter(m => m.idx !== -1);

  const cells: CellPoint[] = [];
  for (const line of rawLines.slice(1)) {
    if (!line.trim()) continue;
    const cols = splitCSVLine(line, sep);
    const x = parseFloat(cols[xIdx]);
    const y = parseFloat(cols[yIdx]);
    if (isNaN(x) || isNaN(y)) continue;
    const markers: Record<string, number> = {};
    for (const { name, idx } of markerCols) {
      const v = parseFloat(cols[idx]);
      if (!isNaN(v)) markers[name] = v;
    }
    cells.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, cellType: cols[ctIdx]?.trim() || 'Unknown', markers });
  }

  if (cells.length === 0) {
    return {
      cells: [],
      error: 'Columns were found but no valid rows could be parsed. Check that x/y values are numeric.',
      detectedHeaders,
      isMultiPhenotype: false,
    };
  }

  return { cells, error: null, detectedHeaders, isMultiPhenotype: false };
}
