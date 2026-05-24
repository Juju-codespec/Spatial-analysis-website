import { useMemo } from 'react';
import type { Dataset } from '../../types';

interface Props {
  dataset: Dataset;
  selectedMarkers?: string[];
}

export default function HeatmapView({ dataset, selectedMarkers }: Props) {
  const markers = selectedMarkers?.length ? selectedMarkers : dataset.markers;
  const cellTypes = dataset.cellTypes;

  // Single-pass matrix builder. The previous version filtered+mapped over
  // `dataset.cells` once per (cellType × marker) pair which was O(cells × ct × m)
  // and could freeze the browser on large uploads.
  const matrix = useMemo(() => {
    const sums: Record<string, Record<string, number>> = {};
    const counts: Record<string, number> = {};
    for (const ct of cellTypes) {
      sums[ct] = {};
      counts[ct] = 0;
      for (const m of markers) sums[ct][m] = 0;
    }
    for (const cell of dataset.cells) {
      const row = sums[cell.cellType];
      if (!row) continue;
      counts[cell.cellType]++;
      for (const m of markers) {
        const v = cell.markers[m];
        if (v !== undefined) row[m] += v;
      }
    }
    const out: Record<string, Record<string, number>> = {};
    for (const ct of cellTypes) {
      out[ct] = {};
      const n = counts[ct] || 1;
      for (const m of markers) out[ct][m] = sums[ct][m] / n;
    }
    return out;
  }, [dataset.cells, cellTypes, markers]);

  const getColor = (value: number) => {
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
  };

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max">
        {/* Column headers (markers) */}
        <div className="flex">
          <div className="w-32 shrink-0" />
          {markers.map(m => (
            <div key={m} className="w-20 text-center">
              <span className="text-[10px] font-mono text-slate-400 block transform -rotate-45 origin-bottom-left ml-3 mb-1 whitespace-nowrap">{m}</span>
            </div>
          ))}
        </div>

        <div className="mt-6 space-y-1">
          {cellTypes.map(ct => (
            <div key={ct} className="flex items-center gap-0">
              <div className="w-32 shrink-0 text-right pr-3">
                <span className="text-xs text-slate-400 truncate block">{ct}</span>
              </div>
              {markers.map(m => {
                const val = matrix[ct]?.[m] ?? 0;
                return (
                  <div
                    key={m}
                    className="w-20 h-9 flex items-center justify-center relative group"
                    style={{ background: getColor(val) }}
                    title={`${ct} · ${m}: ${(val * 100).toFixed(1)}%`}
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

        {/* Color scale */}
        <div className="mt-4 flex items-center gap-3 pl-32">
          <span className="text-[10px] text-slate-500">0%</span>
          <div className="h-2 w-40 rounded" style={{
            background: 'linear-gradient(to right, #0d1117, #3b3bb0, #5566d9, #ef4444, #ff5555)'
          }} />
          <span className="text-[10px] text-slate-500">100%</span>
          <span className="text-[10px] text-slate-600 ml-2">Mean expression per cell type</span>
        </div>
      </div>
    </div>
  );
}
