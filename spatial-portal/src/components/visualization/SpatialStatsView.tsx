// Spatial statistics tab: plots Ripley's K (and L(r)-r) and Nearest-Neighbour
// G for the active dataset, computed server-side by spatstat.

import { useMemo, useState, useEffect } from 'react';
import Plot from '../../lib/plot';
import type { Data, Layout } from 'plotly.js';
import { useRipleyK, useNnG } from '../../hooks/useAnalysis';
import type { RipleyKResponse, NnGResponse } from '../../api/types';
import { Loader2, AlertCircle } from 'lucide-react';

interface Props {
  datasetId: string;
  availableCellTypes: string[];
}

const DEFAULT_T_CELL_OPTIONS = ['CD8+ T Cell', 'CD4+ T Cell', 'T Cell', 'CD8_T'];
const DEFAULT_R_MAX = 100;
const DEFAULT_NSIM = 49;
const DEFAULT_MIN_FOCAL = 10;

function pickDefaultCellType(available: string[]): string {
  if (available.length === 0) return DEFAULT_T_CELL_OPTIONS[0];
  const preferred = available.find(ct => DEFAULT_T_CELL_OPTIONS.includes(ct));
  return preferred ?? available[0];
}

export default function SpatialStatsView({ datasetId, availableCellTypes }: Props) {
  const tCellOptions = availableCellTypes.length > 0 ? availableCellTypes : DEFAULT_T_CELL_OPTIONS;

  const [typeA, setTypeA] = useState<string>(() => pickDefaultCellType(tCellOptions));
  const [typeB, setTypeB] = useState<string>('');
  const [rMax, setRMax] = useState<number>(DEFAULT_R_MAX);
  const [minFocalCells, setMinFocalCells] = useState<number>(DEFAULT_MIN_FOCAL);
  const [showEnvelopes, setShowEnvelopes] = useState(true);

  useEffect(() => {
    if (availableCellTypes.length === 0) return;
    setTypeA(prev =>
      availableCellTypes.includes(prev) ? prev : pickDefaultCellType(availableCellTypes),
    );
  }, [availableCellTypes]);

  const baseReq = useMemo(() => ({
    datasetId,
    typeA,
    typeB: typeB || null,
    rMax,
    windowType: 'convex' as const,
    nsim: showEnvelopes ? DEFAULT_NSIM : 0,
    minFocalCells,
  }), [datasetId, typeA, typeB, rMax, showEnvelopes, minFocalCells]);

  const k = useRipleyK(baseReq);
  const g = useNnG(baseReq);

  const sampleCount = k.data?.n_samples_analyzed ?? k.data?.per_sample.length ?? g.data?.n_samples_analyzed ?? g.data?.per_sample.length ?? 0;
  const samplesExcluded = k.data?.n_samples_excluded ?? g.data?.n_samples_excluded ?? 0;
  const windowType = k.data?.window_type ?? g.data?.window_type ?? 'convex';

  return (
    <div className="card p-5 space-y-5">
      <div>
        <p className="text-xs font-semibold text-slate-300">
          Spatial Point-Pattern Statistics
        </p>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Ripley&apos;s K (and Besag&apos;s L) describe second-order clustering;
          values above the Poisson reference indicate spatial aggregation.
          Nearest-Neighbour G summarises how close cells are to their closest
          like-typed neighbour. Observation windows use the tissue convex hull;
          optional CSR simulation envelopes ({DEFAULT_NSIM} sims) provide a
          formal clustering test.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs">
        <label className="block">
          <span className="text-slate-400 mb-1 block">Cell Type A</span>
          <select className="input text-xs" value={typeA} onChange={e => setTypeA(e.target.value)}>
            {tCellOptions.map(ct => <option key={ct} value={ct}>{ct}</option>)}
            {availableCellTypes.filter(ct => !tCellOptions.includes(ct)).map(ct => (
              <option key={ct} value={ct}>{ct}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-slate-400 mb-1 block">Cell Type B (cross-K, optional)</span>
          <select className="input text-xs" value={typeB} onChange={e => setTypeB(e.target.value)}>
            <option value="">— univariate —</option>
            {availableCellTypes.filter(ct => ct !== typeA).map(ct => (
              <option key={ct} value={ct}>{ct}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-slate-400 mb-1 block">Min positive cells / sample</span>
          <input
            type="number" min={1} max={500} step={1}
            value={minFocalCells}
            onChange={e => setMinFocalCells(Math.max(1, Number(e.target.value) || DEFAULT_MIN_FOCAL))}
            className="input text-xs"
          />
        </label>
        <label className="block">
          <span className="text-slate-400 mb-1 block">Max radius (px)</span>
          <input
            type="number" min={10} max={500} step={5}
            value={rMax}
            onChange={e => setRMax(Math.max(10, Number(e.target.value) || DEFAULT_R_MAX))}
            className="input text-xs"
          />
        </label>
        <label className="block">
          <span className="text-slate-400 mb-1 block">CSR envelopes</span>
          <select
            className="input text-xs"
            value={showEnvelopes ? 'yes' : 'no'}
            onChange={e => setShowEnvelopes(e.target.value === 'yes')}
          >
            <option value="yes">On ({DEFAULT_NSIM} permutations)</option>
            <option value="no">Off (faster)</option>
          </select>
        </label>
      </div>

      {samplesExcluded > 0 && (
        <p className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2">
          {samplesExcluded} sample{samplesExcluded === 1 ? '' : 's'} excluded (fewer than {minFocalCells} {typeA} cells).
          Analyzing {sampleCount} sample{sampleCount === 1 ? '' : 's'}.
        </p>
      )}

      <MethodsBlurb
        typeA={typeA}
        typeB={typeB || null}
        windowType={windowType}
        sampleCount={sampleCount}
        kCorrection={k.data?.correction ?? 'iso'}
        gCorrection={g.data?.correction ?? 'km'}
        envelopes={showEnvelopes}
      />

      <KPlot title="L(r) − r  (Besag, centered at 0 under CSR)" data={k.data} loading={k.loading} error={k.error} mode="L" />
      <KPlot title="K(r)" data={k.data} loading={k.loading} error={k.error} mode="K" />
      <GPlot data={g.data} loading={g.loading} error={g.error} />
    </div>
  );
}

function MethodsBlurb({
  typeA,
  typeB,
  windowType,
  sampleCount,
  kCorrection,
  gCorrection,
  envelopes,
}: {
  typeA: string;
  typeB: string | null;
  windowType: string;
  sampleCount: number;
  kCorrection: string;
  gCorrection: string;
  envelopes: boolean;
}) {
  return (
    <div className="text-[10px] text-slate-500 bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2 space-y-0.5">
      <p>
        <span className="text-slate-400">Methods:</span>{' '}
        {typeB ? `cross-K/G (${typeA} vs ${typeB})` : `univariate K/G (${typeA})`};
        window = {windowType === 'convex' ? 'tissue convex hull' : 'bounding box'};
        K correction = {kCorrection}, G correction = {gCorrection};
        {sampleCount > 0 ? ` n = ${sampleCount} samples.` : ''}
        {envelopes ? ` CSR permutation envelopes: ${DEFAULT_NSIM} sims (observed vs null).` : ' CSR envelopes off.'}
      </p>
      <p>
        Cox defaults elsewhere: K radius = 50 px, G radius = 20 px (user-adjustable).
      </p>
    </div>
  );
}

interface KPlotProps {
  title: string;
  data: RipleyKResponse | null;
  loading: boolean;
  error: string | null;
  mode: 'K' | 'L';
}

function KPlot({ title, data, loading, error, mode }: KPlotProps) {
  if (loading) return <PlotPlaceholder title={title} status="loading" />;
  if (error)   return <PlotPlaceholder title={title} status="error" message={error} />;
  if (!data || data.per_sample.length === 0)
    return <PlotPlaceholder title={title} status="empty" message={data?.analysis_message ?? 'No samples available'} />;

  const samples = data.per_sample.slice(0, 25); // cap rendered traces
  const isCross = !!data.type_b;
  const hasEnvelopes = samples.some(s => s.envelope_lo && s.envelope_hi);

  const traces: Data[] = samples.map(s => ({
    type: 'scatter',
    mode: 'lines',
    name: s.sample_id,
    x: s.r,
    y: mode === 'L'
      ? s.L_obs.map((v, i) => v - s.r[i])
      : s.K_obs,
    line: { width: 1 },
    opacity: 0.55,
    hovertemplate: `${s.sample_id}<br>r=%{x:.1f}<br>${mode}=%{y:.3g}<extra></extra>`,
  }));

  // Cohort mean overlay.
  const summary = data.summary;
  if (summary) {
    if (mode === 'L' && summary.L_obs_mean) {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        name: 'cohort mean',
        x: summary.r,
        y: summary.L_obs_mean.map((v, i) => v - summary.r[i]),
        line: { width: 3, color: '#3b82f6' },
      });
    }
    if (mode === 'K' && summary.K_obs_mean) {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        name: 'cohort mean',
        x: summary.r,
        y: summary.K_obs_mean,
        line: { width: 3, color: '#3b82f6' },
      });
    }
  }

  // Envelope band from first sample with envelopes.
  const envSample = samples.find(s => s.envelope_lo && s.envelope_hi);
  const envelopeP = envSample?.envelope_p;
  if (envSample?.envelope_lo && envSample.envelope_hi) {
    const envLo = mode === 'L'
      ? envSample.envelope_lo.map((kLo, i) =>
          Math.sqrt(Math.max(kLo, 0) / Math.PI) - envSample.r[i])
      : envSample.envelope_lo;
    const envHi = mode === 'L'
      ? envSample.envelope_hi.map((kHi, i) =>
          Math.sqrt(Math.max(kHi, 0) / Math.PI) - envSample.r[i])
      : envSample.envelope_hi;

    traces.push({
      type: 'scatter',
      mode: 'lines',
      name: 'CSR envelope',
      x: [...envSample.r, ...envSample.r.slice().reverse()],
      y: [...envLo, ...envHi.slice().reverse()],
      fill: 'toself',
      fillcolor: 'rgba(148,163,184,0.12)',
      line: { width: 0 },
      hoverinfo: 'skip',
    });
  }

  // Poisson reference (theo).
  if (samples[0]) {
    const theo = samples[0];
    if (mode === 'L') {
      traces.push({
        type: 'scatter', mode: 'lines', name: 'CSR (zero deviation)',
        x: theo.r, y: theo.r.map(() => 0),
        line: { width: 1, dash: 'dot', color: '#94a3b8' },
      });
    } else if (theo.K_theo) {
      traces.push({
        type: 'scatter', mode: 'lines', name: 'CSR (Poisson)',
        x: theo.r, y: theo.K_theo,
        line: { width: 1, dash: 'dot', color: '#94a3b8' },
      });
    }
  }

  const layout: Partial<Layout> = {
    title: { text: title, font: { size: 12, color: '#cbd5e1' } },
    height: 300,
    margin: { l: 50, r: 20, t: 30, b: 40 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(15,23,42,0.4)',
    font: { color: '#94a3b8', size: 10 },
    xaxis: { title: { text: 'r (pixels)' }, gridcolor: '#1e293b' },
    yaxis: { gridcolor: '#1e293b' },
    showlegend: false,
    annotations: [{
      x: 1, y: 1, xref: 'paper', yref: 'paper',
      text: [
        `${isCross ? 'cross' : 'univariate'} · ${samples.length} samples · ${data.correction}`,
        hasEnvelopes ? 'CSR envelopes' : null,
        envelopeP != null && isFinite(envelopeP) ? `perm p=${envelopeP < 0.001 ? '<0.001' : envelopeP.toFixed(3)}` : null,
      ].filter(Boolean).join(' · '),
      showarrow: false, font: { size: 9, color: '#64748b' },
      xanchor: 'right', yanchor: 'top',
    }],
  };

  return <Plot data={traces} layout={layout} style={{ width: '100%' }} config={{ displayModeBar: false }} />;
}

function GPlot({ data, loading, error }: { data: NnGResponse | null; loading: boolean; error: string | null }) {
  if (loading) return <PlotPlaceholder title="Nearest-Neighbour G(r)" status="loading" />;
  if (error)   return <PlotPlaceholder title="Nearest-Neighbour G(r)" status="error" message={error} />;
  if (!data || data.per_sample.length === 0)
    return <PlotPlaceholder title="Nearest-Neighbour G(r)" status="empty" message={data?.analysis_message ?? 'No samples available'} />;

  const samples = data.per_sample.slice(0, 25);
  const hasEnvelopes = samples.some(s => s.envelope_lo && s.envelope_hi);

  const traces: Data[] = samples.map(s => ({
    type: 'scatter',
    mode: 'lines',
    name: s.sample_id,
    x: s.r,
    y: s.G_obs,
    line: { width: 1 },
    opacity: 0.55,
  }));

  const envSample = samples.find(s => s.envelope_lo && s.envelope_hi);
  const envelopeP = envSample?.envelope_p;
  if (envSample?.envelope_lo && envSample.envelope_hi) {
    traces.push({
      type: 'scatter',
      mode: 'lines',
      name: 'CSR envelope',
      x: [...envSample.r, ...envSample.r.slice().reverse()],
      y: [...envSample.envelope_lo, ...envSample.envelope_hi.slice().reverse()],
      fill: 'toself',
      fillcolor: 'rgba(148,163,184,0.12)',
      line: { width: 0 },
      hoverinfo: 'skip',
    });
  }

  if (samples[0]?.G_theo) {
    traces.push({
      type: 'scatter', mode: 'lines', name: 'CSR (Poisson)',
      x: samples[0].r, y: samples[0].G_theo,
      line: { dash: 'dot', color: '#94a3b8', width: 1 },
    });
  }
  if (data.summary?.G_obs_mean) {
    traces.push({
      type: 'scatter', mode: 'lines', name: 'cohort mean',
      x: data.summary.r, y: data.summary.G_obs_mean,
      line: { width: 3, color: '#10b981' },
    });
  }

  const layout: Partial<Layout> = {
    title: { text: 'Nearest-Neighbour G(r)', font: { size: 12, color: '#cbd5e1' } },
    height: 300,
    margin: { l: 50, r: 20, t: 30, b: 40 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(15,23,42,0.4)',
    font: { color: '#94a3b8', size: 10 },
    xaxis: { title: { text: 'r (pixels)' }, gridcolor: '#1e293b' },
    yaxis: { title: { text: 'G(r)' }, gridcolor: '#1e293b', range: [0, 1.05] },
    showlegend: false,
    annotations: [{
      x: 1, y: 1, xref: 'paper', yref: 'paper',
      text: [
        `${samples.length} samples · ${data.correction}`,
        hasEnvelopes ? 'CSR envelopes' : null,
        envelopeP != null && isFinite(envelopeP) ? `perm p=${envelopeP < 0.001 ? '<0.001' : envelopeP.toFixed(3)}` : null,
      ].filter(Boolean).join(' · '),
      showarrow: false, font: { size: 9, color: '#64748b' },
      xanchor: 'right', yanchor: 'top',
    }],
  };

  return <Plot data={traces} layout={layout} style={{ width: '100%' }} config={{ displayModeBar: false }} />;
}

function PlotPlaceholder({ title, status, message }: {
  title: string; status: 'loading' | 'error' | 'empty'; message?: string;
}) {
  return (
    <div className="border border-slate-800 rounded-lg p-4 bg-slate-900/40 min-h-[120px] flex flex-col items-center justify-center text-xs">
      <p className="text-slate-500 font-semibold mb-1">{title}</p>
      {status === 'loading' && (
        <p className="flex items-center gap-1.5 text-slate-500">
          <Loader2 size={12} className="animate-spin" /> computing on backend…
        </p>
      )}
      {status === 'error' && (
        <p className="flex items-center gap-1.5 text-rose-400">
          <AlertCircle size={12} /> {message ?? 'failed'}
        </p>
      )}
      {status === 'empty' && (
        <p className="text-slate-500 text-center max-w-md leading-relaxed">{message ?? 'no data'}</p>
      )}
    </div>
  );
}
