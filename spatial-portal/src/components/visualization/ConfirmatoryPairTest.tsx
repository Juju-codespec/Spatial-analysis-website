// Confirmatory single-pair test (uncorrected) — used inside screening drill-down.

import { useEffect, useMemo, useState } from 'react';
import {
  useClinicalSummaryTests,
  useClinicalSurvival,
} from '../../hooks/useAnalysis';
import type { ClinicalSummaryTest } from '../../api/types';
import { Loader2, AlertCircle, Download, ChevronUp, ChevronDown as ChevronDownIcon } from 'lucide-react';
import clsx from 'clsx';
import { formatNum, formatRange } from '../../utils/format';
import { downloadCsv } from '../../utils/export';

export interface ConfirmatoryPair {
  markerColumn: string;
  clinicalColumn: string;
}

interface Props {
  datasetId: string;
  level: 'sample' | 'patient';
  markerColumns: string[];
  survivalColumns: string[];
  spatialRequest?: Record<string, unknown>;
  selectedPair: ConfirmatoryPair | null;
  onPairChange?: (pair: ConfirmatoryPair) => void;
  screeningFdr?: number | null;
}

const SURVIVAL_OUTCOME = '__survival__';

const OUTCOME_PREFS: { label: string; columns: string[] }[] = [
  { label: 'Survival', columns: [SURVIVAL_OUTCOME] },
  { label: 'Stage', columns: ['stage'] },
  { label: 'Grade', columns: ['grade'] },
  { label: 'BRCA', columns: ['brca', 'brca_status'] },
  { label: 'Recurrence', columns: ['recurrence'] },
];

export function markerLabel(col: string): string {
  if (col === 'spatial_cluster_stat') return "Ripley's K / spatial clustering";
  return col
    .replace(/^count_/, 'count ')
    .replace(/^pct_/, '% ')
    .replace(/^ratio_/, 'ratio ')
    .replace(/_/g, ' ');
}

