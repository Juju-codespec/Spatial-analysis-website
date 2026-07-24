// Shared linear / logistic model output: plots, estimate table, prediction & frequency tables.

import { useMemo, useState } from 'react';
import Plot from '../../lib/plot';
import type { Data, Layout } from 'plotly.js';
import type {
  FrequencyRow,
  LinearEstimateRow,
  LinearModelRow,
  LinearPrimary,
  LinearResult,
} from '../../api/types';
import clsx from 'clsx';

type PlotType =
  | 'forest'
  | 'coefficients'
  | 'fitted'
  | 'residuals'
  | 'outcome_by_clustering';

type TableTab = 'estimates' | 'predictions' | 'outcome_freq' | 'obs_pred' | 'covariate_freq';

export type LinearModelPayload = Pick<
  LinearResult,
  | 'n'
  | 'formula'
  | 'family'
  | 'outcome_column'
  | 'covariates'
  | 'clustered'
  | 'n_clusters'
  | 'primary'
  | 'estimate_table'
  | 'model_rows'
  | 'outcome_frequency'
  | 'observed_predicted'
  | 'covariate_frequencies'
  | 'r_squared'
  | 'adj_r_squared'
  | 'aic'
>;

interface Props {
  lin: LinearModelPayload;
  sampleFilterNote?: string;
  clusteringLabel?: string;
}

function formatP(p: number): string {
  if (!isFinite(p)) return '—';
  if (p < 0.001) return '< 0.001';
  return p.toFixed(3);
}

