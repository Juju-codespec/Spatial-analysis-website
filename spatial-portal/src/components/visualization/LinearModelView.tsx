// Linear / logistic models: predict a clinical outcome from spatial clustering
// and covariates (age, stage, grade, etc.).

import { useEffect, useMemo, useState } from 'react';
import { useLinear } from '../../hooks/useAnalysis';
import LinearModelResults from './LinearModelResults';
import { Loader2, AlertCircle } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  datasetId: string;
  availableCellTypes: string[];
  hasSurvival: boolean;
  survivalColumns: string[];
  apiDetailLoaded?: boolean;
}

const DEFAULT_T_CELL_OPTIONS = ['CD8+ T Cell', 'CD4+ T Cell', 'T Cell', 'CD8_T'];
const ID_COLUMNS = new Set(['sample_id', 'patient_id']);

function pickDefaultCellType(available: string[]): string {
  if (available.length === 0) return DEFAULT_T_CELL_OPTIONS[0];
  const preferred = available.find(ct => DEFAULT_T_CELL_OPTIONS.includes(ct));
  return preferred ?? available[0];
}

function defaultOutcome(columns: string[]): string {
  if (columns.includes('status')) return 'status';
  const candidates = columns.filter(c => !ID_COLUMNS.has(c) && c !== 'time');
  return candidates[0] ?? 'status';
}

function defaultCovariates(columns: string[], outcome: string): string[] {
  const preferred = ['age', 'race', 'sex', 'gender', 'stage', 'grade', 'arm', 'status'];
  return preferred.filter(c => columns.includes(c) && c !== outcome);
}

