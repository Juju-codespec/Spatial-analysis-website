import { useMemo } from 'react';
import type { Dataset } from '../../types';
import type { PhenotypeSummaryResponse } from '../../api/types';
import { Loader2 } from 'lucide-react';

interface Props {
  dataset: Dataset;
  selectedMarkers?: string[];
  /**
   * When provided (fetched from GET /datasets/<id>/phenotype-summary),
   * the heatmap renders phenotype co-expression from the API and skips
   * the per-cell matrix build — this is the path for API-backed datasets
   * whose cells are loaded without marker intensity values.
   */
  apiSummary?: PhenotypeSummaryResponse | null;
  apiSummaryLoading?: boolean;
}

// ─── colour ramp (dark-blue → purple → magenta) ───────────────────────────
function getColor(value: number): string {
  const v = Math.max(0, Math.min(1, value));
  if (v < 0.25) {
    const t = v / 0.25;
    return `rgba(${Math.round(13 + t * 42)}, ${Math.round(17 + t * 43)}, ${Math.round(23 + t * 84)}, 1)`;
  } else if (v < 0.5) {
    const t = (v - 0.25) / 0.25;
    return `rgba(${Math.round(55 + t * 30)}, ${Math.round(60 + t * 40)}, ${Math.round(107 + t * 110)}, 1)`;
  } else if (v < 0.75) {
    const t = (v - 0.5) / 0.25;
    return `rgba(${Math.round(85 + t * 120)}, ${Math.round(100 - t * 10)}, ${Math.round(217 - t * 100)}, 1)`;
  } else {
    const t = (v - 0.75) / 0.25;
    return `rgba(${Math.round(205 + t * 50)}, ${Math.round(90 - t * 60)}, ${Math.round(117 - t * 90)}, 1)`;
  }
}

function HeatmapGrid({
  cellTypes,
  markers,
  getValue,
  valueLabel,
}: {
  cellTypes: string[];
  markers: string[];
  getValue: (ct: string, m: string) => number;
  valueLabel: string;
}) {
  if (cellTypes.length === 0 || markers.length === 0) {
    return (
      <p className="text-xs text-slate-500 text-center py-8">
        No data available for this dataset.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max">
        {/* Column headers */}
        <div className="flex">
          <div className="w-36 shrink-0" />
          {markers.map(m => (
            <div key={m} className="w-20 text-center">
              <span className="text-[10px] font-mono text-slate-400 block transform -rotate-45 origin-bottom-left ml-3 mb-1 whitespace-nowrap">
                {m}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-6 space-y-1">
          {cellTypes.map(ct => (
            <div key={ct} className="flex items-center gap-0">
              <div className="w-36 shrink-0 text-right pr-3">
                <span className="text-xs text-slate-400 truncate block">{ct}</span>
              </div>
              {markers.map(m => {
                const val = getValue(ct, m);
                return (
                  <div
                    key={m}
                    className="w-20 h-9 flex items-center justify-center relative group"
                    style={{ background: getColor(val) }}
                    title={`${ct} · ${m}: ${(val * 100).toFixed(1)}${valueLabel}`}
                  >
                    <span className="text-[9px] font-mono text-white/80 opacity-0 group-hover:opacity-100 transition-opacity">
                      {(val * 100).toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Colour scale */}
        <div className="mt-4 flex items-center gap-3 pl-36">
          <span className="text-[10px] text-slate-500">0%</span>
          <div
            className="h-2 w-40 rounded"
            style={{
              background:
                'linear-gradient(to right, #0d1117, #3b3bb0, #5566d9, #ef4444, #ff5555)',
            }}
          />
          <span className="text-[10px] text-slate-500">100%</span>
          <span className="text-[10px] text-slate-600 ml-2">{valueLabel}</span>
        </div>
      </div>
    </div>
  );
}

export default function HeatmapView({
  dataset,
  selectedMarkers,
  apiSummary,
  apiSummaryLoading = false,
}: Props) {
  // ── Path A: API phenotype summary (API-backed datasets) ──────────────────
  const hasApiSummary =
    apiSummary != null &&
    apiSummary.cell_types.length > 0 &&
    apiSummary.markers.length > 0;

  // ── Path B: per-cell matrix (mock / locally-uploaded datasets with markers)
  const localMarkers = selectedMarkers?.length
    ? selectedMarkers
    : dataset.markers;
  const localCellTypes = dataset.cellTypes;

  const localMatrix = useMemo(() => {
    if (hasApiSummary || localMarkers.length === 0) return {};
    const sums: Record<string, Record<string, number>> = {};
    const counts: Record<string, number> = {};
    for (const ct of localCellTypes) {
      sums[ct] = {};
      counts[ct] = 0;
      for (const m of localMarkers) sums[ct][m] = 0;
    }
    for (const cell of dataset.cells) {
      const row = sums[cell.cellType];
      if (!row) continue;
      counts[cell.cellType]++;
      for (const m of localMarkers) {
        const v = cell.markers[m];
        if (v !== undefined) row[m] += v;
      }
    }
    const out: Record<string, Record<string, number>> = {};
    for (const ct of localCellTypes) {
      out[ct] = {};
      const n = counts[ct] || 1;
      for (const m of localMarkers) out[ct][m] = sums[ct][m] / n;
    }
    return out;
  }, [dataset.cells, localCellTypes, localMarkers, hasApiSummary]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (apiSummaryLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-500">
        <Loader2 size={14} className="animate-spin" />
        Loading phenotype summary…
      </div>
    );
  }

  // ── No data at all ────────────────────────────────────────────────────────
  const noApiData = !hasApiSummary && apiSummary !== null && apiSummary !== undefined;
  const noLocalData = !hasApiSummary && localMarkers.length === 0;

  if (noApiData && noLocalData) {
    return (
      <div className="text-center py-10 text-xs text-slate-500 space-y-1">
        <p className="font-medium text-slate-400">No marker data available</p>
        <p>
          This dataset does not contain phenotype intensity columns.
          Upload a CSV with <code className="text-brand-300">phenotype_cd8</code>,{' '}
          <code className="text-brand-300">phenotype_cd4</code>, etc. to enable
          the expression heatmap.
        </p>
      </div>
    );
  }

  // ── Path A render ─────────────────────────────────────────────────────────
  if (hasApiSummary) {
    return (
      <div className="space-y-2">
        <p className="text-[11px] text-slate-500">
          Mean phenotype positivity per cell type — proportion of cells in each
          type that express the marker (0–100 %).
        </p>
        <HeatmapGrid
          cellTypes={apiSummary.cell_types}
          markers={apiSummary.markers}
          getValue={(ct, m) => apiSummary.matrix[ct]?.[m] ?? 0}
          valueLabel="% positive"
        />
      </div>
    );
  }

  // ── Path B render (local cells) ───────────────────────────────────────────
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-500">
        Mean marker expression per cell type.
      </p>
      <HeatmapGrid
        cellTypes={localCellTypes}
        markers={localMarkers}
        getValue={(ct, m) => localMatrix[ct]?.[m] ?? 0}
        valueLabel="mean expression"
      />
    </div>
  );
}
