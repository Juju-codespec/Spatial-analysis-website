// Wilcoxon rank-sum comparison of per-sample spatial summaries between
// status = 0 vs status = 1 from survival metadata.

import { useEffect, useMemo, useState } from 'react';
import Plot from '../../lib/plot';
import type { Data, Layout } from 'plotly.js';
import { useWilcoxon } from '../../hooks/useAnalysis';
import type { WilcoxonResponse } from '../../api/types';
import { Loader2, AlertCircle } from 'lucide-react';

interface Props {
  datasetId: string;
  availableCellTypes: string[];
  hasSurvival: boolean;
  survivalColumns: string[];
}

const DEFAULT_T_CELL_OPTIONS = ['CD8+ T Cell', 'CD4+ T Cell', 'T Cell', 'CD8_T'];
const DEFAULT_MIN_FOCAL = 10;
const GROUP_COLUMN = 'status';

function pickDefaultCellType(available: string[]): string {
  if (available.length === 0) return DEFAULT_T_CELL_OPTIONS[0];
  const preferred = available.find(ct => DEFAULT_T_CELL_OPTIONS.includes(ct));
  return preferred ?? available[0];
}

function formatP(p: number): string {
  if (!isFinite(p)) return '—';
  if (p < 0.001) return '< 0.001';
  return p.toFixed(3);
}