function clinicalOutcomeLabel(col: string): string {
  if (col === SURVIVAL_OUTCOME || col === '__survival__') return 'Survival';
  return col.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

function formatP(p: number | undefined): string {
  if (p == null || !isFinite(p)) return '—';
  if (p < 0.001) return '< 0.001';
  return p.toFixed(3);
}

function defaultMarker(columns: string[]): string {
  const preferred = columns.find(c => /cd8/i.test(c) && c.startsWith('pct_'));
  if (preferred) return preferred;
  const pct = columns.find(c => c.startsWith('pct_'));
  if (pct) return pct;
  const spatial = columns.find(c => c === 'spatial_cluster_stat');
  if (spatial) return spatial;
  return columns[0] ?? '';
}

function buildOutcomeOptions(
  survivalColumns: string[],
  hasTimeStatus: boolean,
): { value: string; label: string }[] {
  const clinical = survivalColumns.filter(
    c => !['sample_id', 'patient_id', 'time', 'status'].includes(c),
  );
  const used = new Set<string>();
  const options: { value: string; label: string }[] = [];

  for (const pref of OUTCOME_PREFS) {
    if (pref.columns[0] === SURVIVAL_OUTCOME) {
      if (hasTimeStatus) options.push({ value: SURVIVAL_OUTCOME, label: 'Survival' });
      continue;
    }
    const col = pref.columns.find(c => clinical.includes(c));
    if (col && !used.has(col)) {
      used.add(col);
      options.push({ value: col, label: pref.label });
    }
  }

  for (const col of clinical) {
    if (!used.has(col)) {
      options.push({ value: col, label: clinicalOutcomeLabel(col) });
    }
  }

  return options;
}

export default function ConfirmatoryPairTest({
  datasetId,
  level,
  markerColumns,
  survivalColumns,
  spatialRequest = {},
  selectedPair,
  onPairChange,
  screeningFdr,
}: Props) {
  const hasTimeStatus =
    survivalColumns.includes('time') && survivalColumns.includes('status');

  const markerOptions = useMemo(
    () => markerColumns.map(c => ({ value: c, label: markerLabel(c) })),
    [markerColumns],
  );

  const outcomeOptions = useMemo(
    () => buildOutcomeOptions(survivalColumns, hasTimeStatus),
    [survivalColumns, hasTimeStatus],
  );

  const [markerColumn, setMarkerColumn] = useState('');
  const [outcomeColumn, setOutcomeColumn] = useState('');
  const [comparedMarkers, setComparedMarkers] = useState<string[]>([]);

  useEffect(() => {
    if (markerColumns.length === 0) return;
    setComparedMarkers(prev => {
      const valid = prev.filter(m => markerColumns.includes(m));
      if (valid.length > 0) return valid;
      const pct = markerColumns.filter(c => c.startsWith('pct_'));
      const spatial = markerColumns.filter(c => c === 'spatial_cluster_stat');
      const rest = markerColumns.filter(c => !c.startsWith('pct_') && c !== 'spatial_cluster_stat');
      return [...pct, ...spatial, ...rest].slice(0, 6);
    });
  }, [markerColumns]);

  useEffect(() => {
    if (markerColumns.length && !markerColumns.includes(markerColumn)) {
      setMarkerColumn(defaultMarker(markerColumns));
    }
  }, [markerColumns, markerColumn]);

  useEffect(() => {
    if (outcomeOptions.length && !outcomeOptions.some(o => o.value === outcomeColumn)) {
      setOutcomeColumn(outcomeOptions[0].value);
    }
  }, [outcomeOptions, outcomeColumn]);

  useEffect(() => {
    if (!selectedPair) return;
    if (markerColumns.includes(selectedPair.markerColumn)) {
      setMarkerColumn(selectedPair.markerColumn);
    }
    const outcome =
      selectedPair.clinicalColumn === '__survival__' && hasTimeStatus
        ? SURVIVAL_OUTCOME
        : selectedPair.clinicalColumn;
    if (outcomeOptions.some(o => o.value === outcome)) {
      setOutcomeColumn(outcome);
    }
  }, [selectedPair, markerColumns, outcomeOptions, hasTimeStatus]);

  const updateMarker = (col: string) => {
    setMarkerColumn(col);
    if (outcomeColumn) {
      onPairChange?.({
        markerColumn: col,
        clinicalColumn:
          outcomeColumn === SURVIVAL_OUTCOME ? '__survival__' : outcomeColumn,
      });
    }
  };

  const updateOutcome = (col: string) => {
    setOutcomeColumn(col);
    if (markerColumn) {
      onPairChange?.({
        markerColumn,
        clinicalColumn: col === SURVIVAL_OUTCOME ? '__survival__' : col,
      });
    }
  };

  const isSurvivalOutcome = outcomeColumn === SURVIVAL_OUTCOME;

  const pairReq = useMemo(() => {
    if (!markerColumn || !outcomeColumn || isSurvivalOutcome) return null;
    return {
      datasetId,
      level,
      pairs: [{ markerColumn, clinicalColumn: outcomeColumn }],
      ...spatialRequest,
    };
  }, [datasetId, level, markerColumn, outcomeColumn, isSurvivalOutcome, spatialRequest]);

  const survivalReq = useMemo(() => {
    if (!markerColumn || !isSurvivalOutcome || !hasTimeStatus) return null;
    return {
      datasetId,
      level,
      featureColumn: markerColumn,
      covariates: [] as string[],
      dichotomize: 'none' as const,
      clusterPatients: true,
      ...spatialRequest,
    };
  }, [datasetId, level, markerColumn, isSurvivalOutcome, hasTimeStatus, spatialRequest]);

  const pairQuery = useClinicalSummaryTests(pairReq);
  const survivalQuery = useClinicalSurvival(survivalReq);

  const loading = isSurvivalOutcome ? survivalQuery.loading : pairQuery.loading;
  const error = isSurvivalOutcome ? survivalQuery.error : pairQuery.error;
  const pairResult = pairQuery.data?.tests?.[0];
  const survivalResult = survivalQuery.data?.survival.cox;

  if (markerColumns.length === 0 || outcomeOptions.length === 0) return null;

  return (
    <div className="mt-4 border-t border-slate-800 pt-4 space-y-4">
      <div>
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-medium">
          Confirmatory test
        </p>
        <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
          One pre-specified marker × outcome pair — uncorrected effect size, confidence
          interval, and p-value. Click a heatmap cell or ranked row to pre-fill.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-[11px] font-medium text-slate-400 block mb-1">Marker</span>
          <select
            className="input text-xs w-full"
            value={markerColumn}
            onChange={e => updateMarker(e.target.value)}
          >
            {markerOptions.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-slate-400 block mb-1">Outcome</span>
          <select
            className="input text-xs w-full"
            value={outcomeColumn}
            onChange={e => updateOutcome(e.target.value)}
          >
            {outcomeOptions.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      {screeningFdr != null && isFinite(screeningFdr) && (
        <p className="text-[10px] text-slate-600">
          Screening FDR for this pair:{' '}
          <span className="text-slate-400 tabular-nums">{formatP(screeningFdr)}</span>
          {' · '}confirmatory p-value below is uncorrected.
        </p>
      )}

      {loading && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-brand-400 shrink-0" />
          <p className="text-xs text-slate-400">Running confirmatory model…</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-800/50 bg-rose-950/30 p-4 flex gap-3">
          <AlertCircle size={18} className="shrink-0 text-rose-400 mt-0.5" />
          <p className="text-xs text-rose-200/90 leading-relaxed">{error}</p>
        </div>
      )}

      {!loading && !error && isSurvivalOutcome && survivalResult && (
        <ConfirmatoryResults
          method="Cox proportional hazards"
          markerLabel={markerLabel(markerColumn)}
          outcomeLabel="Survival"
          n={survivalResult.n}
          nEvents={survivalResult.n_events}
          effectLabel="Hazard ratio"
          effectValue={formatNum(survivalResult.primary.hr, 2)}
          ciLabel="95% CI"
          ciValue={formatRange(
            survivalResult.primary.hr_lower,
            survivalResult.primary.hr_upper,
            2,
          )}
          pValue={survivalResult.primary.p_value}
          summary={survivalResult.formula}
        />
      )}

      {!loading && !error && !isSurvivalOutcome && pairResult && (
        <PairTestResults
          result={pairResult}
          markerLabel={markerLabel(markerColumn)}
          outcomeLabel={
            outcomeOptions.find(o => o.value === outcomeColumn)?.label ?? outcomeColumn
          }
        />
      )}

      {outcomeColumn && markerColumns.length > 1 && (
        <MultiMarkerComparisonTable
          datasetId={datasetId}
          level={level}
          allMarkers={markerColumns}
          comparedMarkers={comparedMarkers}
          onMarkersChange={setComparedMarkers}
          outcomeColumn={outcomeColumn}
          outcomeLabel={outcomeOptions.find(o => o.value === outcomeColumn)?.label ?? outcomeColumn}
          isSurvivalOutcome={isSurvivalOutcome}
          hasTimeStatus={hasTimeStatus}
          spatialRequest={spatialRequest}
        />
      )}
    </div>
  );
}

function PairTestResults({
  result,
  markerLabel: mLabel,
  outcomeLabel,
}: {
  result: ClinicalSummaryTest;
  markerLabel: string;
  outcomeLabel: string;
}) {
  if (result.error) {
    return (
      <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-4 flex gap-3">
        <AlertCircle size={18} className="shrink-0 text-amber-400 mt-0.5" />
        <p className="text-xs text-amber-200/90 leading-relaxed">{result.error}</p>
      </div>
    );
  }

  const metric = result.effect_metric ?? '';
  let effectLabel = 'Effect size';
  let effectValue = result.effect_summary ?? formatNum(result.effect_size, 3);
  let ciLabel: string | undefined;
  let ciValue: string | undefined;

  if (metric === 'log_hr' || result.hr != null) {
    effectLabel = 'Hazard ratio';
    effectValue = formatNum(result.hr ?? Math.exp(result.effect_size ?? NaN), 2);
    if (result.hr_lower != null && result.hr_upper != null) {
      ciLabel = '95% CI';
      ciValue = formatRange(result.hr_lower, result.hr_upper, 2);
    }
  } else if (metric === 'rho') {
    effectLabel = 'Spearman ρ';
    effectValue = formatNum(result.effect_size, 3);
  } else if (metric === 'rank_biserial') {
    effectLabel = 'Rank-biserial r';
    effectValue = formatNum(result.effect_size, 3);
  } else if (metric === 'log_odds') {
    effectLabel = 'Log-odds';
    effectValue = formatNum(result.effect_size, 3);
  } else if (metric === 'eta_squared') {
    effectLabel = 'η²';
    effectValue = formatNum(result.effect_size, 3);
  } else if (result.effect_size != null) {
    effectValue = formatNum(result.effect_size, 3);
  }

  return (
    <ConfirmatoryResults
      method={result.method ?? 'Statistical test'}
      markerLabel={mLabel}
      outcomeLabel={outcomeLabel}
      n={result.n}
      effectLabel={effectLabel}
      effectValue={effectValue}
      ciLabel={ciLabel}
      ciValue={ciValue}
      pValue={result.p_value}
      summary={result.effect_summary}
    />
  );
}

function ConfirmatoryResults({
  method,
  markerLabel: mLabel,
  outcomeLabel,
  n,
  nEvents,
  effectLabel,
  effectValue,
  ciLabel,
  ciValue,
  pValue,
  summary,
}: {
  method: string;
  markerLabel: string;
  outcomeLabel: string;
  n?: number;
  nEvents?: number;
  effectLabel: string;
  effectValue: string;
  ciLabel?: string;
  ciValue?: string;
  pValue?: number;
  summary?: string;
}) {
  const significant = pValue != null && isFinite(pValue) && pValue < 0.05;

  return (
    <div className="rounded-lg border border-brand-900/40 bg-brand-950/10 overflow-hidden">
      <div className="px-4 py-2 border-b border-slate-800/80 bg-slate-900/50">
        <p className="text-[10px] uppercase tracking-widest text-brand-300/80 font-medium">
          {mLabel} → {outcomeLabel}
        </p>
        <p className="text-[10px] text-slate-600 mt-0.5">{method}</p>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <ResultMetric label={effectLabel} value={effectValue} highlight={significant} />
          {ciLabel && ciValue && <ResultMetric label={ciLabel} value={ciValue} />}
          <ResultMetric
            label="p-value"
            value={formatP(pValue)}
            accent={significant ? 'good' : 'neutral'}
            highlight={significant}
          />
          <ResultMetric label="n" value={String(n ?? '—')} />
          {nEvents != null && <ResultMetric label="Events" value={String(nEvents)} />}
        </div>
        {summary && (
          <p className="text-[10px] text-slate-600 mt-3 font-mono break-all">{summary}</p>
        )}
        <p className="text-[10px] text-slate-600 mt-2">
          Uncorrected p-value — no FDR or family-wise adjustment.
        </p>
      </div>
    </div>
  );
}

function ResultMetric({
  label,
  value,
  sub,
  accent,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'good' | 'neutral';
  highlight?: boolean;
}) {
  return (
    <div
      className={clsx(
        'rounded-lg px-3 py-2.5 border',
        highlight
          ? 'bg-emerald-950/25 border-emerald-800/40'
          : 'bg-slate-900/60 border-slate-800',
      )}
    >
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">{label}</p>
      <p
        className={clsx(
          'text-lg font-semibold tabular-nums mt-0.5',
          accent === 'good' ? 'text-emerald-300' : 'text-slate-100',
        )}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Multi-marker comparison table ───────────────────────────────────────────

type SortKey = 'marker' | 'effect' | 'p_value' | 'n';
type SortDir = 'asc' | 'desc';

interface CompareRow {
  markerColumn: string;
  markerLabel: string;
  effectLabel: string;
  effectValue: string;
  ciValue?: string;
  pValue?: number;
  n?: number;
  nEvents?: number;
  error?: string;
  loading: boolean;
}

function MultiMarkerComparisonTable({
  datasetId,
  level,
  allMarkers,
  comparedMarkers,
  onMarkersChange,
  outcomeColumn,
  outcomeLabel,
  isSurvivalOutcome,
  hasTimeStatus,
  spatialRequest,
}: {
  datasetId: string;
  level: 'sample' | 'patient';
  allMarkers: string[];
  comparedMarkers: string[];
  onMarkersChange: (markers: string[]) => void;
  outcomeColumn: string;
  outcomeLabel: string;
  isSurvivalOutcome: boolean;
  hasTimeStatus: boolean;
  spatialRequest: Record<string, unknown>;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('p_value');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const toggleMarker = (m: string) => {
    onMarkersChange(
      comparedMarkers.includes(m)
        ? comparedMarkers.filter(c => c !== m)
        : [...comparedMarkers, m],
    );
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <span className="ml-1 text-slate-700">↕</span>;
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="inline ml-1 text-slate-400" />
      : <ChevronDownIcon size={11} className="inline ml-1 text-slate-400" />;
  };

  return (
    <div className="mt-4 border-t border-slate-800 pt-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-medium">
            Multi-marker comparison
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
            Compare markers against <span className="text-slate-400">{outcomeLabel}</span>. Toggle markers below.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {allMarkers.map(m => (
          <button
            key={m}
            type="button"
            onClick={() => toggleMarker(m)}
            className={clsx(
              'px-2.5 py-1 rounded-md border text-[11px] transition-colors',
              comparedMarkers.includes(m)
                ? 'bg-brand-900/40 border-brand-700/60 text-brand-200'
                : 'border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600',
            )}
          >
            {markerLabel(m)}
          </button>
        ))}
      </div>

      {comparedMarkers.length > 0 && (
        isSurvivalOutcome && hasTimeStatus
          ? (
            <SurvivalComparisonTable
              datasetId={datasetId}
              level={level}
              markers={comparedMarkers}
              spatialRequest={spatialRequest}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              SortIcon={SortIcon}
            />
          )
          : (
            <NonSurvivalComparisonTable
              datasetId={datasetId}
              level={level}
              markers={comparedMarkers}
              outcomeColumn={outcomeColumn}
              spatialRequest={spatialRequest}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              SortIcon={SortIcon}
            />
          )
      )}
    </div>
  );
}

function SurvivalComparisonTable({
  datasetId,
  level,
  markers,
  spatialRequest,
  sortKey,
  sortDir,
  onSort,
  SortIcon,
}: {
  datasetId: string;
  level: 'sample' | 'patient';
  markers: string[];
  spatialRequest: Record<string, unknown>;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  SortIcon: React.ComponentType<{ k: SortKey }>;
}) {
  const [rows, setRows] = useState<Record<string, CompareRow>>({});

  const updateRow = (m: string, row: Partial<CompareRow>) => {
    setRows(prev => ({ ...prev, [m]: { ...prev[m], markerColumn: m, markerLabel: markerLabel(m), ...row } as CompareRow }));
  };

  const sortedMarkers = useMemo(() => {
    return [...markers].sort((a, b) => {
      const ra = rows[a];
      const rb = rows[b];
      if (!ra || !rb) return 0;
      let va: number | string = 0;
      let vb: number | string = 0;
      if (sortKey === 'marker') { va = ra.markerLabel; vb = rb.markerLabel; }
      else if (sortKey === 'effect') { va = parseFloat(ra.effectValue) || 0; vb = parseFloat(rb.effectValue) || 0; }
      else if (sortKey === 'p_value') { va = ra.pValue ?? 999; vb = rb.pValue ?? 999; }
      else if (sortKey === 'n') { va = ra.n ?? 0; vb = rb.n ?? 0; }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [markers, rows, sortKey, sortDir]);

  const exportRows = markers.map(m => {
    const r = rows[m];
    return {
      marker: markerLabel(m),
      outcome: 'Survival',
      hazard_ratio: r?.effectValue ?? '',
      ci_95: r?.ciValue ?? '',
      p_value: r?.pValue ?? '',
      n: r?.n ?? '',
      n_events: r?.nEvents ?? '',
    };
  });

  return (
    <div className="rounded-lg border border-slate-800 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-800/80 bg-slate-900/50 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest text-slate-500">Hazard ratios — survival</p>
        <button
          type="button"
          onClick={() => downloadCsv(exportRows, 'multi-marker-survival.csv')}
          className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300"
        >
          <Download size={11} /> CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left border-b border-slate-800 bg-slate-900/60">
              <th className="px-3 py-2 text-slate-500 font-medium cursor-pointer whitespace-nowrap" onClick={() => onSort('marker')}>
                Marker <SortIcon k="marker" />
              </th>
              <th className="px-3 py-2 text-slate-500 font-medium cursor-pointer whitespace-nowrap" onClick={() => onSort('effect')}>
                HR <SortIcon k="effect" />
              </th>
              <th className="px-3 py-2 text-slate-500 font-medium whitespace-nowrap">95% CI</th>
              <th className="px-3 py-2 text-slate-500 font-medium cursor-pointer whitespace-nowrap" onClick={() => onSort('p_value')}>
                p-value <SortIcon k="p_value" />
              </th>
              <th className="px-3 py-2 text-slate-500 font-medium cursor-pointer whitespace-nowrap" onClick={() => onSort('n')}>
                n <SortIcon k="n" />
              </th>
              <th className="px-3 py-2 text-slate-500 font-medium whitespace-nowrap">Events</th>
            </tr>
          </thead>
          <tbody>
            {sortedMarkers.map(m => (
              <SurvivalMarkerRow
                key={m}
                datasetId={datasetId}
                level={level}
                markerColumn={m}
                spatialRequest={spatialRequest}
                onResult={row => updateRow(m, row)}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-600 px-3 py-2 border-t border-slate-800/60">
        Uncorrected p-values — univariate Cox per marker, continuous feature.
      </p>
    </div>
  );
}

function SurvivalMarkerRow({
  datasetId,
  level,
  markerColumn: mc,
  spatialRequest,
  onResult,
}: {
  datasetId: string;
  level: 'sample' | 'patient';
  markerColumn: string;
  spatialRequest: Record<string, unknown>;
  onResult: (row: Partial<CompareRow>) => void;
}) {
  const req = useMemo(() => ({
    datasetId,
    level,
    featureColumn: mc,
    covariates: [] as string[],
    dichotomize: 'none' as const,
    clusterPatients: true,
    ...spatialRequest,
  }), [datasetId, level, mc, spatialRequest]);

  const { data, loading, error } = useClinicalSurvival(req);

  useEffect(() => {
    if (loading) { onResult({ loading: true }); return; }
    if (error) { onResult({ loading: false, error }); return; }
    if (!data) return;
    const cox = data.survival.cox;
    onResult({
      loading: false,
      effectLabel: 'HR',
      effectValue: formatNum(cox.primary.hr, 2),
      ciValue: formatRange(cox.primary.hr_lower, cox.primary.hr_upper, 2),
      pValue: cox.primary.p_value,
      n: cox.n,
      nEvents: cox.n_events,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loading, error]);

  const cox = data?.survival.cox;
  const sig = cox != null && cox.primary.p_value < 0.05;

  return (
    <tr className="border-b border-slate-800/40 hover:bg-slate-900/30 transition-colors">
      <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{markerLabel(mc)}</td>
      {loading ? (
        <td colSpan={5} className="px-3 py-2">
          <Loader2 size={12} className="animate-spin text-slate-500 inline" />
        </td>
      ) : error ? (
        <td colSpan={5} className="px-3 py-2 text-rose-400/80 text-[11px]">{error}</td>
      ) : cox ? (
        <>
          <td className={clsx('px-3 py-2 tabular-nums font-medium', sig ? 'text-emerald-300' : 'text-slate-200')}>
            {formatNum(cox.primary.hr, 2)}
          </td>
          <td className="px-3 py-2 text-slate-400 tabular-nums whitespace-nowrap">
            {formatRange(cox.primary.hr_lower, cox.primary.hr_upper, 2)}
          </td>
          <td className={clsx('px-3 py-2 tabular-nums', sig ? 'text-emerald-300 font-medium' : 'text-slate-400')}>
            {formatP(cox.primary.p_value)}
          </td>
          <td className="px-3 py-2 text-slate-400 tabular-nums">{cox.n}</td>
          <td className="px-3 py-2 text-slate-400 tabular-nums">{cox.n_events}</td>
        </>
      ) : (
        <td colSpan={5} className="px-3 py-2 text-slate-600">—</td>
      )}
    </tr>
  );
}

function NonSurvivalComparisonTable({
  datasetId,
  level,
  markers,
  outcomeColumn,
  spatialRequest,
  sortKey,
  sortDir,
  onSort,
  SortIcon,
}: {
  datasetId: string;
  level: 'sample' | 'patient';
  markers: string[];
  outcomeColumn: string;
  spatialRequest: Record<string, unknown>;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  SortIcon: React.ComponentType<{ k: SortKey }>;
}) {
  const req = useMemo(() => ({
    datasetId,
    level,
    pairs: markers.map(m => ({ markerColumn: m, clinicalColumn: outcomeColumn })),
    ...spatialRequest,
  }), [datasetId, level, markers, outcomeColumn, spatialRequest]);

  const { data, loading, error } = useClinicalSummaryTests(req);

  const rows: CompareRow[] = useMemo(() => {
    if (!data?.tests) return markers.map(m => ({ markerColumn: m, markerLabel: markerLabel(m), effectLabel: '—', effectValue: '—', loading: false }));
    return markers.map(m => {
      const t = data.tests.find(tt => tt.marker_column === m);
      if (!t) return { markerColumn: m, markerLabel: markerLabel(m), effectLabel: '—', effectValue: '—', loading: false };
      if (t.error) return { markerColumn: m, markerLabel: markerLabel(m), effectLabel: '—', effectValue: '—', loading: false, error: t.error };

      const metric = t.effect_metric ?? '';
      let effectLabel = 'Effect';
      let effectValue = t.effect_summary ?? formatNum(t.effect_size, 3);
      let ciValue: string | undefined;

      if (metric === 'log_hr' || t.hr != null) {
        effectLabel = 'HR';
        effectValue = formatNum(t.hr ?? Math.exp(t.effect_size ?? NaN), 2);
        if (t.hr_lower != null && t.hr_upper != null) {
          ciValue = formatRange(t.hr_lower, t.hr_upper, 2);
        }
      } else if (metric === 'rho') { effectLabel = 'ρ'; effectValue = formatNum(t.effect_size, 3); }
      else if (metric === 'rank_biserial') { effectLabel = 'r'; effectValue = formatNum(t.effect_size, 3); }
      else if (metric === 'log_odds') { effectLabel = 'Log-odds'; effectValue = formatNum(t.effect_size, 3); }
      else if (metric === 'eta_squared') { effectLabel = 'η²'; effectValue = formatNum(t.effect_size, 3); }

      return {
        markerColumn: m,
        markerLabel: markerLabel(m),
        effectLabel,
        effectValue,
        ciValue,
        pValue: t.p_value,
        n: t.n,
        loading: false,
      };
    });
  }, [data, markers]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;
      if (sortKey === 'marker') { va = a.markerLabel; vb = b.markerLabel; }
      else if (sortKey === 'effect') { va = parseFloat(a.effectValue) || 0; vb = parseFloat(b.effectValue) || 0; }
      else if (sortKey === 'p_value') { va = a.pValue ?? 999; vb = b.pValue ?? 999; }
      else if (sortKey === 'n') { va = a.n ?? 0; vb = b.n ?? 0; }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [rows, sortKey, sortDir]);

  const effectColLabel = rows[0]?.effectLabel ?? 'Effect';
  const showCI = rows.some(r => r.ciValue);

  const exportRows = rows.map(r => ({
    marker: r.markerLabel,
    outcome: outcomeColumn,
    effect: r.effectValue,
    ci_95: r.ciValue ?? '',
    p_value: r.pValue ?? '',
    n: r.n ?? '',
    error: r.error ?? '',
  }));

  return (
    <div className="rounded-lg border border-slate-800 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-800/80 bg-slate-900/50 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest text-slate-500">Effect sizes — {outcomeColumn.replace(/_/g, ' ')}</p>
        <button
          type="button"
          onClick={() => downloadCsv(exportRows, `multi-marker-${outcomeColumn}.csv`)}
          className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300"
        >
          <Download size={11} /> CSV
        </button>
      </div>
      {loading && (
        <div className="flex items-center gap-2 px-4 py-3">
          <Loader2 size={14} className="animate-spin text-brand-400" />
          <p className="text-xs text-slate-400">Running tests…</p>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3">
          <AlertCircle size={14} className="text-rose-400 shrink-0" />
          <p className="text-xs text-rose-200/90">{error}</p>
        </div>
      )}
      {!loading && !error && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-slate-800 bg-slate-900/60">
                <th className="px-3 py-2 text-slate-500 font-medium cursor-pointer whitespace-nowrap" onClick={() => onSort('marker')}>
                  Marker <SortIcon k="marker" />
                </th>
                <th className="px-3 py-2 text-slate-500 font-medium cursor-pointer whitespace-nowrap" onClick={() => onSort('effect')}>
                  {effectColLabel} <SortIcon k="effect" />
                </th>
                {showCI && <th className="px-3 py-2 text-slate-500 font-medium whitespace-nowrap">95% CI</th>}
                <th className="px-3 py-2 text-slate-500 font-medium cursor-pointer whitespace-nowrap" onClick={() => onSort('p_value')}>
                  p-value <SortIcon k="p_value" />
                </th>
                <th className="px-3 py-2 text-slate-500 font-medium cursor-pointer whitespace-nowrap" onClick={() => onSort('n')}>
                  n <SortIcon k="n" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(r => {
                const sig = r.pValue != null && r.pValue < 0.05;
                return (
                  <tr key={r.markerColumn} className="border-b border-slate-800/40 hover:bg-slate-900/30 transition-colors">
                    <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{r.markerLabel}</td>
                    {r.error ? (
                      <td colSpan={showCI ? 4 : 3} className="px-3 py-2 text-amber-400/80 text-[11px]">{r.error}</td>
                    ) : (
                      <>
                        <td className={clsx('px-3 py-2 tabular-nums font-medium', sig ? 'text-emerald-300' : 'text-slate-200')}>
                          {r.effectValue}
                        </td>
                        {showCI && (
                          <td className="px-3 py-2 text-slate-400 tabular-nums whitespace-nowrap">{r.ciValue ?? '—'}</td>
                        )}
                        <td className={clsx('px-3 py-2 tabular-nums', sig ? 'text-emerald-300 font-medium' : 'text-slate-400')}>
                          {formatP(r.pValue)}
                        </td>
                        <td className="px-3 py-2 text-slate-400 tabular-nums">{r.n ?? '—'}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-slate-600 px-3 py-2 border-t border-slate-800/60">
        Uncorrected p-values — no FDR or family-wise correction.
      </p>
    </div>
  );
}
