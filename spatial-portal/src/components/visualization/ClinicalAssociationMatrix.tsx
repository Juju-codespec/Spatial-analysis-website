// Association screening heatmap: marker × clinical variable with FDR.

import { useEffect, useMemo, useState } from 'react';
import Plot from '../../lib/plot';
import type { Data, Layout, PlotMouseEvent } from 'plotly.js';
import {
  useClinicalAssociationMatrix,
  associationScreeningAvailable,
} from '../../hooks/useAnalysis';
import type { ClinicalSpatialQuery } from '../../api/client';
import type { ClinicalSummaryTest, IdOverlapResponse } from '../../api/types';
import { Loader2, AlertCircle, Download, MousePointerClick } from 'lucide-react';
import { downloadCsv } from '../../utils/export';
import clsx from 'clsx';
import ConfirmatoryPairTest, { type ConfirmatoryPair } from './ConfirmatoryPairTest';

export interface ScreeningPairFocus {
  markerColumn: string;
  clinicalColumn: string;
}

interface Props {
  datasetId: string;
  level: 'sample' | 'patient';
  spatialRequest?: ClinicalSpatialQuery | null;
  overlap?: IdOverlapResponse | null;
  overlapLoading?: boolean;
  availableClinicalColumns?: string[];
  markerColumns?: string[];
  survivalColumns?: string[];
  spatialRequestRecord?: Record<string, unknown>;
  onPairSelect?: (pair: ScreeningPairFocus) => void;
}

const MAX_PAIRS_OPTIONS = [24, 48, 72, 96] as const;
const ERROR_Z = -1;
const Z_MAX = 3;

/**
 * Yellow → orange → red significance scale.
 * Normalized over zmin=-1 … zmax=3, so pos = (z + 1) / 4.
 *   z=-1 (error)      → pos 0.00 → medium gray
 *   z= 0 (ns, p=1)    → pos 0.25 → yellow (lowest valid value)
 *   z= 1 (FDR≈0.10)   → pos 0.50 → amber
 *   z≈1.3 (FDR≈0.05)  → pos 0.58 → orange
 *   z= 2 (FDR≈0.01)   → pos 0.75 → red
 *   z= 3 (FDR≈0.001)  → pos 1.00 → deep crimson
 */
const SIGNIFICANCE_COLORSCALE: [number, string][] = [
  [0,    '#52525b'],  // error gray
  [0.20, '#52525b'],
  [0.21, '#fef08a'],  // pale yellow (first valid values above error band)
  [0.25, '#eab308'],  // yellow — not significant (FDR ≈ 1)
  [0.50, '#f59e0b'],  // amber (FDR ≈ 0.10)
  [0.60, '#f97316'],  // orange (FDR ≈ 0.05)
  [0.76, '#ef4444'],  // red    (FDR ≈ 0.01)
  [1.00, '#7f1d1d'],  // crimson (FDR ≤ 0.001)
];

function featureLabel(col: string): string {
  if (col === 'spatial_cluster_stat') return 'Spatial clustering';
  return col
    .replace(/^count_/, 'count ')
    .replace(/^pct_/, '% ')
    .replace(/^ratio_/, 'ratio ')
    .replace(/_/g, ' ');
}

function clinicalLabel(col: string): string {
  if (col === '__survival__') return 'Survival';
  return col.replace(/_/g, ' ');
}

function asFiniteNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v !== '' && v !== 'NA' && v !== 'null') {
    const n = Number(v);
    if (isFinite(n)) return n;
  }
  return undefined;
}

function formatP(p: number | string | undefined | null): string {
  const n = asFiniteNumber(p);
  if (n == null) return '—';
  if (n < 0.001) return '<0.001';
  return n.toFixed(3);
}

function negLog10(p: number | undefined): number {
  if (p == null || !isFinite(p) || p <= 0) return 0;
  return Math.min(-Math.log10(p), Z_MAX);
}

