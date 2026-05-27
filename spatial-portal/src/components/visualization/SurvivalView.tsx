// Survival analysis tab: runs a Cox PH model on a chosen spatial statistic
// (Ripley's K reduced to L(r)-r at a chosen radius, or NN G), and plots
// the resulting Kaplan-Meier curves stratified by the median split.

import { useMemo, useRef, useState, useEffect } from 'react';
import Plot from '../../lib/plot';
import type { Data, Layout } from 'plotly.js';
import { useCox } from '../../hooks/useAnalysis';
import { API_URL, ApiError, uploadSurvival } from '../../api/client';
import { Loader2, AlertCircle, Upload, CheckCircle2, FileText, X } from 'lucide-react';

interface Props {
  datasetId: string;
  availableCellTypes: string[];
  hasSurvival: boolean;
  onSurvivalAttached?: () => void;
}

const DEFAULT_T_CELL_OPTIONS = ['CD8+ T Cell', 'CD4+ T Cell', 'T Cell', 'CD8_T'];

function pickDefaultCellType(available: string[]): string {
  if (available.length === 0) return DEFAULT_T_CELL_OPTIONS[0];
  const preferred = available.find(ct => DEFAULT_T_CELL_OPTIONS.includes(ct));
  return preferred ?? available[0];
}

export default function SurvivalView({
  datasetId,
  availableCellTypes,
  hasSurvival,
  onSurvivalAttached,
}: Props) {
  const tCellOptions = availableCellTypes.length > 0 ? availableCellTypes : DEFAULT_T_CELL_OPTIONS;
  const [typeA, setTypeA] = useState(() => pickDefaultCellType(tCellOptions));

  useEffect(() => {
    if (availableCellTypes.length === 0) return;
    setTypeA(prev =>
      availableCellTypes.includes(prev) ? prev : pickDefaultCellType(availableCellTypes),
    );
  }, [availableCellTypes]);

  const [statistic, setStatistic] = useState<'K' | 'G'>('K');
  const [radius, setRadius] = useState(50);
  const [dichotomize, setDichotomize] = useState<'median' | 'tertile' | 'none'>('none');
  const [adjustDensity, setAdjustDensity] = useState(true);
  const [clusterPatients, setClusterPatients] = useState(true);
  const [minFocalCells, setMinFocalCells] = useState(10);

  const req = useMemo(() => hasSurvival ? {
    datasetId,
    statistic,
    radius,
    typeA,
    dichotomize,
    adjustDensity,
    clusterPatients,
    minFocalCells,
    windowType: 'convex' as const,
  } : null, [datasetId, statistic, radius, typeA, dichotomize, adjustDensity, clusterPatients, minFocalCells, hasSurvival]);

  const { data, loading, error } = useCox(req);

  if (!hasSurvival) {
    return (
      <SurvivalUploadSlot
        datasetId={datasetId}
        onUploaded={onSurvivalAttached}
      />
    );
  }

  return (
    <div className="card p-5 space-y-5">
      <div>
        <p className="text-xs font-semibold text-slate-300">Cox Proportional Hazards · Spatial T-cell Clustering vs Survival</p>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Per-sample {statistic === 'K' ? 'L(r) − r' : 'G(r) − G_csr(r)'} at r = {radius} px
          {dichotomize === 'none'
            ? ' is fit continuously in '
            : ` is median/tertile-stratified in `}
          <code className="text-brand-400">
            {dichotomize === 'none'
              ? 'coxph(Surv(time, status) ~ stat'
              : 'coxph(Surv(time, status) ~ group'}
            {adjustDensity ? ' + n_focal + log_area' : ''})
          </code>
          {clusterPatients ? ' with cluster-robust SE by patient when available.' : '.'}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 text-xs">
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
            value={radius} onChange={e => setRadius(Math.max(5, Number(e.target.value) || 50))}
            className="input text-xs"
          />
        </label>
        <label>
          <span className="text-slate-400 mb-1 block">Stratification</span>
          <select className="input text-xs" value={dichotomize} onChange={e => setDichotomize(e.target.value as 'median' | 'tertile' | 'none')}>
            <option value="none">Continuous (default)</option>
            <option value="median">Median split + KM</option>
            <option value="tertile">Top vs bottom tertile + KM</option>
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
          {data.sample_filter && data.sample_filter.n_samples_excluded > 0 && (
            <p className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2">
              {data.sample_filter.n_samples_excluded} sample{data.sample_filter.n_samples_excluded === 1 ? '' : 's'} excluded
              (fewer than {data.sample_filter.min_focal_cells} {typeA} cells).
              Cox model uses {data.sample_filter.n_samples_analyzed} sample{data.sample_filter.n_samples_analyzed === 1 ? '' : 's'}.
            </p>
          )}
          <CoxSummaryTable data={data.cox} />
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
  );
}

function CoxSummaryTable({ data }: { data: import('../../api/types').CoxResult }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
      <Metric label="N samples" value={data.n.toString()} />
      <Metric label="Events" value={data.n_events.toString()} />
      <Metric
        label="Hazard ratio"
        value={data.primary.hr.toFixed(2)}
        sub={`95% CI ${data.primary.hr_lower.toFixed(2)}–${data.primary.hr_upper.toFixed(2)}`}
      />
      <Metric
        label="p value"
        value={formatP(data.primary.p_value)}
        accent={data.primary.p_value < 0.05 ? 'good' : 'neutral'}
      />
      <Metric label="Concordance" value={data.concordance.toFixed(3)} />
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
  onUploaded,
}: {
  datasetId: string;
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
          (extra columns become Cox covariates) to enable Cox PH analysis.
        </p>
      </div>

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
      line: { width: 2, shape: 'hv', color: i === 0 ? '#3b82f6' : '#f97316' },
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
