// Survival analysis tab: runs a Cox PH model on a chosen spatial statistic
// (Ripley's K reduced to L(r)-r at a chosen radius, or NN G), and plots
// the resulting Kaplan-Meier curves stratified by the chosen grouping.
// Also provides a bivariate panel that jointly stratifies clustering × abundance.

import { useMemo, useRef, useState, useEffect } from 'react';
import Plot from '../../lib/plot';
import type { Data, Layout } from 'plotly.js';
import { useCox, useBivariateCox } from '../../hooks/useAnalysis';
import { API_URL, ApiError, uploadSurvival } from '../../api/client';
import { Loader2, AlertCircle, Upload, CheckCircle2, FileText, X, GitBranch, Info, Download } from 'lucide-react';
import clsx from 'clsx';
import { formatNum, formatRange } from '../../utils/format';
import { downloadCsv } from '../../utils/export';

interface Props {
  datasetId: string;
  availableCellTypes: string[];
  hasSurvival: boolean;
  survivalColumns?: string[];
  tissueRegions?: string[];
  apiDetailLoaded?: boolean;
  onSurvivalAttached?: () => void;
}

const DEFAULT_T_CELL_OPTIONS = ['CD8+ T Cell', 'CD4+ T Cell', 'T Cell', 'CD8_T'];
const COX_COVARIATE_SKIP = new Set(['sample_id', 'patient_id', 'time', 'status']);

function pickDefaultCellType(available: string[]): string {
  if (available.length === 0) return DEFAULT_T_CELL_OPTIONS[0];
  const preferred = available.find(ct => DEFAULT_T_CELL_OPTIONS.includes(ct));
  return preferred ?? available[0];
}

function defaultCoxCovariates(columns: string[]): string[] {
  const preferred = ['age', 'stage', 'grade', 'arm'];
  return preferred.filter(c => columns.includes(c));
}