function methodBadgeClass(method?: string): string {
  const m = (method ?? '').toLowerCase();
  if (m.includes('beta-binomial')) return 'bg-blue-950/60 text-blue-200 border-blue-800/70';
  if (m.includes('quasibinomial')) return 'bg-amber-950/60 text-amber-200 border-amber-800/70';
  if (m.includes('wilcoxon')) return 'bg-violet-950/60 text-violet-200 border-violet-800/70';
  if (m.includes('kruskal')) return 'bg-fuchsia-950/60 text-fuchsia-200 border-fuchsia-800/70';
  if (m.includes('spearman')) return 'bg-cyan-950/60 text-cyan-200 border-cyan-800/70';
  if (m.includes('cox')) return 'bg-emerald-950/60 text-emerald-200 border-emerald-800/70';
  return 'bg-slate-900 text-slate-300 border-slate-700';
}

export default function ClinicalAssociationMatrix({
  datasetId,
  level,
  spatialRequest = null,
  overlap = null,
  overlapLoading = false,
  availableClinicalColumns = [],
  markerColumns = [],
  survivalColumns = [],
  spatialRequestRecord = {},
  onPairSelect,
}: Props) {
  const [staleApi, setStaleApi] = useState<boolean | null>(null);
  const [maxPairs, setMaxPairs] = useState<number>(48);
  const [includeCounts, setIncludeCounts] = useState(true);
  const [selectedClinical, setSelectedClinical] = useState<string[]>([]);
  const [confirmatoryPair, setConfirmatoryPair] = useState<ConfirmatoryPair | null>(null);

  useEffect(() => {
    let cancelled = false;
    associationScreeningAvailable().then(ok => {
      if (!cancelled) setStaleApi(!ok);
    });
    return () => { cancelled = true; };
  }, [datasetId]);

  useEffect(() => {
    if (availableClinicalColumns.length === 0) {
      setSelectedClinical([]);
      return;
    }
    setSelectedClinical(prev => {
      const kept = prev.filter(c => availableClinicalColumns.includes(c));
      return kept.length > 0 ? kept : [...availableClinicalColumns];
    });
  }, [availableClinicalColumns]);

  const overlapOk = overlap != null && overlap.n_matched >= 5;
  const screeningEnabled = overlapOk && staleApi !== true;

  const clinicalFilter = useMemo(() => {
    if (
      selectedClinical.length === 0 ||
      selectedClinical.length >= availableClinicalColumns.length
    ) {
      return undefined;
    }
    return selectedClinical;
  }, [selectedClinical, availableClinicalColumns.length]);

  const req = useMemo(() => {
    if (!screeningEnabled) return null;
    return {
      datasetId,
      level,
      fdrMethod: 'BH',
      maxPairs,
      includeCounts,
      clinicalColumns: clinicalFilter,
      ...spatialRequest,
    };
  }, [
    datasetId,
    level,
    spatialRequest,
    maxPairs,
    includeCounts,
    clinicalFilter,
    screeningEnabled,
  ]);

  const { data, loading, error } = useClinicalAssociationMatrix(req);

  const { markers, clinicalCols, zMatrix, textMatrix, labelMatrix, flatRows, successCells } = useMemo(() => {
    if (!data?.tests?.length) {
      return {
        markers: [],
        clinicalCols: [],
        zMatrix: [],
        textMatrix: [],
        labelMatrix: [],
        flatRows: [],
        successCells: 0,
      };
    }
    const mks = data.marker_columns.length
      ? data.marker_columns
      : [...new Set(data.tests.map(t => t.marker_column))];
    const cols = data.clinical_columns.length
      ? data.clinical_columns
      : [...new Set(data.tests.map(t => t.clinical_column))];

    const lookup = new Map<string, ClinicalSummaryTest>();
    for (const t of data.tests) {
      lookup.set(`${t.marker_column}|${t.clinical_column}`, t);
    }

    const zMatrix: number[][] = [];
    const textMatrix: string[][] = [];
    const labelMatrix: string[][] = [];
    const flatRows: Array<Record<string, unknown>> = [];
    let successCells = 0;

    for (const m of mks) {
      const zRow: number[] = [];
      const tRow: string[] = [];
      const lRow: string[] = [];
      for (const c of cols) {
        const t = lookup.get(`${m}|${c}`);
        if (t?.error) {
          zRow.push(ERROR_Z);
          tRow.push(`Could not test: ${t.error}`);
          lRow.push('err');
        } else if (t) {
          successCells += 1;
          const fdr = asFiniteNumber(t.fdr);
          const pval = asFiniteNumber(t.p_value);
          zRow.push(negLog10(fdr ?? pval ?? 1));
          tRow.push(
            [
              t.effect_summary,
              `p=${formatP(t.p_value)}`,
              `FDR=${formatP(t.fdr)}`,
              t.method,
              `n=${t.n ?? '—'}`,
            ]
              .filter(Boolean)
              .join('\n'),
          );
          lRow.push(formatP(fdr ?? pval));
        } else {
          zRow.push(0);
          tRow.push('—');
          lRow.push('');
        }
        flatRows.push({
          marker: m,
          clinical: c,
          method: t?.method ?? '',
          effect: t?.effect_summary ?? '',
          p_value: t?.p_value ?? '',
          fdr: t?.fdr ?? '',
          statistic: t?.statistic ?? '',
          n: t?.n ?? '',
          error: t?.error ?? '',
        });
      }
      zMatrix.push(zRow);
      textMatrix.push(tRow);
      labelMatrix.push(lRow);
    }

    return { markers: mks, clinicalCols: cols, zMatrix, textMatrix, labelMatrix, flatRows, successCells };
  }, [data]);

  const handleExport = () => {
    if (!flatRows.length) return;
    downloadCsv(flatRows, `association-matrix-${datasetId}.csv`);
  };

  const handlePairFocus = (pair: ScreeningPairFocus) => {
    setConfirmatoryPair(pair);
    onPairSelect?.(pair);
  };

  const handlePlotClick = (ev: Readonly<PlotMouseEvent>) => {
    if (!ev.points?.length) return;
    const pt = ev.points[0];
    const yIdx = typeof pt.y === 'number' ? pt.y : markers.map(featureLabel).indexOf(String(pt.y));
    const xIdx = typeof pt.x === 'number' ? pt.x : clinicalCols.map(clinicalLabel).indexOf(String(pt.x));
    const m = markers[yIdx];
    const c = clinicalCols[xIdx];
    if (m && c) handlePairFocus({ markerColumn: m, clinicalColumn: c });
  };

  const confirmatoryMarkers = useMemo(() => {
    if (markerColumns.length > 0) return markerColumns;
    return markers;
  }, [markerColumns, markers]);

  const screeningFdrForPair = useMemo(() => {
    if (!confirmatoryPair || !data?.tests) return null;
    const hit = data.tests.find(
      t =>
        t.marker_column === confirmatoryPair.markerColumn &&
        t.clinical_column === confirmatoryPair.clinicalColumn,
    );
    return asFiniteNumber(hit?.fdr) ?? null;
  }, [confirmatoryPair, data?.tests]);

  const toggleClinical = (col: string) => {
    setSelectedClinical(prev => {
      if (prev.includes(col)) {
        if (prev.length <= 1) return prev;
        return prev.filter(c => c !== col);
      }
      return [...prev, col];
    });
  };

  const showStaleWarning =
    staleApi === true || error?.includes('404 - Resource Not Found');

  const noScreenableVars =
    error?.includes('No clinical variables with sufficient variation');

  const quality = useMemo(() => {
    const tests = data?.tests ?? [];
    const successful = tests.filter(t => !t.error);
    const methodCounts = successful.reduce<Record<string, number>>((acc, t) => {
      const key = t.method ?? 'Unknown';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const failed = tests.filter(t => !!t.error);
    const failureReasonCounts = failed.reduce<Record<string, number>>((acc, t) => {
      const msg = (t.error ?? '').trim();
      const reason = msg.split('.')[0] || msg || 'Unknown error';
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});
    const lowNCount = successful.filter(t => (t.n ?? 0) > 0 && (t.n ?? 0) < 10).length;
    return {
      methodCounts: Object.entries(methodCounts).sort((a, b) => b[1] - a[1]),
      failureReasonCounts: Object.entries(failureReasonCounts).sort((a, b) => b[1] - a[1]),
      lowNCount,
      failedCount: failed.length,
      successCount: successful.length,
    };
  }, [data]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-800/80 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-200">Exploratory association screening</h4>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
            Count/proportion-derived endpoints use <span className="text-slate-400">beta-binomial</span> regression;
            other endpoints use Spearman / Wilcoxon / Kruskal-Wallis.
            Yellow = not significant · Orange/red = stronger significance (lower FDR).
            Grey = could not test. Click a cell for confirmatory test and summary explorer.
          </p>
        </div>
        {flatRows.length > 0 && (
          <button
            type="button"
            onClick={handleExport}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-600"
          >
            <Download size={12} /> Export CSV
          </button>
        )}
      </div>

      <div className="px-5 py-3 border-b border-slate-800/60 flex flex-wrap gap-4 items-end">
        <label className="text-[11px] text-slate-500">
          <span className="block mb-1 text-slate-400">Max pairs</span>
          <select
            value={maxPairs}
            onChange={e => setMaxPairs(Number(e.target.value))}
            className="bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200"
            disabled={!screeningEnabled}
          >
            {MAX_PAIRS_OPTIONS.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={includeCounts}
            onChange={e => setIncludeCounts(e.target.checked)}
            disabled={!screeningEnabled}
            className="rounded border-slate-600"
          />
          Include raw counts (beta-binomial)
        </label>
      </div>

      {availableClinicalColumns.length > 0 && (
        <div className="px-5 py-3 border-b border-slate-800/60">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
            Clinical variables to screen
          </p>
          <div className="flex flex-wrap gap-1.5">
            {availableClinicalColumns.map(col => (
              <button
                key={col}
                type="button"
                onClick={() => toggleClinical(col)}
                disabled={!screeningEnabled}
                className={clsx(
                  'px-2.5 py-1 rounded-md text-[11px] border transition-colors',
                  selectedClinical.includes(col)
                    ? 'bg-brand-900/40 border-brand-700/60 text-brand-200'
                    : 'border-slate-700 text-slate-500 hover:text-slate-300',
                )}
              >
                {clinicalLabel(col)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="p-5">
        {showStaleWarning && (
          <div className="text-xs text-amber-200 flex gap-2 rounded-lg border border-amber-800/50 bg-amber-950/30 p-3 mb-4">
            <AlertCircle size={16} className="shrink-0" />
            <span>
              The API is missing association-screening routes. Stop the old server and run{' '}
              <code className="text-amber-100">npm run api</code> from the project root, then reload.
            </span>
          </div>
        )}

        {overlapLoading && (
          <p className="text-xs text-slate-500 flex items-center gap-2 mb-4">
            <Loader2 size={14} className="animate-spin" /> Checking ID overlap…
          </p>
        )}

        {!overlapLoading && overlap && !overlapOk && (
          <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-3 text-xs text-amber-200/90 mb-4">
            <p className="font-medium">
              Screening paused — only {overlap.n_matched} matched sample
              {overlap.n_matched === 1 ? '' : 's'} (need ≥ 5).
            </p>
            <p className="mt-1 text-amber-200/70 leading-relaxed">
              Align <code className="text-amber-100">sample_id</code> values in your clinical CSV
              with imaging metadata before running tests.
            </p>
          </div>
        )}

        {loading && screeningEnabled && (
          <p className="text-xs text-slate-500 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Running association screen…
          </p>
        )}

        {error && !showStaleWarning && (
          <div className="rounded-lg border border-rose-800/50 bg-rose-950/30 p-3 flex gap-2 text-xs text-rose-200">
            <AlertCircle size={16} className="shrink-0" /> {error}
          </div>
        )}

        {noScreenableVars && availableClinicalColumns.length > 0 && (
          <p className="text-[11px] text-slate-500 mt-2">
            Variables with only one level (e.g. all one sex) or too few values are excluded automatically.
          </p>
        )}

        {data?.truncated && (
          <p className="text-[11px] text-slate-500 mb-3">
            Screening {data.n_pairs_screened} of {data.n_pairs_possible} possible pairs
            ({data.marker_columns.length} markers × {data.clinical_columns.length} clinical variables).
            Increase max pairs or narrow clinical variables to cover more.
          </p>
        )}

        {data && (data.n_success != null || data.n_failed != null) && (
          <p className="text-[11px] text-slate-500 mb-3">
            {data.n_success ?? successCells} of {data.n_tests} pairs tested successfully
            {(data.n_failed ?? 0) > 0 && ` · ${data.n_failed} could not be tested`}
            {!includeCounts && ' · cell counts excluded by default'}
          </p>
        )}

        {data && quality.methodCounts.length > 0 && (
          <div className="mb-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
              Methods used in this run
            </p>
            <div className="flex flex-wrap gap-1.5">
              {quality.methodCounts.map(([method, count]) => (
                <span
                  key={method}
                  className={clsx(
                    'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px]',
                    methodBadgeClass(method),
                  )}
                >
                  <span>{method}</span>
                  <span className="opacity-80 tabular-nums">{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {data && (quality.failedCount > 0 || quality.lowNCount > 0) && (
          <div className="mb-3 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3">
            <p className="text-[10px] uppercase tracking-widest text-amber-300/90 mb-2">
              Data quality diagnostics
            </p>
            <div className="text-[11px] text-amber-100/90 space-y-1">
              {quality.failedCount > 0 && (
                <p>
                  {quality.failedCount} pair{quality.failedCount === 1 ? '' : 's'} could not be tested.
                </p>
              )}
              {quality.lowNCount > 0 && (
                <p>
                  {quality.lowNCount} successful pair{quality.lowNCount === 1 ? '' : 's'} have n &lt; 10 and may be unstable.
                </p>
              )}
            </div>
            {quality.failureReasonCounts.length > 0 && (
              <ul className="mt-2 text-[11px] text-amber-200/80 list-disc list-inside">
                {quality.failureReasonCounts.slice(0, 3).map(([reason, count]) => (
                  <li key={reason}>
                    {count} × {reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {data && successCells === 0 && !loading && screeningEnabled && (
          <p className="text-xs text-slate-500 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
            No pairs produced valid tests. Try different clinical variables, check ID overlap, or
            switch sample/patient level.
          </p>
        )}

        {data && markers.length > 0 && clinicalCols.length > 0 && screeningEnabled && successCells > 0 && (
          <>
            {onPairSelect && (
              <p className="text-[10px] text-slate-600 flex items-center gap-1 mb-2">
                <MousePointerClick size={12} /> Click a cell for confirmatory test and summary plot
              </p>
            )}
            {(() => {
              const nR = markers.length;
              const nC = clinicalCols.length;
              const rowH = Math.max(20, Math.min(30, Math.floor(480 / Math.max(nR, 1))));
              const plotH = Math.max(220, nR * rowH + 110);
              const leftM = Math.max(110, Math.min(210, Math.max(...markers.map(m => featureLabel(m).length)) * 6));
              const botM = Math.max(60, Math.min(130, Math.max(...clinicalCols.map(c => clinicalLabel(c).length)) * 4));
              const cellFontSize = Math.max(7, Math.min(9, Math.floor(160 / Math.max(nR, nC, 1))));
              const minW = Math.max(340, nC * 56 + leftM + 60);

              // Build layout annotations for in-cell numbers.
              // texttemplate on heatmap traces hides the color fill, so we
              // use layout.annotations instead (the correct Plotly approach).
              const xLabels = clinicalCols.map(clinicalLabel);
              const yLabels = markers.map(featureLabel);
              const showAnnotations = nR * nC <= 150;
              const annotations = showAnnotations
                ? yLabels.flatMap((yLabel, yi) =>
                    xLabels.map((xLabel, xi) => {
                      const txt = labelMatrix[yi]?.[xi] ?? '';
                      return {
                        x: xLabel,
                        y: yLabel,
                        text: txt,
                        showarrow: false,
                        font: { color: 'rgba(24, 24, 27, 0.88)', size: cellFontSize, family: 'monospace' },
                        xref: 'x' as const,
                        yref: 'y' as const,
                      };
                    }),
                  )
                : [];

              return (
                <div className="rounded-lg border border-slate-800/80 bg-[#0a0a0b] p-2 overflow-x-auto">
                  <Plot
                    data={[
                      {
                        type: 'heatmap',
                        x: xLabels,
                        y: yLabels,
                        z: zMatrix,
                        customdata: textMatrix,
                        hovertemplate: '%{y} × %{x}<br>%{customdata}<extra></extra>',
                        colorscale: SIGNIFICANCE_COLORSCALE,
                        zmin: ERROR_Z,
                        zmax: Z_MAX,
                        showscale: true,
                        colorbar: {
                          title: { text: '−log₁₀ FDR', font: { color: '#a1a1aa', size: 10 } },
                          tickfont: { color: '#71717a', size: 9 },
                          outlinecolor: '#3f3f46',
                          bordercolor: '#3f3f46',
                          thickness: 12,
                          len: 0.6,
                        },
                        xgap: 2,
                        ygap: 2,
                      } as unknown as Data,
                    ]}
                    layout={{
                      autosize: true,
                      height: plotH,
                      paper_bgcolor: 'rgba(0,0,0,0)',
                      plot_bgcolor: '#0a0a0b',
                      font: { color: '#a1a1aa', size: 10 },
                      margin: { l: leftM, r: 60, t: 14, b: botM },
                      annotations,
                      xaxis: {
                        tickangle: -40,
                        gridcolor: '#27272a',
                        linecolor: '#3f3f46',
                        automargin: true,
                      },
                      yaxis: {
                        gridcolor: '#27272a',
                        linecolor: '#3f3f46',
                        automargin: true,
                      },
                    } as Partial<Layout>}
                    style={{ width: '100%', minWidth: minW }}
                    useResizeHandler
                    config={{ displayModeBar: false, responsive: true }}
                    onClick={handlePlotClick}
                  />
                </div>
              );
            })()}
            <div className="flex flex-wrap gap-3 mt-3 text-[10px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-zinc-600" /> Could not test
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-yellow-400" /> Not significant
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-orange-500" /> FDR ≈ 0.05
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-red-500" /> FDR ≤ 0.01
              </span>
            </div>
            <AssociationTable tests={data.tests} onPairSelect={handlePairFocus} />
            <ConfirmatoryPairTest
              datasetId={datasetId}
              level={level}
              markerColumns={confirmatoryMarkers}
              survivalColumns={survivalColumns}
              spatialRequest={spatialRequestRecord}
              selectedPair={confirmatoryPair}
              onPairChange={setConfirmatoryPair}
              screeningFdr={screeningFdrForPair}
            />
          </>
        )}
      </div>
    </div>
  );
}

function AssociationTable({
  tests,
  onPairSelect,
}: {
  tests: ClinicalSummaryTest[];
  onPairSelect?: (pair: ScreeningPairFocus) => void;
}) {
  const sorted = [...tests]
    .filter(t => !t.error && asFiniteNumber(t.fdr) != null)
    .sort((a, b) => {
      const fdrA = asFiniteNumber(a.fdr) ?? 1;
      const fdrB = asFiniteNumber(b.fdr) ?? 1;
      if (fdrA !== fdrB) return fdrA - fdrB;
      return (asFiniteNumber(b.effect_strength) ?? -99) - (asFiniteNumber(a.effect_strength) ?? -99);
    })
    .slice(0, 12);

  if (sorted.length === 0) return null;

  return (
    <div className="mt-4 border-t border-slate-800 pt-4">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Top associations (by FDR)</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-800">
              <th className="py-2 pr-3">Marker</th>
              <th className="py-2 pr-3">Clinical</th>
              <th className="py-2 pr-3">Effect</th>
              <th className="py-2 pr-3">Method</th>
              <th className="py-2 pr-3">n</th>
              <th className="py-2 pr-3">p</th>
              <th className="py-2">FDR</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => {
              const fdr = asFiniteNumber(t.fdr);
              return (
                <tr
                  key={i}
                  className={clsx(
                    'border-b border-slate-800/40',
                    onPairSelect && 'cursor-pointer hover:bg-slate-800/40',
                  )}
                  onClick={() =>
                    onPairSelect?.({
                      markerColumn: t.marker_column,
                      clinicalColumn: t.clinical_column,
                    })
                  }
                >
                  <td className="py-1.5 pr-3 text-slate-300">{featureLabel(t.marker_column)}</td>
                  <td className="py-1.5 pr-3 text-slate-400">{clinicalLabel(t.clinical_column)}</td>
                  <td className="py-1.5 pr-3 text-slate-400 tabular-nums">{t.effect_summary ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-slate-500">
                    <span
                      className={clsx(
                        'inline-block rounded border px-1.5 py-0.5 text-[10px] leading-snug',
                        methodBadgeClass(t.method),
                      )}
                    >
                      {t.method}
                    </span>
                  </td>
                  <td className={clsx('py-1.5 pr-3 tabular-nums', (t.n ?? 0) > 0 && (t.n ?? 0) < 10 && 'text-amber-300')}>
                    {t.n ?? '—'}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">{formatP(t.p_value)}</td>
                  <td className={clsx('py-1.5 tabular-nums', fdr != null && fdr < 0.05 && 'text-amber-300')}>
                    {formatP(t.fdr)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
