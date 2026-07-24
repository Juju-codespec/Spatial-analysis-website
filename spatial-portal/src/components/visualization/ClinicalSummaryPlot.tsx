// Clinical summary: marker vs clinical variable with plot types and tables.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Plot from '../../lib/plot';
import type { Data, Layout } from 'plotly.js';
import {
  useClinicalSummary,
  useClinicalSummaryTests,
} from '../../hooks/useAnalysis';
import { clinicalRoutesAvailable, type ClinicalSpatialQuery } from '../../api/client';
import type { ClinicalSummaryTest } from '../../api/types';
import { Loader2, AlertCircle } from 'lucide-react';
import clsx from 'clsx';

export interface SummaryPairFocus {
  markerColumn: string;
  clinicalColumn: string;
}

interface Props {
  datasetId: string;
  level: 'sample' | 'patient';
  onLevelChange?: (level: 'sample' | 'patient') => void;
  /** When true, parent renders aggregation control (e.g. Clinical Analysis header). */
  hideLevelControl?: boolean;
  spatialRequest?: ClinicalSpatialQuery | null;
  /** Set marker/clinical selectors from association screening click-through. */
  focusPair?: SummaryPairFocus | null;
}

const PREFERRED_CLINICAL = [
  'age', 'race', 'sex', 'gender', 'ethnicity', 'grade', 'stage',
  'treatment', 'arm', 'recurrence', 'brca_status', 'status',
];

const GROUP_COLORS = ['#3b82f6', '#f97316', '#8b5cf6', '#10b981', '#ec4899', '#eab308'];

type CategoricalPlotType = 'box' | 'violin' | 'strip' | 'bar_mean';
type NumericPlotType = 'scatter' | 'scatter_trend';
type PlotType = CategoricalPlotType | NumericPlotType;

type TableTab = 'summary' | 'frequency' | 'samples';

function featureLabel(col: string): string {
  if (col === 'spatial_cluster_stat') return 'Spatial clustering stat';
  return col
    .replace(/^count_/, 'count ')
    .replace(/^pct_/, '% ')
    .replace(/^ratio_/, 'ratio ')
    .replace(/_/g, ' ');
}

function formatP(p: number): string {
  if (!isFinite(p)) return '—';
  if (p < 0.001) return '< 0.001';
  return p.toFixed(3);
}

function defaultMarkerColumn(
  markerColumns: string[],
  cellTypes: string[],
  ratioColumns: string[],
): string {
  const pcts = markerColumns.filter(c => c.startsWith('pct_'));
  for (const ct of cellTypes) {
    const key = ct.replace(/\+/g, 'plus').replace(/[^A-Za-z0-9_]+/g, '_');
    const col = pcts.find(c => c === `pct_${key}` || c.includes(key.slice(0, 6)));
    if (col) return col;
  }
  if (pcts.length > 0) return pcts[0];
  if (ratioColumns.length > 0) return ratioColumns[0];
  return markerColumns[0] ?? '';
}

function defaultClinicalColumn(columns: string[]): string {
  const pref = PREFERRED_CLINICAL.find(c => columns.includes(c));
  if (pref) return pref;
  return columns.find(c => c !== 'time') ?? columns[0] ?? '';
}

type MarkerOption = { value: string; label: string; group?: string };

function buildMarkerOptions(
  markerColumns: string[],
  ratioColumns: string[],
  markers: Array<{ cell_type: string; count_column: string; pct_column: string }>,
): MarkerOption[] {
  const out: MarkerOption[] = [];
  for (const m of markers) {
    if (m.pct_column && markerColumns.includes(m.pct_column)) {
      out.push({
        value: m.pct_column,
        label: `${m.cell_type} — % cells`,
        group: m.cell_type,
      });
    }
    if (m.count_column && markerColumns.includes(m.count_column)) {
      out.push({
        value: m.count_column,
        label: `${m.cell_type} — count`,
        group: m.cell_type,
      });
    }
  }
  if (out.length === 0) {
    for (const col of markerColumns) {
      out.push({ value: col, label: featureLabel(col) });
    }
  }
  for (const col of ratioColumns) {
    out.push({ value: col, label: featureLabel(col), group: 'Ratios' });
  }
  if (markerColumns.includes('spatial_cluster_stat')) {
    out.unshift({
      value: 'spatial_cluster_stat',
      label: 'Spatial clustering (K/G summary)',
      group: 'Spatial',
    });
  }
  return out;
}