export default function SurvivalView({
  datasetId,
  availableCellTypes,
  hasSurvival,
  survivalColumns = [],
  tissueRegions = [],
  apiDetailLoaded = false,
  onSurvivalAttached,
}: Props) {
  const tCellOptions = availableCellTypes.length > 0 ? availableCellTypes : DEFAULT_T_CELL_OPTIONS;
  const [typeA, setTypeA] = useState(() => pickDefaultCellType(tCellOptions));
  const [typeB, setTypeB] = useState('');

  useEffect(() => {
    if (availableCellTypes.length === 0) return;
    setTypeA(prev =>
      availableCellTypes.includes(prev) ? prev : pickDefaultCellType(availableCellTypes),
    );
  }, [availableCellTypes]);

  const [statistic, setStatistic] = useState<'K' | 'G'>('K');
  const [radius, setRadius] = useState(50);
  const [dichotomize, setDichotomize] = useState<'median' | 'tertile' | 'trichotomize' | 'none'>('median');
  const [covariates, setCovariates] = useState<string[]>(() =>
    defaultCoxCovariates(survivalColumns),
  );
  const [adjustDensity, setAdjustDensity] = useState(true);
  const [clusterPatients, setClusterPatients] = useState(true);
  const [analysisLevel, setAnalysisLevel] = useState<'sample' | 'patient'>('patient');
  const [tissueRegion, setTissueRegion] = useState('');
  const [minFocalCells, setMinFocalCells] = useState(10);

  useEffect(() => {
    setCovariates(prev =>
      prev.filter(c => survivalColumns.includes(c) && !COX_COVARIATE_SKIP.has(c)),
    );
  }, [survivalColumns]);

  const covariateOptions = useMemo(
    () => survivalColumns.filter(c => !COX_COVARIATE_SKIP.has(c)),
    [survivalColumns],
  );

  const req = useMemo(() => hasSurvival ? {
    datasetId,
    statistic,
    radius,
    typeA,
    typeB: typeB || null,
    dichotomize,
    covariates,
    adjustDensity,
    clusterPatients,
    analysisLevel,
    tissueRegion: tissueRegion || null,
    minFocalCells,
    windowType: 'convex' as const,
  } : null, [datasetId, statistic, radius, typeA, typeB, dichotomize, covariates, adjustDensity, clusterPatients, analysisLevel, tissueRegion, minFocalCells, hasSurvival]);

  const { data, loading, error } = useCox(req);

  const toggleCovariate = (col: string) => {
    setCovariates(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col],
    );
  };

  if (!hasSurvival) {
    return (
      <SurvivalUploadSlot
        datasetId={datasetId}
        apiDetailLoaded={apiDetailLoaded}
        onUploaded={onSurvivalAttached}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-5">
      <div>
        <p className="text-xs font-semibold text-slate-300">Cox Proportional Hazards · Spatial T-cell Clustering vs Survival</p>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Per-{analysisLevel === 'patient' ? 'patient' : 'sample'} {statistic === 'K' ? 'L(r) − r' : 'G(r) − G_csr(r)'} at r = {radius} px
          {tissueRegion ? <> within <strong>{tissueRegion}</strong> regions</> : null}
          {dichotomize === 'none'
            ? ' is fit continuously in '
            : dichotomize === 'trichotomize'
              ? ' is trichotomized (low/medium/high tertile groups) in '
              : ` is median/tertile-stratified in `}
          <code className="text-brand-400">
            {dichotomize === 'none'
              ? 'coxph(Surv(time, status) ~ stat'
              : 'coxph(Surv(time, status) ~ group'}
          {covariates.length > 0 && (
            <> + {covariates.map(c => (
              <code key={c} className="text-brand-400 mx-0.5">{c}</code>
            ))}</>
          )}
          {adjustDensity ? ' + n_focal + log_area' : ''})
          </code>
          {analysisLevel === 'patient'
            ? ' · spatial stats averaged across cores per patient.'
            : clusterPatients
              ? ' with cluster-robust SE by patient when available.'
              : '.'}
        </p>
      </div>

      {covariateOptions.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Covariates</p>
          <div className="flex flex-wrap gap-2">
            {covariateOptions.map(col => (
              <button
                key={col}
                type="button"
                onClick={() => toggleCovariate(col)}
                className={clsx(
                  'px-2.5 py-1 rounded-md border text-xs transition-colors',
                  covariates.includes(col)
                    ? 'bg-brand-900/50 border-brand-700 text-brand-300'
                    : 'bg-slate-900 border-slate-700 text-slate-500 hover:text-slate-300',
                )}
              >
                {col}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10 gap-3 text-xs">
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
          <span className="text-slate-400 mb-1 block">Cell Type</span>
          <select className="input text-xs" value={typeA} onChange={e => setTypeA(e.target.value)}>
            {tCellOptions.map(ct => <option key={ct} value={ct}>{ct}</option>)}
          </select>
        </label>
        <label>
          <span className="text-slate-400 mb-1 block">Cross type (opt.)</span>
          <select className="input text-xs" value={typeB} onChange={e => setTypeB(e.target.value)}>
            <option value="">— univariate —</option>
            {availableCellTypes.filter(ct => ct !== typeA).map(ct => (
              <option key={ct} value={ct}>{ct}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-slate-400 mb-1 block">Radius (px)</span>
          <input
            type="number" min={5} max={500} step={5}
            value={radius} onChange={e => setRadius(Math.max(5, Number(e.target.value) || 50))}
            className="input text-xs"
          />
        </label>
        <label>
          <span className="text-slate-400 mb-1 block">Stratification</span>
          <select className="input text-xs" value={dichotomize} onChange={e => setDichotomize(e.target.value as 'median' | 'tertile' | 'trichotomize' | 'none')}>
            <option value="median">High / low (median split + KM)</option>
            <option value="tertile">High / low (tertile extremes + KM)</option>
            <option value="trichotomize">Low / medium / high (tertile groups + KM)</option>
            <option value="none">Continuous statistic</option>
          </select>
        </label>
        <label>
          <span className="text-slate-400 mb-1 block">Min positive cells / sample</span>
          <input
            type="number" min={1} max={500} step={1}
            value={minFocalCells}
            onChange={e => setMinFocalCells(Math.max(1, Number(e.target.value) || 10))}
            className="input text-xs"
          />
        </label>
        <label>
          <span className="text-slate-400 mb-1 block">Density adjustment</span>
          <select
            className="input text-xs"
            value={adjustDensity ? 'yes' : 'no'}
            onChange={e => setAdjustDensity(e.target.value === 'yes')}
          >
            <option value="yes">Adjust for n_focal + log(area)</option>
            <option value="no">Unadjusted</option>
          </select>
        </label>
        <label>
          <span className="text-slate-400 mb-1 block">Analysis unit</span>
          <select
            className="input text-xs"
            value={analysisLevel}
            onChange={e => setAnalysisLevel(e.target.value as 'sample' | 'patient')}
          >
            <option value="patient">Patient (mean across cores)</option>
            <option value="sample">Sample / core</option>
          </select>
        </label>
        {tissueRegions.length > 0 && (
          <label>
            <span className="text-slate-400 mb-1 block">Tissue region</span>
            <select
              className="input text-xs"
              value={tissueRegion}
              onChange={e => setTissueRegion(e.target.value)}
            >
              <option value="">All regions</option>
              {tissueRegions.map(region => (
                <option key={region} value={region}>{region}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span className="text-slate-400 mb-1 block">Patient clustering</span>
          <select
            className="input text-xs"
            value={clusterPatients ? 'yes' : 'no'}
            onChange={e => setClusterPatients(e.target.value === 'yes')}
            disabled={analysisLevel === 'patient'}
          >
            <option value="yes">Cluster-robust SE</option>
            <option value="no">Standard SE</option>
          </select>
        </label>
      </div>

      {loading && (
        <div className="border border-slate-800 rounded-lg p-6 bg-slate-900/40 flex items-center justify-center text-xs text-slate-500 gap-2">
          <Loader2 size={14} className="animate-spin" /> Fitting Cox model on backend…
        </div>
      )}
      {error && (
        <div className="border border-rose-700/50 rounded-lg p-4 bg-rose-950/30 text-xs text-rose-300 flex items-start gap-2">
          <AlertCircle size={13} className="text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {data && (
        <>
          {data.radius_guidance?.warn && data.radius_guidance.message && (
            <p className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2 flex items-start gap-2">
              <AlertCircle size={13} className="text-amber-400 shrink-0 mt-0.5" />
              <span>{data.radius_guidance.message}</span>
            </p>
          )}
          {data.sample_filter && data.sample_filter.n_samples_excluded > 0 && (
            <p className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2">
              {data.sample_filter.n_samples_excluded} sample{data.sample_filter.n_samples_excluded === 1 ? '' : 's'} excluded
              (fewer than {data.sample_filter.min_focal_cells} {typeA} cells).
              Spatial stats computed on {data.sample_filter.n_samples_analyzed} sample{data.sample_filter.n_samples_analyzed === 1 ? '' : 's'}.
            </p>
          )}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <CoxSummaryTable
                data={data.cox}
                analysisLevel={data.request.analysis_level ?? analysisLevel}
              />
            </div>
            {data.export_table && data.export_table.length > 0 && (
              <button
                type="button"
                onClick={() => downloadCsv(
                  data.export_table!,
                  `cox-${datasetId}-${analysisLevel}.csv`,
                )}
                className="btn-secondary text-xs shrink-0 flex items-center gap-1.5"
              >
                <Download size={12} /> Export CSV
              </button>
            )}
          </div>
          {data.cox.formula && (
            <p className="text-[10px] text-slate-500 font-mono break-all">
              {data.cox.formula}
              {data.cox.clustered && data.cox.n_clusters
                ? ` · cluster-robust (${data.cox.n_clusters} patients)`
                : ''}
            </p>
          )}
          {data.cox.km && <KMPlot data={data.cox.km} />}
        </>
      )}
      </div>
      <BivariateSurvivalPanel
      datasetId={datasetId}
      statistic={statistic}
      typeA={typeA}
      typeB={typeB}
      radius={radius}
      adjustDensity={adjustDensity}
      clusterPatients={clusterPatients}
      analysisLevel={analysisLevel}
      tissueRegion={tissueRegion || null}
      minFocalCells={minFocalCells}
      hasSurvival={hasSurvival}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bivariate panel: clustering × abundance joint stratification
// ---------------------------------------------------------------------------

const BIVARIATE_COLORS: Record<string, string> = {
  low_cluster_low_abund:    '#64748b',  // slate  – cold / dispersed
  high_cluster_low_abund:   '#f97316',  // orange – clustered but sparse
  low_cluster_high_abund:   '#3b82f6',  // blue   – abundant but dispersed
  high_cluster_high_abund:  '#10b981',  // emerald – hot / clustered
};

const BIVARIATE_LABELS: Record<string, string> = {
  low_cluster_low_abund:    'Low cluster · Low abundance',
  high_cluster_low_abund:   'High cluster · Low abundance',
  low_cluster_high_abund:   'Low cluster · High abundance',
  high_cluster_high_abund:  'High cluster · High abundance',
};

function BivariateSurvivalPanel({
  datasetId,
  statistic,
  typeA,
  typeB,
  radius,
  adjustDensity,
  clusterPatients,
  analysisLevel,
  tissueRegion,
  minFocalCells,
  hasSurvival,
}: {
  datasetId: string;
  statistic: 'K' | 'G';
  typeA: string;
  typeB: string;
  radius: number;
  adjustDensity: boolean;
  clusterPatients: boolean;
  analysisLevel: 'sample' | 'patient';
  tissueRegion: string | null;
  minFocalCells: number;
  hasSurvival: boolean;
}) {
  const [abundanceType, setAbundanceType] = useState<'pct' | 'count'>('pct');
  const [split, setSplit] = useState<'median' | 'tertile'>('median');
  const [localAdjustDensity, setLocalAdjustDensity] = useState(adjustDensity);

  const req = useMemo(() => hasSurvival ? {
    datasetId,
    statistic,
    typeA,
    typeB: typeB || null,
    radius,
    abundanceType,
    split,
    adjustDensity: localAdjustDensity,
    clusterPatients,
    analysisLevel,
    tissueRegion,
    minFocalCells,
    windowType: 'convex' as const,
  } : null, [datasetId, statistic, typeA, typeB, radius, abundanceType, split, localAdjustDensity, clusterPatients, analysisLevel, tissueRegion, minFocalCells, hasSurvival]);

  const { data, loading, error } = useBivariateCox(req);

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start gap-2">
        <GitBranch size={14} className="text-brand-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-xs font-semibold text-slate-300">
            Bivariate Analysis · Clustering × {typeA} Abundance
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Jointly stratifies each sample by its spatial clustering score and
            T-cell abundance into four quadrants (low/high × low/high), then
            fits a Cox PH model with the combined group as predictor.{' '}
            {typeB
              ? <span>Using <strong>cross-K</strong> ({typeA} × {typeB}): higher cluster = more co-localisation with {typeB}.</span>
              : <span>Using <strong>auto-K</strong> ({typeA} self-clustering): higher cluster score can reflect cellular aggregation or excluded phenotype — check KM curve order from data.</span>
            }
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        <label>
          <span className="text-slate-400 mb-1 block">Abundance measure</span>
          <select
            className="input text-xs"
            value={abundanceType}
            onChange={e => setAbundanceType(e.target.value as 'pct' | 'count')}
          >
            <option value="pct">% of {typeA} cells</option>
            <option value="count">Count of {typeA} cells</option>
          </select>
        </label>
        <label>
          <span className="text-slate-400 mb-1 block">Split method</span>
          <select
            className="input text-xs"
            value={split}
            onChange={e => setSplit(e.target.value as 'median' | 'tertile')}
          >
            <option value="median">Median (2×2 from all samples)</option>
            <option value="tertile">Tertile extremes (high contrast, fewer samples)</option>
          </select>
        </label>
        <label>
          <span className="text-slate-400 mb-1 block">Density adjustment</span>
          <select
            className="input text-xs"
            value={localAdjustDensity ? 'yes' : 'no'}
            onChange={e => setLocalAdjustDensity(e.target.value === 'yes')}
          >
            <option value="yes">Adjust for n_focal + log(area)</option>
            <option value="no">Unadjusted</option>
          </select>
        </label>
      </div>

      {loading && (
        <div className="border border-slate-800 rounded-lg p-4 flex items-center justify-center text-xs text-slate-500 gap-2">
          <Loader2 size={13} className="animate-spin" /> Fitting bivariate Cox model…
        </div>
      )}
      {error && (
        <div className="border border-rose-700/50 rounded-lg p-3 bg-rose-950/30 text-xs text-rose-300 flex items-start gap-2">
          <AlertCircle size={13} className="text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {data && (() => {
        const refQuadrant = data.cox.quadrants.find(q => q.label === 'low_cluster_low_abund');
        const refEmpty = refQuadrant != null && refQuadrant.n === 0;
        const emptyQuadrants = new Set(
          data.cox.quadrants.filter(q => q.n === 0).map(q => q.label),
        );

        return (
          <div className="space-y-4">
            {data.radius_guidance?.warn && data.radius_guidance.message && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2.5 text-xs text-amber-300">
                <AlertCircle size={13} className="text-amber-400 shrink-0 mt-0.5" />
                <span>{data.radius_guidance.message}</span>
              </div>
            )}

            {/* Quadrant guide */}
            <QuadrantGuide />

            {/* Warning: empty reference group invalidates HRs */}
            {refEmpty && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2.5 text-xs text-amber-300">
                <AlertCircle size={13} className="text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Reference group is empty</strong> — no samples fall in the{' '}
                  <em>Low cluster · Low abundance</em> quadrant with the current tertile
                  split. Hazard ratios cannot be interpreted when the reference is
                  absent. Switch to <strong>Median split</strong> or widen your
                  cohort to resolve this.
                </span>
              </div>
            )}

            {/* Warning: other empty quadrants (non-reference) */}
            {!refEmpty && emptyQuadrants.size > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-950/20 px-3 py-2.5 text-xs text-amber-400">
                <AlertCircle size={13} className="text-amber-400 shrink-0 mt-0.5" />
                <span>
                  {emptyQuadrants.size === 1 ? 'One quadrant has' : `${emptyQuadrants.size} quadrants have`}{' '}
                  no samples after the tertile filter. The KM plot shows dashed
                  placeholder lines for empty groups.
                </span>
              </div>
            )}

            {/* Quadrant counts */}
            <div className="grid grid-cols-2 gap-2">
              {data.cox.quadrants.map(q => (
                <div
                  key={q.label}
                  className={clsx(
                    'rounded-lg border bg-slate-900/50 px-3 py-2 flex items-start gap-2',
                    q.n === 0 ? 'border-amber-800/40 opacity-60' : 'border-slate-800',
                  )}
                >
                  <span
                    className="mt-0.5 w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ background: BIVARIATE_COLORS[q.label] ?? '#64748b' }}
                  />
                  <div>
                    <p className="text-[10px] text-slate-400">
                      {BIVARIATE_LABELS[q.label] ?? q.label}
                    </p>
                    <p className="text-xs text-slate-200 font-medium">
                      {q.n === 0
                        ? <span className="text-amber-500">n = 0 — empty</span>
                        : <>n = {q.n}<span className="text-slate-500 font-normal ml-1">({q.n_events} events)</span></>}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* HR table for the 3 non-reference contrasts */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <BivariateHRTable data={data.cox} refEmpty={refEmpty} />
              </div>
              {data.export_table && data.export_table.length > 0 && (
                <button
                  type="button"
                  onClick={() => downloadCsv(
                    data.export_table!,
                    `bivariate-cox-${datasetId}-${analysisLevel}.csv`,
                  )}
                  className="btn-secondary text-xs shrink-0 flex items-center gap-1.5"
                >
                  <Download size={12} /> Export CSV
                </button>
              )}
            </div>

            {/* Summary metrics */}
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">
                  N {analysisLevel === 'patient' ? 'patients' : 'samples'}
                </p>
                <p className="text-base font-semibold text-slate-200">{data.cox.n}</p>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center">
                  Concordance<ConcordanceTooltip />
                </p>
                <p className="text-base font-semibold text-slate-200">{formatNum(data.cox.concordance, 3)}</p>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Split</p>
                <p className="text-base font-semibold text-slate-200">{data.cox.split}</p>
              </div>
            </div>

            {data.cox.formula && (
              <p className="text-[10px] text-slate-500 font-mono break-all">
                {data.cox.formula}
                {data.cox.clustered && data.cox.n_clusters
                  ? ` · cluster-robust (${data.cox.n_clusters} patients)`
                  : ''}
                {data.cox.adjust_density && data.cox.density_covariates && data.cox.density_covariates.length > 0
                  ? ` · density-adjusted (${data.cox.density_covariates.join(', ')})`
                  : ''}
              </p>
            )}

            {/* 4-strata KM */}
            <BivariateKMPlot data={data.cox.km} />
          </div>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Concordance tooltip
// ---------------------------------------------------------------------------

function ConcordanceTooltip() {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="text-slate-500 hover:text-slate-300 transition-colors ml-1 focus:outline-none"
        aria-label="What is concordance?"
      >
        <Info size={11} />
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-64 rounded-lg border border-slate-700 bg-slate-900 shadow-xl p-3 text-left">
          <p className="text-[11px] font-semibold text-slate-200 mb-1">Harrell's C-index (Concordance)</p>
          <p className="text-[10px] text-slate-400 leading-relaxed mb-2">
            Measures how well the model ranks samples by survival risk. For any two
            samples where one had the event earlier, concordance tracks how often the
            model assigns that sample the higher predicted risk.
          </p>
          <div className="space-y-1">
            {([
              ['≈ 0.5', 'No better than chance — quadrants do not separate risk'],
              ['0.6 – 0.7', 'Modest discrimination'],
              ['0.7+', 'Reasonably good separation of risk groups'],
              ['0.8+', 'Strong (uncommon with 4 categorical groups)'],
            ] as [string, string][]).map(([range, desc]) => (
              <div key={range} className="flex gap-2">
                <span className="text-[10px] font-mono text-brand-300 shrink-0 w-16">{range}</span>
                <span className="text-[10px] text-slate-400">{desc}</span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-2 right-2 text-slate-600 hover:text-slate-400"
            aria-label="Close"
          >
            <X size={10} />
          </button>
        </div>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Quadrant guide: biological meaning of each 2×2 cell
// ---------------------------------------------------------------------------

const QUADRANT_GUIDE: Array<{
  key: string;
  emoji: string;
  headline: string;
  description: string;
}> = [
  {
    key: 'low_cluster_low_abund',
    emoji: '❄️',
    headline: 'Cold / dispersed',
    description:
      'Few cells of this type and they are spatially scattered — an immune-desert or immune-excluded phenotype with minimal overall infiltration. Used as the reference group; all hazard ratios are relative to this quadrant.',
  },
  {
    key: 'high_cluster_low_abund',
    emoji: '🔶',
    headline: 'Clustered but sparse',
    description:
      'Few cells overall, but the cells that are present are spatially aggregated. With auto-K this can indicate an immune-excluded pattern (cells cluster at the periphery rather than infiltrating); with cross-K toward tumour cells it may reflect a focal response. Prognosis depends on the spatial metric chosen.',
  },
  {
    key: 'low_cluster_high_abund',
    emoji: '🔵',
    headline: 'Abundant but dispersed',
    description:
      'Many cells present, distributed diffusely across the tissue without forming tight clusters. High overall infiltration with uniform spatial distribution — often the best-prognosis phenotype for CD8⁺ T cells when using auto-K, as it reflects broad tumour coverage rather than peripheral aggregation.',
  },
  {
    key: 'high_cluster_high_abund',
    emoji: '🟢',
    headline: 'Abundant & clustered',
    description:
      'High cell count and high spatial co-localisation. When the clustering metric is cross-K (T cell × tumour), this often indicates active immune attack. When auto-K is used, tight self-clustering at high abundance may reflect lymphoid aggregates that do not necessarily correlate with better outcomes. Verify the expected direction with the KM curves below.',
  },
];

function QuadrantGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-900/60 hover:bg-slate-900 transition-colors text-left"
      >
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium">
          <Info size={11} className="text-brand-400" />
          What do these quadrants mean?
        </span>
        <span className="text-slate-600 text-[10px]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-slate-800">
          {QUADRANT_GUIDE.map(q => (
            <div key={q.key} className="bg-slate-950 px-3 py-2.5 flex gap-2.5">
              <span
                className="mt-0.5 w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ background: BIVARIATE_COLORS[q.key] ?? '#64748b' }}
              />
              <div>
                <p className="text-[11px] font-semibold text-slate-200 mb-0.5">
                  {q.emoji} {q.headline}
                </p>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  {BIVARIATE_LABELS[q.key]}
                </p>
                <p className="text-[10px] text-slate-500 leading-relaxed mt-1">
                  {q.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BivariateHRTable({ data, refEmpty }: { data: import('../../api/types').BivariateCoxResult; refEmpty?: boolean }) {
  const ciMap = Object.fromEntries(
    data.confidence_intervals.map(r => [r.term, r]),
  );

  // Sort non-reference rows by HR descending (highest risk first).
  // Rows with no HR (missing CI entry) sort to the bottom.
  const jgTerms = data.coefficients
    .filter(r => typeof r.term === 'string' && r.term.startsWith('joint_group'))
    .slice()
    .sort((a, b) => {
      const hrA = (ciMap[a.term as string]?.['exp(coef)'] as number | undefined) ?? -Infinity;
      const hrB = (ciMap[b.term as string]?.['exp(coef)'] as number | undefined) ?? -Infinity;
      return hrB - hrA;
    });

  if (jgTerms.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-slate-800 text-slate-500 text-[10px] uppercase tracking-widest">
            <th className="text-left py-1.5 pr-4">
              Quadrant (vs low/low{refEmpty ? ' — ⚠ empty' : ''})
            </th>
            <th className="text-right py-1.5 pr-4">HR</th>
            <th className="text-right py-1.5 pr-4">95% CI</th>
            <th className="text-right py-1.5">p value</th>
          </tr>
        </thead>
        <tbody>
          {/* Reference row — always shown first */}
          <tr className="border-b border-slate-800/50 opacity-60">
            <td className="py-1.5 pr-4 flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-sm shrink-0"
                style={{ background: BIVARIATE_COLORS['low_cluster_low_abund'] }}
              />
              <span className="text-slate-400 italic">
                {BIVARIATE_LABELS['low_cluster_low_abund']}
              </span>
              <span className="text-[10px] text-slate-600 ml-1">(reference)</span>
            </td>
            <td className="text-right pr-4 font-medium text-slate-500">1.00</td>
            <td className="text-right pr-4 text-slate-600">—</td>
            <td className="text-right text-slate-600">—</td>
          </tr>

          {jgTerms.map(row => {
            const ci = ciMap[row.term as string] ?? {};
            const label = String(row.term).replace(/^joint_group/, '');
            const hr    = ci['exp(coef)'] as number | undefined;
            const lo    = ci['lower .95'] as number | undefined;
            const hi    = ci['upper .95'] as number | undefined;
            const pval  = (row['Pr(>|z|)'] ?? row['p']) as number | undefined;
            const sig   = pval != null && pval < 0.05;
            return (
              <tr key={String(row.term)} className="border-b border-slate-800/50">
                <td className="py-1.5 pr-4 flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-sm shrink-0"
                    style={{ background: BIVARIATE_COLORS[label] ?? '#64748b' }}
                  />
                  <span className="text-slate-300">
                    {BIVARIATE_LABELS[label] ?? label}
                  </span>
                </td>
                <td className={`text-right pr-4 font-medium ${sig ? 'text-emerald-300' : 'text-slate-300'}`}>
                  {hr != null ? formatNum(hr, 2) : '—'}
                </td>
                <td className="text-right pr-4 text-slate-400">
                  {lo != null && hi != null ? formatRange(lo, hi, 2) : '—'}
                </td>
                <td className={`text-right ${sig ? 'text-emerald-300' : 'text-slate-400'}`}>
                  {pval != null ? formatP(pval) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// The four expected quadrant keys — order here is only the fallback for
// groups absent from the data; actual rendering order is driven by survival.
const ALL_QUADRANT_KEYS = [
  'high_cluster_high_abund',
  'low_cluster_high_abund',
  'high_cluster_low_abund',
  'low_cluster_low_abund',
] as const;

/** Return the median survival time for one group (time when surv ≤ 0.5).
 *  Groups that never drop below 0.5 rank best (Infinity); ties broken by
 *  final survival value so the plot legend always runs best → worst. */
function medianSurvival(key: string, data: import('../../api/types').CoxKM): number {
  const indices = data.group
    .map((g, i) => (g === key ? i : -1))
    .filter(i => i >= 0);
  if (indices.length === 0) return -Infinity;
  for (const idx of indices) {
    if (data.surv[idx] <= 0.5) return data.time[idx];
  }
  // Never crossed 0.5 — encode as Infinity + final surv as fractional tiebreak
  return Infinity + (data.surv[indices[indices.length - 1]] ?? 0);
}

function CoxSummaryTable({
  data,
  analysisLevel = 'sample',
}: {
  data: import('../../api/types').CoxResult;
  analysisLevel?: 'sample' | 'patient';
}) {
  const unitLabel = analysisLevel === 'patient' ? 'patients' : 'samples';
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
      <Metric label={`N ${unitLabel}`} value={data.n.toString()} />
      <Metric label="Events" value={data.n_events.toString()} />
      <Metric
        label="Hazard ratio"
        value={formatNum(data.primary.hr, 2)}
        sub={`95% CI ${formatRange(data.primary.hr_lower, data.primary.hr_upper, 2)}`}
      />
      <Metric
        label="p value"
        value={formatP(data.primary.p_value)}
        accent={data.primary.p_value < 0.05 ? 'good' : 'neutral'}
      />
      <Metric label="Concordance" value={formatNum(data.concordance, 3)} />
      <Metric
        label="Clustering"
        value={data.clustered ? 'robust SE' : 'standard'}
        sub={data.n_clusters ? `${data.n_clusters} patients` : undefined}
      />
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'good' | 'neutral' }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-slate-500">{label}</p>
      <p className={`text-base font-semibold ${accent === 'good' ? 'text-emerald-300' : 'text-slate-200'}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function formatP(p: number): string {
  if (!isFinite(p)) return '—';
  if (p < 0.001) return p.toExponential(1);
  return p.toFixed(3);
}

function SurvivalUploadSlot({
  datasetId,
  apiDetailLoaded = false,
  onUploaded,
}: {
  datasetId: string;
  apiDetailLoaded?: boolean;
  onUploaded?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<UploadError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Frontend wizard falls back to "ds_<timestamp>" ids whenever the original
  // cells upload couldn't reach the backend (see Upload.tsx). That dataset
  // doesn't exist on the R API, so attaching survival to it can never work
  // — flag it explicitly instead of letting the user wonder.
  const isLocalOnlyId = datasetId.startsWith('ds_');

  const pickFile = (f: File | null) => {
    setSuccess(null);
    setError(null);
    if (!f) { setFile(null); return; }
    if (!/\.(csv|tsv)$/i.test(f.name)) {
      setError({ kind: 'validation', message: 'Survival data must be a .csv or .tsv file.' });
      setFile(null);
      return;
    }
    setFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pickFile(e.dataTransfer.files?.[0] ?? null);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const resp = await uploadSurvival(datasetId, file);
      setSuccess(
        `${resp.survival_rows} matched samples attached — Cox PH analysis is now available.`,
      );
      onUploaded?.();
    } catch (e) {
      setError(classifyUploadError(e, { datasetId, isLocalOnlyId }));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="card p-5 space-y-4">
      <div>
        <p className="text-xs font-semibold text-slate-300">Survival Analysis</p>
        <p className="text-xs text-slate-500 mt-1">
          No survival data is linked to this dataset yet. Upload a
          <code className="text-brand-400 mx-1">survival.csv</code>
          with columns
          <code className="text-brand-400 mx-1">sample_id</code>
          (or <code className="text-brand-400">patient_id</code>),
          <code className="text-brand-400 mx-1">time</code>,
          <code className="text-brand-400 mx-1">status</code>
          (extra columns such as age, stage, grade become covariates for Cox and
          Clinical Analysis) to enable survival and outcome modeling.
        </p>
      </div>

      {(!apiDetailLoaded && !isLocalOnlyId) && (
        <div className="border border-amber-700/50 rounded-lg p-3 bg-amber-950/30 text-xs text-amber-200 flex items-start gap-2">
          <AlertCircle size={13} className="text-amber-400 shrink-0 mt-0.5" />
          <span>
            This dataset is not registered on the R API (bundled demo data).
            Run <code className="text-amber-300">npm run dev</code> and upload
            cells via <strong>Contribute</strong>, or seed the test cohort with{' '}
            <code className="text-amber-300">npm run seed:test1</code>, to enable
            survival and clinical modeling.
          </span>
        </div>
      )}

      {isLocalOnlyId && (
        <div className="border border-amber-700/50 rounded-lg p-3 bg-amber-950/30 text-xs text-amber-200 flex items-start gap-2">
          <AlertCircle size={13} className="text-amber-400 shrink-0 mt-0.5" />
          <span>
            This dataset only exists in your browser — the original cells
            upload couldn&apos;t reach the backend, so it has the placeholder
            id <code className="text-amber-300">{datasetId}</code>.
            Survival data can&apos;t be attached until the dataset itself is
            uploaded. Start the R API and re-upload the cells via{' '}
            <strong>Contribute</strong>, then attach the survival CSV from the
            new dataset&apos;s page.
          </span>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv"
        className="hidden"
        onChange={e => pickFile(e.target.files?.[0] ?? null)}
      />

      <div
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          dragging
            ? 'border-brand-500 bg-brand-950/30'
            : 'border-slate-700 hover:border-slate-600 bg-slate-900/30'
        }`}
      >
        <Upload size={22} className={`mx-auto mb-2 ${dragging ? 'text-brand-400' : 'text-slate-500'}`} />
        <p className="text-xs text-slate-300 font-medium">
          {file ? 'Choose a different file' : 'Drop survival.csv here or click to browse'}
        </p>
        <p className="text-[11px] text-slate-600 mt-1">.csv · .tsv</p>
      </div>

      <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
        <FileText size={14} className={file ? 'text-brand-400 shrink-0' : 'text-slate-700 shrink-0'} />
        <div className="flex-1 min-w-0">
          {file ? (
            <>
              <p className="text-xs text-slate-200 truncate">{file.name}</p>
              <p className="text-[10px] text-slate-600">{(file.size / 1024).toFixed(1)} KB</p>
            </>
          ) : (
            <p className="text-xs text-slate-600 italic">No survival file selected yet.</p>
          )}
        </div>
        {file && (
          <button
            onClick={(e) => { e.stopPropagation(); pickFile(null); }}
            className="text-slate-600 hover:text-rose-400 transition-colors p-1"
            aria-label="Remove file"
          >
            <X size={13} />
          </button>
        )}
        <button
          onClick={handleUpload}
          disabled={!file || uploading || isLocalOnlyId}
          className="btn-primary text-xs disabled:opacity-50 shrink-0"
          title={
            isLocalOnlyId
              ? 'Re-upload this dataset to the backend first.'
              : !file
                ? 'Pick a survival CSV first.'
                : 'Submit the survival CSV to the backend'
          }
        >
          {uploading
            ? <><Loader2 size={13} className="animate-spin" /> Uploading…</>
            : <><Upload size={13} /> Submit</>}
        </button>
      </div>

      {success && (
        <p className="text-xs text-emerald-300 flex items-center gap-1.5">
          <CheckCircle2 size={13} /> {success}
        </p>
      )}

      {error && <UploadErrorPanel error={error} />}
    </div>
  );
}

type UploadError =
  | { kind: 'validation'; message: string }
  | { kind: 'network'; message: string; apiUrl: string }
  | { kind: 'not_found'; message: string; datasetId: string; isLocalOnlyId: boolean }
  | { kind: 'api'; status: number; message: string }
  | { kind: 'unknown'; message: string };

function classifyUploadError(
  e: unknown,
  ctx: { datasetId: string; isLocalOnlyId: boolean },
): UploadError {
  if (e instanceof ApiError) {
    if (e.status === 404) {
      return {
        kind: 'not_found',
        message: e.message,
        datasetId: ctx.datasetId,
        isLocalOnlyId: ctx.isLocalOnlyId,
      };
    }
    return { kind: 'api', status: e.status, message: e.message };
  }
  // `fetch` rejects with a TypeError before any HTTP response when the
  // request can't reach the server (DNS, refused connection, CORS preflight
  // failure, mixed content). In every browser the message is "Failed to
  // fetch" / "Load failed" / "NetworkError when attempting to fetch resource".
  const message = e instanceof Error ? e.message : String(e);
  if (
    e instanceof TypeError ||
    /failed to fetch|load failed|networkerror/i.test(message)
  ) {
    return { kind: 'network', message, apiUrl: API_URL };
  }
  return { kind: 'unknown', message: message || 'Upload failed.' };
}

function UploadErrorPanel({ error }: { error: UploadError }) {
  return (
    <div className="border border-rose-700/50 rounded-lg p-3 bg-rose-950/30 text-xs text-rose-200 flex items-start gap-2">
      <AlertCircle size={13} className="text-rose-400 shrink-0 mt-0.5" />
      <div className="space-y-1 min-w-0">
        {error.kind === 'network' && (
          <>
            <p className="font-semibold text-rose-100">
              Couldn&apos;t reach the backend at{' '}
              <code className="text-rose-50">{error.apiUrl}</code>.
            </p>
            <p className="text-rose-300/90">
              The browser failed before any response came back
              (<code className="text-rose-100">{error.message}</code>),
              which usually means the R API isn&apos;t running, is on a
              different port, or its CORS origin doesn&apos;t allow this page.
            </p>
            <ul className="list-disc pl-4 text-rose-300/90 space-y-0.5">
              <li>
                Start the API:{' '}
                <code className="text-rose-100">Rscript R/main.R</code> from{' '}
                <code className="text-rose-100">spatial-portal-api/</code>.
              </li>
              <li>
                Verify with{' '}
                <code className="text-rose-100">curl {error.apiUrl}/health</code>.
              </li>
              <li>
                Point the frontend elsewhere by setting{' '}
                <code className="text-rose-100">VITE_API_URL</code> in{' '}
                <code className="text-rose-100">.env.development</code> and
                restarting <code className="text-rose-100">vite</code>.
              </li>
            </ul>
          </>
        )}
        {error.kind === 'not_found' && (
          <>
            <p className="font-semibold text-rose-100">
              Backend doesn&apos;t know about dataset{' '}
              <code className="text-rose-50">{error.datasetId}</code>.
            </p>
            <p className="text-rose-300/90">
              {error.isLocalOnlyId
                ? 'This is a placeholder id created when the cells upload couldn\u2019t reach the backend. Re-upload the cells via the Contribute wizard with the R API running, then attach the survival CSV on the new dataset page.'
                : 'The dataset may have been deleted or the backend cache may have been cleared. Re-upload the dataset and try again.'}
            </p>
          </>
        )}
        {error.kind === 'api' && (
          <>
            <p className="font-semibold text-rose-100">
              Backend rejected the upload ({error.status}).
            </p>
            <p className="text-rose-300/90">{error.message}</p>
          </>
        )}
        {error.kind === 'validation' && (
          <p className="text-rose-200">{error.message}</p>
        )}
        {error.kind === 'unknown' && (
          <p className="text-rose-200">{error.message}</p>
        )}
      </div>
    </div>
  );
}

const KM_COLORS = ['#3b82f6', '#f97316', '#a855f7', '#10b981'];

function BivariateKMPlot({ data }: { data: import('../../api/types').CoxKM }) {
  // Sort quadrant keys best → worst by actual median survival in this dataset.
  const sortedKeys = [...ALL_QUADRANT_KEYS].sort(
    (a, b) => medianSurvival(b, data) - medianSurvival(a, data),
  );

  const traces: Data[] = sortedKeys.map(g => {
    const indices = data.group
      .map((gn, idx) => (gn === g ? idx : -1))
      .filter(idx => idx >= 0);

    if (indices.length === 0) {
      return {
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: `${BIVARIATE_LABELS[g] ?? g} (no data)`,
        x: [0, 1],
        y: [1, 1],
        line: { width: 1, shape: 'hv' as const, color: BIVARIATE_COLORS[g] ?? '#94a3b8', dash: 'dot' as const },
        opacity: 0.35,
      };
    }

    return {
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: BIVARIATE_LABELS[g] ?? g,
      x: indices.map(i => data.time[i]),
      y: indices.map(i => data.surv[i]),
      line: { width: 2, shape: 'hv' as const, color: BIVARIATE_COLORS[g] ?? '#94a3b8' },
    };
  });

  const layout: Partial<Layout> = {
    title: { text: 'Clustering × Abundance — Kaplan-Meier', font: { size: 12, color: '#cbd5e1' } },
    height: 340,
    margin: { l: 50, r: 20, t: 30, b: 40 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(15,23,42,0.4)',
    font: { color: '#94a3b8', size: 10 },
    xaxis: { title: { text: 'Time' }, gridcolor: '#1e293b' },
    yaxis: { title: { text: 'Survival probability' }, gridcolor: '#1e293b', range: [0, 1.05] },
    legend: { font: { color: '#cbd5e1', size: 10 } },
  };

  return (
    <Plot
      data={traces}
      layout={layout}
      style={{ width: '100%' }}
      config={{ displayModeBar: false }}
    />
  );
}

function KMPlot({ data }: { data: import('../../api/types').CoxKM }) {
  const groups = Array.from(new Set(data.group));

  const traces: Data[] = groups.map((g, i) => {
    const indices = data.group.map((gn, idx) => gn === g ? idx : -1).filter(idx => idx >= 0);
    return {
      type: 'scatter',
      mode: 'lines',
      name: g,
      x: indices.map(idx => data.time[idx]),
      y: indices.map(idx => data.surv[idx]),
      line: { width: 2, shape: 'hv', color: KM_COLORS[i] ?? KM_COLORS[KM_COLORS.length - 1] },
    };
  });

  const layout: Partial<Layout> = {
    title: { text: 'Kaplan-Meier survival curves', font: { size: 12, color: '#cbd5e1' } },
    height: 320,
    margin: { l: 50, r: 20, t: 30, b: 40 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(15,23,42,0.4)',
    font: { color: '#94a3b8', size: 10 },
    xaxis: { title: { text: 'time' }, gridcolor: '#1e293b' },
    yaxis: { title: { text: 'Survival probability' }, gridcolor: '#1e293b', range: [0, 1.05] },
    legend: { font: { color: '#cbd5e1', size: 10 } },
  };

  return <Plot data={traces} layout={layout} style={{ width: '100%' }} config={{ displayModeBar: false }} />;
}
