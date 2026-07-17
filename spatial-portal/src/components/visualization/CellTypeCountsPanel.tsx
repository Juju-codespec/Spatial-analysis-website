import type { SpatialLayer } from '../../types';
import { sortedCellTypeEntries } from '../../utils/cellCounts';

interface Props {
  title: string;
  counts: Record<string, number>;
  layers: SpatialLayer[];
  loading?: boolean;
  subtitle?: string;
}

export default function CellTypeCountsPanel({
  title,
  counts,
  layers,
  loading = false,
  subtitle,
}: Props) {
  const colorByType = new Map(
    layers.filter(l => l.cellType).map(l => [l.cellType as string, l.color]),
  );
  const entries = sortedCellTypeEntries(counts);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);

  if (loading) {
    return (
      <div className="card px-4 py-3 text-xs text-slate-500">
        Loading cell type counts…
      </div>
    );
  }

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="card px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
        <p className="text-xs font-semibold text-slate-300">{title}</p>
        <span className="text-[10px] text-slate-500">
          {total.toLocaleString()} cells
          {subtitle ? ` · ${subtitle}` : ''}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {entries.map(([cellType, count]) => {
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={cellType} className="flex items-center gap-1.5 text-xs min-w-[140px]">
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: colorByType.get(cellType) ?? '#6b7280' }}
              />
              <span className="text-slate-300 truncate max-w-[120px]" title={cellType}>
                {cellType}
              </span>
              <span className="text-slate-500 font-mono tabular-nums ml-auto">
                {count.toLocaleString()}
              </span>
              <span className="text-[10px] text-slate-600 font-mono tabular-nums w-9 text-right">
                {pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