interface FreqRow {
  level: string;
  count: number;
  pct: string;
}

interface GroupSummaryRow {
  group: string;
  n: number;
  mean: string;
  median: string;
  sd: string;
}

function clinicalFrequency(rows: Array<Record<string, unknown>>, col: string): FreqRow[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = r[col];
    if (v == null || v === '') continue;
    const key = String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([level, count]) => ({
      level,
      count,
      pct: total > 0 ? `${((100 * count) / total).toFixed(1)}%` : '—',
    }));
}

function groupSummaries(
  rows: Array<Record<string, unknown>>,
  markerColumn: string,
  clinicalColumn: string,
): GroupSummaryRow[] {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const g = String(r[clinicalColumn] ?? '');
    const y = Number(r[markerColumn]);
    if (!g || !Number.isFinite(y)) continue;
    const arr = groups.get(g) ?? [];
    arr.push(y);
    groups.set(g, arr);
  }
  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([group, vals]) => {
      const sorted = [...vals].sort((a, b) => a - b);
      const n = vals.length;
      const mean = vals.reduce((s, v) => s + v, 0) / n;
      const mid = Math.floor(n / 2);
      const median = n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      const sd =
        n > 1
          ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
          : 0;
      return {
        group,
        n,
        mean: mean.toFixed(2),
        median: median.toFixed(2),
        sd: sd.toFixed(2),
      };
    });
}

function linearTrend(x: number[], y: number[]): { slope: number; intercept: number } | null {
  const n = x.length;
  if (n < 2) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  return { slope, intercept: my - slope * mx };
}