export default function WilcoxonView({
  datasetId,
  availableCellTypes,
  hasSurvival,
  survivalColumns,
}: Props) {
  const tCellOptions = availableCellTypes.length > 0 ? availableCellTypes : DEFAULT_T_CELL_OPTIONS;
  const [typeA, setTypeA] = useState(() => pickDefaultCellType(tCellOptions));
  const [statistic, setStatistic] = useState<'K' | 'G'>('K');
  const [radius, setRadius] = useState(50);
  const [minFocalCells, setMinFocalCells] = useState(DEFAULT_MIN_FOCAL);

  const hasStatusColumn = survivalColumns.includes(GROUP_COLUMN);

  useEffect(() => {
    if (availableCellTypes.length === 0) return;
    setTypeA(prev =>
      availableCellTypes.includes(prev) ? prev : pickDefaultCellType(availableCellTypes),
    );
  }, [availableCellTypes]);

  const req = useMemo(() => {
    if (!hasSurvival || !hasStatusColumn) return null;
    return {
      datasetId,
      statistic,
      radius,
      typeA,
      groupColumn: GROUP_COLUMN,
      minFocalCells,
      windowType: 'convex' as const,
    };
  }, [datasetId, statistic, radius, typeA, minFocalCells, hasSurvival, hasStatusColumn]);

  const { data, loading, error } = useWilcoxon(req);

  if (!hasSurvival) {
    return (
      <div className="card p-5 border-dashed border-slate-700">
        <p className="text-xs font-semibold text-slate-300">Group comparison (Wilcoxon)</p>
        <p className="text-xs text-slate-500 mt-2">
          Attach a <code className="text-brand-400">survival.csv</code> with{' '}
          <code className="text-brand-400">sample_id</code>,{' '}
          <code className="text-brand-400">time</code>, and{' '}
          <code className="text-brand-400">status</code> on the Survival tab.
        </p>
      </div>
    );
  }

  if (!hasStatusColumn) {
    return (
      <div className="card p-5 border-dashed border-amber-800/40 bg-amber-950/20">
        <p className="text-xs font-semibold text-amber-200">Group comparison (Wilcoxon)</p>
        <p className="text-xs text-amber-300/90 mt-2">
          Survival data must include a <code className="text-amber-200">status</code> column
          (0 = censored, 1 = event) with both values present across samples.
        </p>
      </div>
    );
  }

  const statLabel = statistic === 'K' ? 'L(r) − r' : 'G(r) − G_csr(r)';

  return (
    <div className="card p-5 space-y-5 border-t-4 border-t-brand-800/60">
      <div>
        <p className="text-xs font-semibold text-slate-300">
          Group comparison · Wilcoxon rank sum
        </p>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Compare per-sample {statLabel} at r = {radius} px between{' '}
          <code className="text-brand-400">status = 0</code> and{' '}
          <code className="text-brand-400">status = 1</code> via{' '}
          <code className="text-brand-400">wilcox.test(stat ~ status)</code>.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
        <label>
          <span className="text-slate-400 mb-1 block">Statistic</span>
          <select
            className="input text-xs"
            value={statistic}
            onChange={e => {
              const next = e.target.value as 'K' | 'G';
              setStatistic(next);
              setRadius(next === 'K' ? 50 : 20);
            }}
          >
            <option value="K">Ripley&apos;s K (L − r)</option>
            <option value="G">Nearest-Neighbour G</option>
          </select>
        </label>
        <label>
          <span className="text-slate-400 mb-1 block">Cell type</span>
          <select className="input text-xs" value={typeA} onChange={e => setTypeA(e.target.value)}>
            {tCellOptions.map(ct => (
              <option key={ct} value={ct}>{ct}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-slate-400 mb-1 block">Radius (px)</span>
          <input
            type="number"
            min={5}
            max={500}
            step={5}
            value={radius}
            onChange={e => setRadius(Math.max(5, Number(e.target.value) || 50))}
            className="input text-xs"
          />
        </label>
        <label>
          <span className="text-slate-400 mb-1 block">Group column</span>
          <input className="input text-xs bg-slate-800/80" value="status" readOnly />
        </label>
        <label>
          <span className="text-slate-400 mb-1 block">Min focal cells / sample</span>
          <input
            type="number"
            min={1}
            max={500}
            step={1}
            value={minFocalCells}
            onChange={e => setMinFocalCells(Math.max(1, Number(e.target.value) || DEFAULT_MIN_FOCAL))}
            className="input text-xs"
          />
        </label>
      </div>

      {loading && (
        <div className="border border-slate-800 rounded-lg p-6 bg-slate-900/40 flex items-center justify-center text-xs text-slate-500 gap-2">
          <Loader2 size={14} className="animate-spin" /> Running Wilcoxon test on backend…
        </div>
      )}
      {error && (
        <div className="border border-rose-700/50 rounded-lg p-4 bg-rose-950/30 text-xs text-rose-300 flex items-start gap-2">
          <AlertCircle size={13} className="text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {data && <WilcoxonResults data={data} statLabel={statLabel} typeA={typeA} />}
    </div>
  );
}

function WilcoxonResults({
  data,
  statLabel,
  typeA,
}: {
  data: WilcoxonResponse;
  statLabel: string;
  typeA: string;
}) {
  const wx = data.wilcoxon;
  const [ga, gb] = wx.groups;

  return (
    <>
      {data.sample_filter && data.sample_filter.n_samples_excluded > 0 && (
        <p className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2">
          {data.sample_filter.n_samples_excluded} sample
          {data.sample_filter.n_samples_excluded === 1 ? '' : 's'} excluded
          (fewer than {data.sample_filter.min_focal_cells} {typeA} cells). Wilcoxon uses{' '}
          {wx.points.length} sample{wx.points.length === 1 ? '' : 's'} with group labels.
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
        <Metric label="W statistic" value={String(wx.w)} />
        <Metric
          label="p value"
          value={formatP(wx.p_value)}
          accent={wx.p_value < 0.05 ? 'good' : 'neutral'}
        />
        <Metric label={`n (${ga.label})`} value={String(ga.n)} />
        <Metric label={`n (${gb.label})`} value={String(gb.n)} />
        <Metric
          label="Median Δ"
          value={(ga.median - gb.median).toFixed(3)}
          sub={statLabel}
        />
        <Metric label="Rank-biserial r" value={wx.rank_biserial.toFixed(2)} />
      </div>

      <p className="text-[10px] text-slate-500 font-mono">
        {wx.method} · {wx.group_column}: {wx.group_a} vs {wx.group_b}
      </p>

      <WilcoxonBoxPlot points={wx.points} statLabel={statLabel} groupA={wx.group_a} groupB={wx.group_b} />
    </>
  );
}

function Metric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'good' | 'neutral';
}) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-slate-500">{label}</p>
      <p className={`text-base font-semibold ${accent === 'good' ? 'text-emerald-300' : 'text-slate-200'}`}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function WilcoxonBoxPlot({
  points,
  statLabel,
  groupA,
  groupB,
}: {
  points: WilcoxonResponse['wilcoxon']['points'];
  statLabel: string;
  groupA: string;
  groupB: string;
}) {
  const traces: Data[] = [groupA, groupB].map((g, i) => ({
    type: 'box',
    name: g,
    y: points.filter(p => p.group === g).map(p => p.stat),
    text: points.filter(p => p.group === g).map(p => p.sample_id),
    boxpoints: 'all',
    jitter: 0.35,
    marker: { size: 5, color: i === 0 ? '#3b82f6' : '#f97316' },
    line: { color: i === 0 ? '#3b82f6' : '#f97316' },
  }));

  const layout: Partial<Layout> = {
    title: { text: `${statLabel} by status`, font: { size: 12, color: '#cbd5e1' } },
    height: 280,
    margin: { l: 50, r: 20, t: 30, b: 40 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(15,23,42,0.4)',
    font: { color: '#94a3b8', size: 10 },
    yaxis: { title: { text: statLabel }, gridcolor: '#1e293b' },
    xaxis: { gridcolor: '#1e293b' },
    showlegend: false,
  };

  return (
    <Plot data={traces} layout={layout} style={{ width: '100%' }} config={{ displayModeBar: false }} />
  );
}