export default function LinearModelResults({
  lin,
  sampleFilterNote,
  clusteringLabel = 'Clustering',
}: Props) {
  const logistic = lin.family === 'binomial'
    || lin.family === 'beta_binomial'
    || lin.family === 'beta_binomial_glmmTMB'
    || lin.family === 'beta_binomial_aod'
    || lin.family === 'quasibinomial';
  const estimates = useMemo(() => {
    if (lin.estimate_table?.length) return lin.estimate_table;
    return [] as LinearEstimateRow[];
  }, [lin.estimate_table]);

  const [plotType, setPlotType] = useState<PlotType>('forest');
  const [tableTab, setTableTab] = useState<TableTab>('estimates');

  const modelRows = lin.model_rows ?? [];
  const hasClusteringGroup = modelRows.some(r => r.clustering_group != null && r.clustering_group !== '');

  return (
    <div className="space-y-4">
      {sampleFilterNote && (
        <p className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2">
          {sampleFilterNote}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
        <Metric label="N samples" value={String(lin.n)} />
        <Metric label="Model" value={logistic ? 'Logistic' : 'Linear'} />
        <PrimaryMetric primary={lin.primary} logistic={logistic} />
        {logistic ? (
          <Metric label="AIC" value={lin.aic?.toFixed(1) ?? '—'} />
        ) : (
          <Metric
            label="R²"
            value={lin.r_squared?.toFixed(3) ?? '—'}
            sub={lin.adj_r_squared != null ? `adj ${lin.adj_r_squared.toFixed(3)}` : undefined}
          />
        )}
        {lin.clustered && lin.n_clusters != null && (
          <Metric label="Patient clusters" value={String(lin.n_clusters)} />
        )}
      </div>

      {lin.formula && (
        <p className="text-[10px] text-slate-500 font-mono break-all">
          {lin.formula}
          {lin.clustered && lin.n_clusters
            ? ` · cluster-robust SE (${lin.n_clusters} patients)`
            : ''}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-slate-400">Plot</span>
          <select
            className="input text-xs w-44"
            value={plotType}
            onChange={e => setPlotType(e.target.value as PlotType)}
          >
            <option value="forest">Forest (estimates + CI)</option>
            <option value="coefficients">{logistic ? 'Odds ratios' : 'Coefficients'}</option>
            <option value="fitted">{logistic ? 'Predicted probability' : 'Fitted vs observed'}</option>
            <option value="residuals">Residuals vs fitted</option>
            {hasClusteringGroup && (
              <option value="outcome_by_clustering">Outcome rate by clustering</option>
            )}
          </select>
        </label>
      </div>

      <ModelPlot
        plotType={plotType}
        estimates={estimates}
        rows={modelRows}
        logistic={logistic}
        outcomeColumn={lin.outcome_column}
        clusteringLabel={clusteringLabel}
      />

      <div className="border-t border-slate-800 pt-4 space-y-3">
        <div className="flex flex-wrap gap-1">
          {(
            [
              ['estimates', 'Estimate table'],
              ['predictions', 'Predictions'],
              ['outcome_freq', 'Outcome frequency'],
              ...(logistic && (lin.observed_predicted?.length ?? 0) > 0
                ? [['obs_pred', 'Observed vs predicted'] as const]
                : []),
              ...((lin.covariates?.length ?? 0) > 0
                ? [['covariate_freq', 'Outcome by covariate'] as const]
                : []),
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

        {tableTab === 'estimates' && <EstimateTable rows={estimates} logistic={logistic} />}
        {tableTab === 'predictions' && <PredictionTable rows={modelRows} logistic={logistic} />}
        {tableTab === 'outcome_freq' && (
          <SimpleFrequencyTable rows={lin.outcome_frequency ?? []} cols={['level', 'count']} />
        )}
        {tableTab === 'obs_pred' && (
          <SimpleFrequencyTable
            rows={lin.observed_predicted ?? []}
            cols={['observed', 'predicted', 'count']}
          />
        )}
        {tableTab === 'covariate_freq' && (
          <CovariateFrequencyTables freqs={lin.covariate_frequencies ?? {}} />
        )}
      </div>
    </div>
  );
}

function ModelPlot({
  plotType,
  estimates,
  rows,
  logistic,
  outcomeColumn,
  clusteringLabel,
}: {
  plotType: PlotType;
  estimates: LinearEstimateRow[];
  rows: LinearModelRow[];
  logistic: boolean;
  outcomeColumn: string;
  clusteringLabel: string;
}) {
  const layoutBase: Partial<Layout> = {
    height: 320,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(15,23,42,0.4)',
    font: { color: '#94a3b8', size: 10 },
    margin: { l: 120, r: 24, t: 28, b: 48 },
  };

  if (plotType === 'forest' && estimates.length > 0) {
    const terms = estimates.map(e => e.term).reverse();
    const center = logistic ? estimates.map(e => e.odds_ratio ?? Math.exp(e.estimate)).reverse() : estimates.map(e => e.estimate).reverse();
    const lower = logistic ? estimates.map(e => e.or_lower ?? Math.exp(e.ci_lower)).reverse() : estimates.map(e => e.ci_lower).reverse();
    const upper = logistic ? estimates.map(e => e.or_upper ?? Math.exp(e.ci_upper)).reverse() : estimates.map(e => e.ci_upper).reverse();
    const traces: Data[] = [{
      type: 'scatter',
      mode: 'markers',
      x: center,
      y: terms,
      marker: { color: '#3b82f6', size: 8 },
      error_x: {
        type: 'data',
        array: center.map((c, i) => upper[i] - c),
        arrayminus: center.map((c, i) => c - lower[i]),
        color: '#64748b',
      },
      showlegend: false,
    }];
    if (logistic) {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        x: [1, 1],
        y: [terms[0], terms[terms.length - 1]],
        line: { color: '#475569', dash: 'dot', width: 1 },
        showlegend: false,
      });
    }
    return (
      <Plot
        data={traces}
        layout={{
          ...layoutBase,
          title: { text: logistic ? 'Odds ratios (95% CI)' : 'Estimates (95% CI)', font: { size: 11, color: '#cbd5e1' } },
          xaxis: { title: { text: logistic ? 'OR' : 'Estimate' }, gridcolor: '#1e293b' },
          yaxis: { automargin: true },
        }}
        style={{ width: '100%' }}
        config={{ displayModeBar: false }}
      />
    );
  }

  if (plotType === 'coefficients' && estimates.length > 0) {
    const terms = estimates.map(e => e.term);
    const vals = logistic
      ? estimates.map(e => e.odds_ratio ?? Math.exp(e.estimate))
      : estimates.map(e => e.estimate);
    const colors = vals.map(v => (logistic && v > 1 ? '#3b82f6' : logistic && v < 1 ? '#f97316' : '#94a3b8'));
    return (
      <Plot
        data={[{
          type: 'bar',
          x: terms,
          y: vals,
          marker: { color: colors },
        }]}
        layout={{
          ...layoutBase,
          margin: { l: 48, r: 20, t: 28, b: 80 },
          title: { text: logistic ? 'Odds ratios' : 'Coefficients', font: { size: 11, color: '#cbd5e1' } },
          xaxis: { tickangle: -35 },
          yaxis: { gridcolor: '#1e293b' },
        }}
        style={{ width: '100%' }}
        config={{ displayModeBar: false }}
      />
    );
  }

  if (plotType === 'fitted' && rows.length > 0) {
    if (logistic) {
      return (
        <Plot
          data={[
            {
              type: 'histogram',
              x: rows.map(r => r.predicted_prob ?? 0),
              xbins: { start: 0, end: 1, size: 0.08 },
              marker: { color: '#3b82f6', opacity: 0.75 },
              name: 'Predicted P(outcome)',
            },
          ]}
          layout={{
            ...layoutBase,
            margin: { l: 48, r: 20, t: 28, b: 48 },
            title: { text: `Predicted probability of ${outcomeColumn}`, font: { size: 11, color: '#cbd5e1' } },
            xaxis: { title: { text: 'Predicted probability' }, range: [0, 1] },
            yaxis: { title: { text: 'Count' }, gridcolor: '#1e293b' },
          }}
          style={{ width: '100%' }}
          config={{ displayModeBar: false }}
        />
      );
    }
    return (
      <Plot
        data={[{
          type: 'scatter',
          mode: 'markers',
          x: rows.map(r => r.observed),
          y: rows.map(r => r.fitted),
          marker: { size: 7, color: '#3b82f6', opacity: 0.8 },
        }]}
        layout={{
          ...layoutBase,
          margin: { l: 48, r: 20, t: 28, b: 48 },
          title: { text: 'Observed vs fitted', font: { size: 11, color: '#cbd5e1' } },
          xaxis: { title: { text: `Observed ${outcomeColumn}` } },
          yaxis: { title: { text: 'Fitted' }, gridcolor: '#1e293b' },
        }}
        style={{ width: '100%' }}
        config={{ displayModeBar: false }}
      />
    );
  }

  if (plotType === 'residuals' && rows.length > 0) {
    return (
      <Plot
        data={[{
          type: 'scatter',
          mode: 'markers',
          x: rows.map(r => r.fitted),
          y: rows.map(r => r.residual),
          marker: { size: 7, color: '#8b5cf6', opacity: 0.8 },
        }]}
        layout={{
          ...layoutBase,
          margin: { l: 48, r: 20, t: 28, b: 48 },
          title: { text: 'Residuals vs fitted', font: { size: 11, color: '#cbd5e1' } },
          xaxis: { title: { text: 'Fitted' } },
          yaxis: { title: { text: 'Residual' }, gridcolor: '#1e293b' },
        }}
        style={{ width: '100%' }}
        config={{ displayModeBar: false }}
      />
    );
  }

  if (plotType === 'outcome_by_clustering' && rows.length > 0) {
    const groups = Array.from(new Set(rows.map(r => r.clustering_group).filter(Boolean))) as string[];
    const rates = groups.map(g => {
      const sub = rows.filter(r => r.clustering_group === g);
      const mean = sub.reduce((s, r) => s + r.observed, 0) / sub.length;
      return { group: g, rate: mean, n: sub.length };
    });
    return (
      <Plot
        data={[{
          type: 'bar',
          x: rates.map(r => r.group),
          y: rates.map(r => r.rate),
          text: rates.map(r => `n=${r.n}`),
          textposition: 'auto',
          marker: { color: '#3b82f6' },
        }]}
        layout={{
          ...layoutBase,
          margin: { l: 48, r: 20, t: 28, b: 48 },
          title: { text: `${outcomeColumn} rate by ${clusteringLabel}`, font: { size: 11, color: '#cbd5e1' } },
          yaxis: { title: { text: `Mean ${outcomeColumn}` }, gridcolor: '#1e293b', range: [0, 1.05] },
        }}
        style={{ width: '100%' }}
        config={{ displayModeBar: false }}
      />
    );
  }

  return (
    <p className="text-xs text-slate-500 border border-slate-800 rounded-lg p-4 text-center">
      Not enough data for this plot.
    </p>
  );
}

function EstimateTable({ rows, logistic }: { rows: LinearEstimateRow[]; logistic: boolean }) {
  if (rows.length === 0) {
    return <p className="text-xs text-slate-500">No estimate table returned from the API.</p>;
  }
  return (
    <div className="overflow-x-auto border border-slate-800 rounded-lg">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-800 bg-slate-900/60">
            <th className="px-3 py-2">Term</th>
            <th className="px-3 py-2">{logistic ? 'log-OR' : 'Estimate'}</th>
            {logistic && <th className="px-3 py-2">OR</th>}
            <th className="px-3 py-2">95% CI</th>
            <th className="px-3 py-2">SE</th>
            <th className="px-3 py-2">p</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.term} className="border-b border-slate-800/60 last:border-0">
              <td className="px-3 py-2 font-mono text-slate-300">{row.term}</td>
              <td className="px-3 py-2">{row.estimate.toFixed(4)}</td>
              {logistic && (
                <td className="px-3 py-2">{(row.odds_ratio ?? Math.exp(row.estimate)).toFixed(3)}</td>
              )}
              <td className="px-3 py-2 text-slate-400">
                {logistic
                  ? `${(row.or_lower ?? Math.exp(row.ci_lower)).toFixed(2)}–${(row.or_upper ?? Math.exp(row.ci_upper)).toFixed(2)}`
                  : `${row.ci_lower.toFixed(3)}–${row.ci_upper.toFixed(3)}`}
              </td>
              <td className="px-3 py-2 text-slate-400">{row.se.toFixed(4)}</td>
              <td className={clsx('px-3 py-2', row.p_value < 0.05 ? 'text-emerald-300' : 'text-slate-400')}>
                {formatP(row.p_value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PredictionTable({ rows, logistic }: { rows: LinearModelRow[]; logistic: boolean }) {
  if (rows.length === 0) {
    return <p className="text-xs text-slate-500">No per-sample predictions available.</p>;
  }
  const extraCols = Object.keys(rows[0]).filter(
    k => !['sample_id', 'patient_id', 'observed', 'fitted', 'residual', 'predicted_prob', 'predicted_class', 'clustering_stat', 'clustering_group', 'spatial_cluster_stat'].includes(k),
  );
  return (
    <div className="overflow-x-auto border border-slate-800 rounded-lg max-h-64">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-800 bg-slate-900/60 sticky top-0">
            <th className="px-2 py-1.5">sample_id</th>
            {rows[0].patient_id != null && <th className="px-2 py-1.5">patient_id</th>}
            <th className="px-2 py-1.5">observed</th>
            {logistic && <th className="px-2 py-1.5">P(pred)</th>}
            <th className="px-2 py-1.5">fitted</th>
            <th className="px-2 py-1.5">residual</th>
            {rows[0].clustering_group != null && <th className="px-2 py-1.5">clustering</th>}
            {rows[0].clustering_stat != null && <th className="px-2 py-1.5">stat</th>}
            {rows[0].spatial_cluster_stat != null && <th className="px-2 py-1.5">spatial</th>}
            {extraCols.map(c => (
              <th key={c} className="px-2 py-1.5">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.sample_id}-${i}`} className="border-b border-slate-800/50">
              <td className="px-2 py-1 text-slate-400">{row.sample_id}</td>
              {row.patient_id != null && <td className="px-2 py-1 text-slate-500">{row.patient_id}</td>}
              <td className="px-2 py-1">{row.observed}</td>
              {logistic && (
                <td className="px-2 py-1">{row.predicted_prob?.toFixed(3) ?? '—'}</td>
              )}
              <td className="px-2 py-1">{row.fitted.toFixed(3)}</td>
              <td className="px-2 py-1">{row.residual.toFixed(3)}</td>
              {row.clustering_group != null && (
                <td className="px-2 py-1">{row.clustering_group}</td>
              )}
              {row.clustering_stat != null && (
                <td className="px-2 py-1">{row.clustering_stat.toFixed(3)}</td>
              )}
              {row.spatial_cluster_stat != null && (
                <td className="px-2 py-1">{row.spatial_cluster_stat.toFixed(3)}</td>
              )}
              {extraCols.map(c => (
                <td key={c} className="px-2 py-1 text-slate-400">
                  {typeof row[c] === 'number' ? (row[c] as number).toFixed(2) : String(row[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SimpleFrequencyTable({
  rows,
  cols,
}: {
  rows: FrequencyRow[];
  cols: string[];
}) {
  if (rows.length === 0) {
    return <p className="text-xs text-slate-500">No frequency data.</p>;
  }
  return (
    <div className="overflow-x-auto border border-slate-800 rounded-lg">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-800 bg-slate-900/60">
            {cols.map(c => (
              <th key={c} className="px-3 py-2 capitalize">{c.replace(/_/g, ' ')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-800/60">
              {cols.map(c => (
                <td key={c} className="px-3 py-2 text-slate-300">
                  {String((row as unknown as Record<string, unknown>)[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CovariateFrequencyTables({ freqs }: { freqs: Record<string, FrequencyRow[]> }) {
  const keys = Object.keys(freqs);
  if (keys.length === 0) {
    return <p className="text-xs text-slate-500">No covariate frequency tables.</p>;
  }
  return (
    <div className="space-y-4">
      {keys.map(cov => (
        <div key={cov}>
          <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">{cov}</p>
          <SimpleFrequencyTable rows={freqs[cov]} cols={['covariate_level', 'outcome', 'count']} />
        </div>
      ))}
    </div>
  );
}

function PrimaryMetric({ primary, logistic }: { primary: LinearPrimary; logistic: boolean }) {
  if (logistic) {
    const or = primary.odds_ratio ?? Math.exp(primary.estimate);
    return (
      <Metric
        label="OR (primary)"
        value={or.toFixed(2)}
        sub={
          primary.odds_ratio_lower != null
            ? `95% CI ${primary.odds_ratio_lower.toFixed(2)}–${primary.odds_ratio_upper?.toFixed(2)}`
            : undefined
        }
        accent={primary.p_value < 0.05 ? 'good' : 'neutral'}
      />
    );
  }
  return (
    <Metric
      label="β (primary)"
      value={primary.estimate.toFixed(3)}
      sub={`95% CI ${primary.estimate_lower.toFixed(3)}–${primary.estimate_upper.toFixed(3)}`}
      accent={primary.p_value < 0.05 ? 'good' : 'neutral'}
    />
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