export default function ClinicalSummaryPlot({
  datasetId,
  level,
  onLevelChange,
  hideLevelControl = false,
  spatialRequest = null,
  focusPair = null,
}: Props) {
  const summary = useClinicalSummary(datasetId, level, spatialRequest);
  const markerColumns = summary.data?.marker_columns ?? [];
  const ratioColumns = summary.data?.ratio_columns ?? [];
  const clinicalColumns = summary.data?.clinical_columns ?? [];
  const columnTypes = summary.data?.column_types ?? {};
  const rows = summary.data?.rows ?? [];

  const [markerColumn, setMarkerColumn] = useState('');
  const [clinicalColumn, setClinicalColumn] = useState('');
  const [plotType, setPlotType] = useState<PlotType>('box');
  const [tableTab, setTableTab] = useState<TableTab>('summary');
  const [staleApi, setStaleApi] = useState<boolean | null>(null);

  const markerOptions = useMemo(
    () => buildMarkerOptions(markerColumns, ratioColumns, summary.data?.markers ?? []),
    [markerColumns, ratioColumns, summary.data?.markers],
  );

  const markerValues = useMemo(
    () => new Set(markerOptions.map(o => o.value)),
    [markerOptions],
  );

  useEffect(() => {
    let cancelled = false;
    clinicalRoutesAvailable().then(ok => {
      if (!cancelled) setStaleApi(!ok);
    });
    return () => { cancelled = true; };
  }, [datasetId]);

  useEffect(() => {
    if (!summary.data) return;
    setMarkerColumn(prev =>
      markerValues.has(prev)
        ? prev
        : defaultMarkerColumn(markerColumns, summary.data!.cell_types, ratioColumns),
    );
    setClinicalColumn(prev =>
      clinicalColumns.includes(prev) ? prev : defaultClinicalColumn(clinicalColumns),
    );
  }, [summary.data, markerColumns, ratioColumns, clinicalColumns, markerValues]);

  useEffect(() => {
    if (!focusPair || !summary.data) return;
    if (markerValues.has(focusPair.markerColumn)) {
      setMarkerColumn(focusPair.markerColumn);
    }
    if (clinicalColumns.includes(focusPair.clinicalColumn)) {
      setClinicalColumn(focusPair.clinicalColumn);
    }
  }, [focusPair, summary.data, markerValues, clinicalColumns]);

  const clinicalType = clinicalColumn
    ? (columnTypes[clinicalColumn] ?? 'categorical')
    : 'categorical';
  const isNumeric = clinicalType === 'numeric';

  useEffect(() => {
    setPlotType(isNumeric ? 'scatter' : 'box');
  }, [isNumeric, clinicalColumn]);

  const testReq = useMemo(() => {
    if (!markerColumn || !clinicalColumn) return null;
    return {
      datasetId,
      level,
      pairs: [{ markerColumn, clinicalColumn }],
      ...spatialRequest,
    };
  }, [datasetId, level, markerColumn, clinicalColumn, spatialRequest]);

  const testsQuery = useClinicalSummaryTests(testReq);
  const test = testsQuery.data?.tests?.[0];

  const ready = summary.data?.has_clinical === true;

  const frequencies = useMemo(
    () => (clinicalColumn ? clinicalFrequency(rows, clinicalColumn) : []),
    [rows, clinicalColumn],
  );

  const groupStats = useMemo(
    () =>
      !isNumeric && markerColumn && clinicalColumn
        ? groupSummaries(rows, markerColumn, clinicalColumn)
        : [],
    [rows, markerColumn, clinicalColumn, isNumeric],
  );

  const plotOptions = isNumeric
    ? [
        { value: 'scatter' as const, label: 'Scatter' },
        { value: 'scatter_trend' as const, label: 'Scatter + trend' },
      ]
    : [
        { value: 'box' as const, label: 'Box plot' },
        { value: 'violin' as const, label: 'Violin' },
        { value: 'strip' as const, label: 'Strip (jitter)' },
        { value: 'bar_mean' as const, label: 'Bar (mean ± SE)' },
      ];

  return (
    <div className="card p-5 space-y-5 border-t-4 border-t-brand-800/60">
      <div>
        <p className="text-xs font-semibold text-slate-300">
          Clinical summary · Cell markers vs metadata
        </p>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Compare image-derived cell markers to clinical variables. Count/proportion-derived
          endpoints use beta-binomial models; other categorical endpoints use Wilcoxon
          (2 groups) or Kruskal-Wallis (3+), and numeric clinical variables use Spearman
          correlation.
        </p>
      </div>

      {summary.loading && (
        <div className="border border-slate-800 rounded-lg p-6 bg-slate-900/40 flex items-center justify-center text-xs text-slate-500 gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading merged clinical data…
        </div>
      )}

      {(staleApi === true || summary.error?.includes('404 - Resource Not Found')) && (
        <div className="text-xs text-amber-200 flex gap-2 rounded-lg border border-amber-800/50 bg-amber-950/30 p-3">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span>
            The API on port 8000 is an older build without clinical routes. Stop it and run{' '}
            <code className="text-amber-100">npm run api</code> from the project root, then reload.
          </span>
        </div>
      )}

      {summary.error && staleApi !== true && !summary.error.includes('404 - Resource Not Found') && (
        <div className="text-xs text-rose-300 flex gap-2 rounded-lg border border-rose-800/50 bg-rose-950/30 p-3">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span>{summary.error}</span>
        </div>
      )}

      {!summary.loading && !summary.error && !ready && (
        <p className="text-xs text-slate-500">Attach clinical metadata to enable summary plots and tables.</p>
      )}

      {ready && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Metric label="Samples" value={String(summary.data?.n_rows ?? rows.length)} />
            <Metric
              label="Test"
              value={test?.method?.split(' ')[0] ?? (testsQuery.loading ? '…' : '—')}
              sub={test?.method}
            />
            <Metric
              label="p value"
              value={test?.p_value != null ? formatP(test.p_value) : '—'}
              accent={test?.p_value != null && test.p_value < 0.05 ? 'good' : 'neutral'}
            />
            <Metric
              label="Statistic"
              value={
                test?.statistic != null && typeof test.statistic === 'number'
                  ? test.statistic.toFixed(3)
                  : '—'
              }
              sub={test?.n != null ? `n = ${test.n}` : undefined}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
            {onLevelChange && !hideLevelControl && (
              <label>
                <span className="text-slate-400 mb-1 block">Aggregation</span>
                <select
                  className="input text-xs w-full"
                  value={level}
                  onChange={e => onLevelChange(e.target.value as 'sample' | 'patient')}
                >
                  <option value="sample">Per sample</option>
                  <option value="patient">Per patient</option>
                </select>
              </label>
            )}
            <label>
              <span className="text-slate-400 mb-1 block">Cell marker</span>
              <select
                className="input text-xs w-full"
                value={markerColumn}
                onChange={e => setMarkerColumn(e.target.value)}
              >
                {markerOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-slate-400 mb-1 block">Clinical variable</span>
              <select
                className="input text-xs w-full"
                value={clinicalColumn}
                onChange={e => setClinicalColumn(e.target.value)}
              >
                {clinicalColumns.map(col => (
                  <option key={col} value={col}>
                    {col}
                    {columnTypes[col] === 'numeric' ? ' (numeric)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-slate-400 mb-1 block">Plot type</span>
              <select
                className="input text-xs w-full"
                value={plotType}
                onChange={e => setPlotType(e.target.value as PlotType)}
              >
                {plotOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col justify-end">
              <span className="text-slate-400 mb-1 block">Variable type</span>
              <span className="text-slate-300 py-1.5">
                {isNumeric ? 'Numeric' : 'Categorical'}
                {test?.n_levels != null && !isNumeric ? ` · ${test.n_levels} levels` : ''}
              </span>
            </label>
          </div>

          {testsQuery.loading && markerColumn && clinicalColumn && (
            <p className="text-xs text-slate-500 flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" /> Running association test…
            </p>
          )}

          {test?.error && (
            <p className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2">
              {test.error}
            </p>
          )}

          {markerColumn && clinicalColumn && (
            <>
              <ClinicalSummaryChart
                rows={rows}
                markerColumn={markerColumn}
                clinicalColumn={clinicalColumn}
                isNumeric={isNumeric}
                plotType={plotType}
                test={test}
              />

              <div className="border-t border-slate-800 pt-4 space-y-3">
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      ['summary', isNumeric ? 'Correlation summary' : 'Group summary'],
                      ['frequency', 'Clinical frequency'],
                      ['samples', 'Sample data'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTableTab(id)}
                      className={clsx(
                        'px-2.5 py-1 rounded-md border text-xs transition-colors',
                        tableTab === id
                          ? 'bg-brand-900/50 border-brand-700 text-brand-300'
                          : 'bg-slate-900 border-slate-700 text-slate-500 hover:text-slate-300',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {tableTab === 'summary' && (
                  <TestSummaryTable test={test} isNumeric={isNumeric} groupStats={groupStats} />
                )}
                {tableTab === 'frequency' && (
                  <FrequencyTable
                    title={clinicalColumn}
                    rows={frequencies}
                  />
                )}
                {tableTab === 'samples' && (
                  <SampleDataTable
                    rows={rows}
                    markerColumn={markerColumn}
                    clinicalColumn={clinicalColumn}
                  />
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ClinicalSummaryChart({
  rows,
  markerColumn,
  clinicalColumn,
  isNumeric,
  plotType,
  test,
}: {
  rows: Array<Record<string, string | number | null>>;
  markerColumn: string;
  clinicalColumn: string;
  isNumeric: boolean;
  plotType: PlotType;
  test?: ClinicalSummaryTest;
}) {
  const layoutBase: Partial<Layout> = {
    height: 340,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(15,23,42,0.4)',
    font: { color: '#94a3b8', size: 10 },
    margin: { l: 52, r: 24, t: 36, b: 52 },
  };

  const titleText = `${featureLabel(markerColumn)} vs ${clinicalColumn}`;
  const subtitle =
    test?.method && !test.error
      ? `${test.method}${test.p_value != null ? ` · p = ${formatP(test.p_value)}` : ''}`
      : undefined;

  if (isNumeric) {
    const points = rows
      .map(r => ({ x: Number(r[clinicalColumn]), y: Number(r[markerColumn]) }))
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    const traces: Data[] = [{
      type: 'scatter',
      mode: 'markers',
      x: points.map(p => p.x),
      y: points.map(p => p.y),
      marker: { size: 9, color: '#3b82f6', opacity: 0.85 },
      name: 'Samples',
    }];
    if (plotType === 'scatter_trend' && points.length >= 2) {
      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
      const trend = linearTrend(xs, ys);
      if (trend) {
        const xMin = Math.min(...xs);
        const xMax = Math.max(...xs);
        traces.push({
          type: 'scatter',
          mode: 'lines',
          x: [xMin, xMax],
          y: [trend.slope * xMin + trend.intercept, trend.slope * xMax + trend.intercept],
          line: { color: '#f97316', width: 2, dash: 'dash' },
          name: 'Linear trend',
        });
      }
    }
    return (
      <PlotPanel title={titleText} subtitle={subtitle}>
        <Plot
          data={traces}
          layout={{
            ...layoutBase,
            title: { text: plotType === 'scatter_trend' ? 'Scatter + trend' : 'Scatter', font: { size: 11, color: '#cbd5e1' } },
            xaxis: { title: { text: clinicalColumn }, gridcolor: '#1e293b' },
            yaxis: { title: { text: featureLabel(markerColumn) }, gridcolor: '#1e293b' },
            showlegend: plotType === 'scatter_trend',
            legend: { font: { size: 10 }, bgcolor: 'rgba(0,0,0,0)' },
          }}
          style={{ width: '100%' }}
          config={{ displayModeBar: false }}
        />
      </PlotPanel>
    );
  }

  const groups = Array.from(
    new Set(rows.map(r => String(r[clinicalColumn] ?? '')).filter(v => v.length > 0)),
  ).sort();

  const valuesByGroup = (g: string) =>
    rows
      .filter(r => String(r[clinicalColumn]) === g)
      .map(r => Number(r[markerColumn]))
      .filter(v => Number.isFinite(v));

  let traces: Data[] = [];
  const layout: Partial<Layout> = {
    ...layoutBase,
    yaxis: { title: { text: featureLabel(markerColumn) }, gridcolor: '#1e293b' },
    showlegend: plotType === 'bar_mean',
  };

  if (plotType === 'bar_mean') {
    const stats = groups.map((g, i) => {
      const vals = valuesByGroup(g);
      const n = vals.length;
      const mean = vals.reduce((s, v) => s + v, 0) / (n || 1);
      const se =
        n > 1
          ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) / Math.sqrt(n)
          : 0;
      return { g, mean, se, color: GROUP_COLORS[i % GROUP_COLORS.length] };
    });
    traces = [{
      type: 'bar',
      x: stats.map(s => s.g),
      y: stats.map(s => s.mean),
      marker: { color: stats.map(s => s.color) },
      error_y: {
        type: 'data',
        array: stats.map(s => s.se),
        visible: true,
        color: '#64748b',
      },
      text: stats.map(s => `n=${valuesByGroup(s.g).length}`),
      textposition: 'auto',
    }];
    layout.title = { text: 'Mean ± SE by group', font: { size: 11, color: '#cbd5e1' } };
    layout.xaxis = { title: { text: clinicalColumn }, gridcolor: '#1e293b' };
  } else if (plotType === 'strip') {
    traces = groups.map((g, i) => {
      const vals = valuesByGroup(g);
      const jitter = vals.map((_, j) => (((j * 17 + i * 7) % 100) / 100 - 0.5) * 0.35);
      return {
        type: 'scatter',
        mode: 'markers',
        name: g,
        x: vals.map((_, j) => i + jitter[j]),
        y: vals,
        marker: { size: 8, color: GROUP_COLORS[i % GROUP_COLORS.length], opacity: 0.85 },
      };
    });
    layout.title = { text: 'Strip plot (jittered)', font: { size: 11, color: '#cbd5e1' } };
    layout.xaxis = {
      tickmode: 'array',
      tickvals: groups.map((_, i) => i),
      ticktext: groups,
      gridcolor: '#1e293b',
    };
    layout.showlegend = true;
    layout.legend = { font: { size: 10 }, bgcolor: 'rgba(0,0,0,0)' };
  } else {
    const plotlyType = plotType === 'violin' ? 'violin' : 'box';
    traces = groups.map((g, i) => ({
      type: plotlyType as 'box' | 'violin',
      name: g,
      y: valuesByGroup(g),
      marker: { color: GROUP_COLORS[i % GROUP_COLORS.length] },
      boxpoints: plotType === 'box' ? ('all' as const) : undefined,
      points: plotType === 'violin' ? ('all' as const) : undefined,
      jitter: plotType === 'box' ? 0.35 : undefined,
    }));
    layout.title = {
      text: plotType === 'violin' ? 'Violin plot' : 'Box plot',
      font: { size: 11, color: '#cbd5e1' },
    };
    layout.xaxis = { gridcolor: '#1e293b' };
    layout.showlegend = true;
    layout.legend = { font: { size: 10 }, bgcolor: 'rgba(0,0,0,0)' };
  }

  return (
    <PlotPanel title={titleText} subtitle={subtitle}>
      <Plot
        data={traces}
        layout={layout}
        style={{ width: '100%' }}
        config={{ displayModeBar: false }}
      />
    </PlotPanel>
  );
}

function PlotPanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="border border-slate-800 rounded-lg p-3 bg-slate-900/30 space-y-2">
      <div>
        <p className="text-xs font-medium text-slate-300">{title}</p>
        {subtitle && <p className="text-[10px] text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function TestSummaryTable({
  test,
  isNumeric,
  groupStats,
}: {
  test?: ClinicalSummaryTest;
  isNumeric: boolean;
  groupStats: GroupSummaryRow[];
}) {
  if (test?.error) {
    return <p className="text-xs text-slate-500">{test.error}</p>;
  }

  if (isNumeric) {
    return (
      <div className="overflow-x-auto border border-slate-800 rounded-lg">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-800 bg-slate-900/60">
              <th className="px-3 py-2">Marker</th>
              <th className="px-3 py-2">Clinical variable</th>
              <th className="px-3 py-2">Method</th>
              <th className="px-3 py-2">ρ / stat</th>
              <th className="px-3 py-2">p</th>
              <th className="px-3 py-2">n</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-800/60">
              <td className="px-3 py-2 text-slate-300">{featureLabel(test?.marker_column ?? '')}</td>
              <td className="px-3 py-2 text-slate-300">{test?.clinical_column}</td>
              <td className="px-3 py-2 text-slate-400">{test?.method ?? '—'}</td>
              <td className="px-3 py-2">
                {test?.statistic != null ? test.statistic.toFixed(4) : '—'}
              </td>
              <td className={clsx('px-3 py-2', test?.p_value != null && test.p_value < 0.05 ? 'text-emerald-300' : 'text-slate-400')}>
                {test?.p_value != null ? formatP(test.p_value) : '—'}
              </td>
              <td className="px-3 py-2 text-slate-400">{test?.n ?? '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  if (groupStats.length === 0) {
    return <p className="text-xs text-slate-500">No group summary available.</p>;
  }

  return (
    <div className="space-y-3">
      {test?.method && (
        <p className="text-[10px] text-slate-500 font-mono">
          {test.method}
          {test.statistic != null && <> · stat = {test.statistic.toFixed(3)}</>}
          {test.p_value != null && <> · p = {formatP(test.p_value)}</>}
          {test.n != null && <> · n = {test.n}</>}
        </p>
      )}
      <div className="overflow-x-auto border border-slate-800 rounded-lg">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-800 bg-slate-900/60">
              <th className="px-3 py-2">Group</th>
              <th className="px-3 py-2">n</th>
              <th className="px-3 py-2">Mean</th>
              <th className="px-3 py-2">Median</th>
              <th className="px-3 py-2">SD</th>
            </tr>
          </thead>
          <tbody>
            {groupStats.map(row => (
              <tr key={row.group} className="border-b border-slate-800/60 last:border-0">
                <td className="px-3 py-2 text-slate-300">{row.group}</td>
                <td className="px-3 py-2">{row.n}</td>
                <td className="px-3 py-2">{row.mean}</td>
                <td className="px-3 py-2">{row.median}</td>
                <td className="px-3 py-2 text-slate-400">{row.sd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FrequencyTable({ title, rows }: { title: string; rows: FreqRow[] }) {
  if (rows.length === 0) {
    return <p className="text-xs text-slate-500">No frequency data for this variable.</p>;
  }
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">{title}</p>
      <div className="overflow-x-auto border border-slate-800 rounded-lg">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-800 bg-slate-900/60">
              <th className="px-3 py-2">Level</th>
              <th className="px-3 py-2">Count</th>
              <th className="px-3 py-2">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.level} className="border-b border-slate-800/60 last:border-0">
                <td className="px-3 py-2 text-slate-300">{row.level}</td>
                <td className="px-3 py-2">{row.count}</td>
                <td className="px-3 py-2 text-slate-400">{row.pct}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SampleDataTable({
  rows,
  markerColumn,
  clinicalColumn,
}: {
  rows: Array<Record<string, string | number | null>>;
  markerColumn: string;
  clinicalColumn: string;
}) {
  const idCol = rows[0]?.patient_id != null ? 'patient_id' : 'sample_id';
  const display = rows
    .filter(r => r[markerColumn] != null && r[clinicalColumn] != null)
    .slice(0, 50);

  if (display.length === 0) {
    return <p className="text-xs text-slate-500">No paired observations.</p>;
  }

  return (
    <div className="overflow-x-auto border border-slate-800 rounded-lg max-h-64">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-800 bg-slate-900/60 sticky top-0">
            <th className="px-3 py-2">{idCol}</th>
            <th className="px-3 py-2">{clinicalColumn}</th>
            <th className="px-3 py-2">{featureLabel(markerColumn)}</th>
          </tr>
        </thead>
        <tbody>
          {display.map((row, i) => (
            <tr key={i} className="border-b border-slate-800/50">
              <td className="px-3 py-2 text-slate-400">{String(row[idCol] ?? row.sample_id ?? '')}</td>
              <td className="px-3 py-2">{String(row[clinicalColumn] ?? '')}</td>
              <td className="px-3 py-2">
                {typeof row[markerColumn] === 'number'
                  ? (row[markerColumn] as number).toFixed(2)
                  : String(row[markerColumn] ?? '')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 50 && (
        <p className="text-[10px] text-slate-600 px-3 py-1.5">
          Showing 50 of {rows.length} rows.
        </p>
      )}
    </div>
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
      {sub && <p className="text-[10px] text-slate-500 mt-0.5 truncate" title={sub}>{sub}</p>}
    </div>
  );
}