export default function LinearModelView({
  datasetId,
  availableCellTypes,
  hasSurvival,
  survivalColumns,
  apiDetailLoaded = false,
}: Props) {
  const tCellOptions = availableCellTypes.length > 0 ? availableCellTypes : DEFAULT_T_CELL_OPTIONS;
  const [typeA, setTypeA] = useState(() => pickDefaultCellType(tCellOptions));
  const [statistic, setStatistic] = useState<'K' | 'G'>('K');
  const [radius, setRadius] = useState(50);
  const [outcomeColumn, setOutcomeColumn] = useState(() => defaultOutcome(survivalColumns));
  const [covariates, setCovariates] = useState<string[]>(() =>
    defaultCovariates(survivalColumns, defaultOutcome(survivalColumns)),
  );
  const [adjustDensity, setAdjustDensity] = useState(true);
  const [clusterPatients, setClusterPatients] = useState(true);
  const [dichotomize, setDichotomize] = useState<'none' | 'median' | 'tertile'>('median');
  const [minFocalCells, setMinFocalCells] = useState(10);

  useEffect(() => {
    if (availableCellTypes.length === 0) return;
    setTypeA(prev =>
      availableCellTypes.includes(prev) ? prev : pickDefaultCellType(availableCellTypes),
    );
  }, [availableCellTypes]);

  useEffect(() => {
    if (survivalColumns.length === 0) return;
    setOutcomeColumn(prev =>
      survivalColumns.includes(prev) ? prev : defaultOutcome(survivalColumns),
    );
  }, [survivalColumns]);

  useEffect(() => {
    setCovariates(prev =>
      prev.filter(c => survivalColumns.includes(c) && c !== outcomeColumn),
    );
  }, [outcomeColumn, survivalColumns]);

  const covariateOptions = useMemo(
    () => survivalColumns.filter(c => !ID_COLUMNS.has(c) && c !== outcomeColumn && c !== 'time'),
    [survivalColumns, outcomeColumn],
  );

  const outcomeOptions = useMemo(
    () => survivalColumns.filter(c => !ID_COLUMNS.has(c)),
    [survivalColumns],
  );

  const req = useMemo(() => hasSurvival ? {
    datasetId,
    statistic,
    radius,
    typeA,
    outcomeColumn,
    covariates,
    dichotomize,
    adjustDensity,
    clusterPatients,
    minFocalCells,
    windowType: 'convex' as const,
  } : null, [
    datasetId, statistic, radius, typeA, outcomeColumn, covariates,
    dichotomize, adjustDensity, clusterPatients, minFocalCells, hasSurvival,
  ]);

  const { data, loading, error } = useLinear(req);

  const toggleCovariate = (col: string) => {
    setCovariates(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col],
    );
  };

  if (!hasSurvival) {
    return (
      <div className="card p-5 border-dashed border-slate-700">
        <p className="text-xs font-semibold text-slate-300">Clinical outcome modeling</p>
        {!apiDetailLoaded ? (
          <p className="text-xs text-slate-500 mt-2">
            This dataset is not available on the R API (demo datasets and offline uploads
            cannot run clinical models). Upload cells via the{' '}
            <span className="text-brand-400">Upload</span> page while{' '}
            <code className="text-brand-400">npm run dev</code> is running, or seed the
            test cohort with <code className="text-brand-400">npm run seed:test1</code>.
          </p>
        ) : (
          <p className="text-xs text-slate-500 mt-2">
            Attach clinical metadata via the Clinical Analysis tab (CSV with{' '}
            <code className="text-brand-400">sample_id</code> plus outcomes such as{' '}
            <code className="text-brand-400">status</code>,{' '}
            <code className="text-brand-400">age</code>,{' '}
            <code className="text-brand-400">stage</code>, or{' '}
            <code className="text-brand-400">grade</code>).
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="card p-5 space-y-5">
      <div>
        <p className="text-xs font-semibold text-slate-300">
          Linear / Logistic Models · Spatial Clustering vs Clinical Outcomes
        </p>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Per-sample {statistic === 'K' ? 'L(r) − r' : 'G(r) − G_csr(r)'} at r = {radius} px
          {dichotomize === 'none'
            ? ' (continuous) predicts '
            : dichotomize === 'median'
              ? ' split at the median into high/low clustering predicts '
              : ' split at tertiles (top vs bottom) predicts '}
          <code className="text-brand-400">{outcomeColumn}</code>
          {covariates.length > 0 && (
            <> with covariates {covariates.map(c => (
              <code key={c} className="text-brand-400 mx-0.5">{c}</code>
            ))}</>
          )}
          . Binary outcomes use logistic regression; numeric outcomes use ordinary least squares.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-8 gap-3 text-xs">
        <label>
          <span className="text-slate-400 mb-1 block">Outcome</span>
          <select
            className="input text-xs"
            value={outcomeColumn}
            onChange={e => setOutcomeColumn(e.target.value)}
          >
            {outcomeOptions.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
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
          <span className="text-slate-400 mb-1 block">Radius (px)</span>
          <input
            type="number" min={5} max={500} step={5}
            value={radius}
            onChange={e => setRadius(Math.max(5, Number(e.target.value) || 50))}
            className="input text-xs"
          />
        </label>
        <label>
          <span className="text-slate-400 mb-1 block">Clustering</span>
          <select
            className="input text-xs"
            value={dichotomize}
            onChange={e => setDichotomize(e.target.value as 'none' | 'median' | 'tertile')}
          >
            <option value="median">High / low (median split)</option>
            <option value="tertile">High / low (tertile)</option>
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
          <span className="text-slate-400 mb-1 block">Patient clustering</span>
          <select
            className="input text-xs"
            value={clusterPatients ? 'yes' : 'no'}
            onChange={e => setClusterPatients(e.target.value === 'yes')}
          >
            <option value="yes">Cluster-robust SE</option>
            <option value="no">Standard SE</option>
          </select>
        </label>
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

      {loading && (
        <div className="border border-slate-800 rounded-lg p-6 bg-slate-900/40 flex items-center justify-center text-xs text-slate-500 gap-2">
          <Loader2 size={14} className="animate-spin" /> Fitting model on backend…
        </div>
      )}
      {error && (
        <div className="border border-rose-700/50 rounded-lg p-4 bg-rose-950/30 text-xs text-rose-300 flex items-start gap-2">
          <AlertCircle size={13} className="text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {data && (
        <LinearModelResults
          lin={data.linear}
          clusteringLabel={`${typeA} clustering`}
          sampleFilterNote={
            data.sample_filter && data.sample_filter.n_samples_excluded > 0
              ? `${data.sample_filter.n_samples_excluded} sample${data.sample_filter.n_samples_excluded === 1 ? '' : 's'} excluded (fewer than ${data.sample_filter.min_focal_cells} ${typeA} cells). Model uses ${data.sample_filter.n_samples_analyzed} sample${data.sample_filter.n_samples_analyzed === 1 ? '' : 's'}.`
              : undefined
          }
        />
      )}
    </div>
  );
}
