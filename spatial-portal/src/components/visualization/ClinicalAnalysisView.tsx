// Clinical Analysis merges user-uploaded clinical metadata with
// image-derived cell features (counts, percentages, ratios).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Plot from '../../lib/plot';
import type { Data, Layout } from 'plotly.js';
import {
  useClinicalFeatures,
  useClinicalLinear,
  useClinicalBetaBinomial,
  useClinicalSurvival,
  useClinicalWilcoxon,
  useClinicalSummary,
  useIdOverlap,
} from '../../hooks/useAnalysis';
import { ApiError, uploadSurvival, type ClinicalSpatialQuery } from '../../api/client';
import type { ClinicalFeaturesResponse, CoxKM, WilcoxonResponse, IdOverlapResponse } from '../../api/types';
import ClinicalSummaryPlot, { type SummaryPairFocus } from './ClinicalSummaryPlot';
import ClinicalAssociationMatrix from './ClinicalAssociationMatrix';
import LinearModelResults from './LinearModelResults';
import {
  Loader2,
  AlertCircle,
  Upload,
  CheckCircle2,
  Stethoscope,
  GitCompare,
  LineChart,
  HeartPulse,
  ChevronDown,
  Table2,
  Sparkles,
  FileSpreadsheet,
  Info,
  Download,
  FlaskConical,
} from 'lucide-react';
import clsx from 'clsx';
import { formatNum, formatRange } from '../../utils/format';
import { downloadCsv } from '../../utils/export';

interface Props {
  datasetId: string;
  availableCellTypes: string[];
  hasSurvival: boolean;
  survivalColumns: string[];
  apiDetailLoaded?: boolean;
  onSurvivalAttached?: () => void;
}

type AnalysisTab = 'compare' | 'regression' | 'survival';

const DEFAULT_T_CELL = 'CD8+ T Cell';
const ID_COLUMNS = new Set(['sample_id', 'patient_id', 'time', 'status']);
const PREFERRED_GROUPS = ['stage', 'treatment', 'arm', 'status', 'recurrence', 'brca_status', 'brca'];
const PREFERRED_COVARIATES = ['age', 'race', 'sex', 'gender', 'stage', 'grade', 'treatment', 'arm', 'status'];

const TAB_CONFIG: { id: AnalysisTab; label: string; icon: typeof GitCompare; hint: string }[] = [
  { id: 'compare', label: 'Group comparison', icon: GitCompare, hint: 'Wilcoxon rank-sum' },
  { id: 'regression', label: 'Regression', icon: LineChart, hint: 'Linear / logistic' },
  { id: 'survival', label: 'Survival', icon: HeartPulse, hint: 'Cox & Kaplan–Meier' },
];

function pickDefaultCellType(available: string[]): string {
  if (available.length === 0) return DEFAULT_T_CELL;
  const preferred = ['CD8+ T Cell', 'CD4+ T Cell', 'T Cell'];
  return available.find(ct => preferred.includes(ct)) ?? available[0];
}

function defaultFeature(columns: string[]): string {
  const pct = columns.find(c => c.startsWith('pct_'));
  if (pct) return pct;
  const ratio = columns.find(c => c.startsWith('ratio_'));
  if (ratio) return ratio;
  return columns[0] ?? '';
}

function defaultGroup(columns: string[]): string {
  for (const g of PREFERRED_GROUPS) {
    if (columns.includes(g)) return g;
  }
  return columns.find(c => !ID_COLUMNS.has(c) && c !== 'time') ?? 'arm';
}

function formatP(p: number): string {
  if (!isFinite(p)) return '—';
  if (p < 0.001) return '< 0.001';
  return p.toFixed(3);
}

function featureLabel(col: string): string {
  if (col === 'spatial_cluster_stat') return 'Spatial clustering stat';
  return col
    .replace(/^count_/, 'count ')
    .replace(/^pct_/, '% ')
    .replace(/^ratio_/, 'ratio ')
    .replace(/_/g, ' ');
}

function buildSpatialQuery(spatial: SpatialState): ClinicalSpatialQuery | null {
  if (!spatial.enabled) return null;
  return {
    includeSpatialCluster: true,
    statistic: spatial.statistic,
    typeA: spatial.typeA,
    typeB: spatial.typeB || null,
    radius: spatial.radius,
    minFocalCells: spatial.minFocalCells,
    windowType: 'convex',
  };
}

function featureOptions(columns: string[]): { value: string; label: string }[] {
  return columns.map(c => ({
    value: c,
    label: c === 'spatial_cluster_stat' ? 'Spatial clustering (K/G summary)' : featureLabel(c),
  }));
}

export default function ClinicalAnalysisView({
  datasetId,
  availableCellTypes,
  hasSurvival,
  survivalColumns,
  apiDetailLoaded = false,
  onSurvivalAttached,
}: Props) {
  const [level, setLevel] = useState<'sample' | 'patient'>('sample');
  const [activeTab, setActiveTab] = useState<AnalysisTab>('compare');
  const [spatial, setSpatial] = useState({
    enabled: false,
    statistic: 'K' as 'K' | 'G',
    typeA: pickDefaultCellType(availableCellTypes),
    typeB: '' as string,
    radius: 50,
    minFocalCells: 10,
  });

  const spatialQuery = useMemo(() => buildSpatialQuery(spatial), [spatial]);
  const overlapQuery = useIdOverlap(hasSurvival ? datasetId : null, hasSurvival);
  const [summaryFocusPair, setSummaryFocusPair] = useState<SummaryPairFocus | null>(null);
  const summarySectionRef = useRef<HTMLElement>(null);

  const featuresQuery = useClinicalFeatures(hasSurvival ? datasetId : null, level, spatialQuery);
  const summaryQuery = useClinicalSummary(hasSurvival ? datasetId : null, level, spatialQuery);
  const featureColumns = featuresQuery.data?.feature_columns ?? [];
  const clinicalRows = summaryQuery.data?.rows ?? [];
  const cellTypes = featuresQuery.data?.cell_types ?? availableCellTypes;

  useEffect(() => {
    setSpatial(s => ({
      ...s,
      typeA: cellTypes.includes(s.typeA) ? s.typeA : pickDefaultCellType(cellTypes),
    }));
  }, [cellTypes]);

  const handleScreeningPairSelect = useCallback((pair: SummaryPairFocus) => {
    setSummaryFocusPair(pair);
    summarySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const screeningClinicalColumns = useMemo(() => {
    const screenable = summaryQuery.data?.screenable_clinical_columns;
    if (screenable?.length) return screenable;
    const fromSummary = (summaryQuery.data?.clinical_columns ?? []).filter(
      c =>
        !ID_COLUMNS.has(c) &&
        c !== 'time' &&
        c !== 'status' &&
        !/\.(x|y)$/.test(c),
    );
    if (fromSummary.length > 0) return fromSummary;
    return survivalColumns.filter(
      c => !ID_COLUMNS.has(c) && c !== 'time' && c !== 'status',
    );
  }, [
    summaryQuery.data?.screenable_clinical_columns,
    summaryQuery.data?.clinical_columns,
    survivalColumns,
  ]);

  if (!hasSurvival) {
    return (
      <ClinicalUploadPanel
        datasetId={datasetId}
        apiDetailLoaded={apiDetailLoaded}
        onUploaded={onSurvivalAttached}
      />
    );
  }

  const spatialRequest = (spatialQuery ?? {}) as Record<string, unknown>;

  const clinicalVarCount = survivalColumns.filter(c => !ID_COLUMNS.has(c)).length;

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950/80 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3 min-w-0">
            <div className="shrink-0 w-10 h-10 rounded-lg bg-brand-950 border border-brand-800/60 flex items-center justify-center">
              <Stethoscope size={20} className="text-brand-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-100 tracking-tight">
                Clinical analysis
              </h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-xl">
                Link tissue imaging features to your clinical variables. Explore associations in
                summary plots, then run formal tests below.
              </p>
            </div>
          </div>
          <LevelToggle level={level} onChange={setLevel} />
        </div>
        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-800/80">
          <StatusPill
            icon={<FileSpreadsheet size={12} />}
            label={`${clinicalVarCount} clinical variable${clinicalVarCount === 1 ? '' : 's'}`}
          />
          {featuresQuery.data && (
            <StatusPill
              icon={<Sparkles size={12} />}
              label={`${featuresQuery.data.n_rows} ${level === 'sample' ? 'samples' : 'patients'} · ${featureColumns.length} imaging features`}
            />
          )}
          {spatial.enabled && (
            <StatusPill
              icon={<Sparkles size={12} />}
              label="Spatial clustering included"
              variant="accent"
            />
          )}
        </div>
      </header>

      <SpatialClusterPanel cellTypes={cellTypes} spatial={spatial} onChange={setSpatial} />

      <IdOverlapBanner
        overlap={overlapQuery.data}
        loading={overlapQuery.loading}
        error={overlapQuery.error}
        hasSurvival={hasSurvival}
      />

      <section aria-labelledby="clinical-association-heading">
        <SectionHeading
          id="clinical-association-heading"
          title="Exploratory association screening"
          description="Tests all marker–clinical combinations · Applies FDR correction · Generates heatmap · Generates ranked associations"
        />
        <ClinicalAssociationMatrix
          datasetId={datasetId}
          level={level}
          spatialRequest={spatialQuery}
          overlap={overlapQuery.data}
          overlapLoading={overlapQuery.loading}
          availableClinicalColumns={screeningClinicalColumns}
          markerColumns={featureColumns}
          survivalColumns={survivalColumns}
          spatialRequestRecord={spatialRequest}
          onPairSelect={handleScreeningPairSelect}
        />
      </section>

      <section ref={summarySectionRef} aria-labelledby="clinical-summary-heading">
        <SectionHeading
          id="clinical-summary-heading"
          title="Summary explorer"
          description="Visualize how cell markers and spatial clustering relate to clinical variables before running statistical tests."
        />
        <ClinicalSummaryPlot
          datasetId={datasetId}
          level={level}
          onLevelChange={setLevel}
          hideLevelControl
          spatialRequest={spatialQuery}
          focusPair={summaryFocusPair}
        />
      </section>

      <FeaturePreview
        loading={featuresQuery.loading}
        error={featuresQuery.error}
        data={featuresQuery.data}
        featureColumns={featureColumns}
      />

      <section aria-labelledby="clinical-tests-heading">
        <SectionHeading
          id="clinical-tests-heading"
          title="Statistical analysis"
          description="Choose an analysis type. Results update automatically when you change inputs."
        />

        <div
          className="flex flex-wrap gap-1 p-1 rounded-lg bg-slate-900/80 border border-slate-800 mb-4"
          role="tablist"
          aria-label="Analysis type"
        >
          {TAB_CONFIG.map(({ id, label, icon: Icon, hint }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => setActiveTab(id)}
              className={clsx(
                'flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-all',
                activeTab === id
                  ? 'bg-slate-800 text-slate-100 shadow-sm border border-slate-700'
                  : 'text-slate-500 hover:text-slate-300 border border-transparent',
              )}
            >
              <Icon size={14} className={activeTab === id ? 'text-brand-400' : 'text-slate-600'} />
              <span>{label}</span>
              <span className="hidden sm:inline text-[10px] text-slate-600 font-normal">{hint}</span>
            </button>
          ))}
        </div>

        <div role="tabpanel">
          {activeTab === 'compare' && (
            <ClinicalGroupTest
              datasetId={datasetId}
              level={level}
              featureColumns={featureColumns}
              survivalColumns={survivalColumns}
              clinicalRows={clinicalRows}
              spatialRequest={spatialRequest}
            />
          )}
          {activeTab === 'regression' && (
            <>
              <ClinicalRegression
                datasetId={datasetId}
                level={level}
                featureColumns={featureColumns}
                survivalColumns={survivalColumns}
                spatialRequest={spatialRequest}
              />
              {featureColumns.some(c => c.startsWith('count_')) && (
                <BetaBinomialRegression
                  datasetId={datasetId}
                  level={level}
                  featureColumns={featureColumns}
                  survivalColumns={survivalColumns}
                  spatialRequest={spatialRequest}
                />
              )}
            </>
          )}
          {activeTab === 'survival' && (
            <ClinicalSurvivalSection
              datasetId={datasetId}
              level={level}
              featureColumns={featureColumns}
              survivalColumns={survivalColumns}
              spatialRequest={spatialRequest}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function SectionHeading({
  id,
  title,
  description,
}: {
  id?: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-3" id={id}>
      <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">{title}</h3>
      <p className="text-[11px] text-slate-500 mt-0.5">{description}</p>
    </div>
  );
}

function LevelToggle({
  level,
  onChange,
}: {
  level: 'sample' | 'patient';
  onChange: (l: 'sample' | 'patient') => void;
}) {
  return (
    <div className="shrink-0">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Aggregation</p>
      <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
        {(['sample', 'patient'] as const).map(l => (
          <button
            key={l}
            type="button"
            onClick={() => onChange(l)}
            className={clsx(
              'px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors',
              level === l
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-500 hover:text-slate-300',
            )}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatusPill({
  icon,
  label,
  variant = 'default',
}: {
  icon: ReactNode;
  label: string;
  variant?: 'default' | 'accent';
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium border',
        variant === 'accent'
          ? 'bg-brand-950/50 border-brand-800/50 text-brand-300'
          : 'bg-slate-900/60 border-slate-800 text-slate-400',
      )}
    >
      {icon}
      {label}
    </span>
  );
}

function AnalysisCard({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-800/80 bg-slate-900/60 flex gap-3">
        <div className="shrink-0 w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-brand-400">
          {icon}
        </div>
        <div>
          <h4 className="text-sm font-semibold text-slate-200">{title}</h4>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{description}</p>
        </div>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-slate-400 block mb-1">{label}</span>
      {hint && <span className="text-[10px] text-slate-600 block mb-1.5 -mt-0.5">{hint}</span>}
      {children}
    </label>
  );
}

function FeaturePreview({
  loading,
  error,
  data,
  featureColumns,
}: {
  loading: boolean;
  error: string | null;
  data: ClinicalFeaturesResponse | null;
  featureColumns: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="rounded-xl border border-slate-800 bg-slate-900/30 group"
      open={open}
      onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="px-5 py-3.5 cursor-pointer list-none flex items-center justify-between gap-3 hover:bg-slate-900/50 transition-colors rounded-xl">
        <div className="flex items-center gap-2.5 min-w-0">
          <Table2 size={16} className="text-slate-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-300">Imaging feature table</p>
            <p className="text-[10px] text-slate-600 truncate">
              {data
                ? `${data.n_rows} rows · ${featureColumns.length} features · joined on sample_id / patient_id`
                : 'Preview merged cell counts and clinical IDs'}
            </p>
          </div>
        </div>
        <ChevronDown
          size={16}
          className="text-slate-600 shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="px-5 pb-5 border-t border-slate-800/80">
        {loading && (
          <p className="text-xs text-slate-500 py-3 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading features…
          </p>
        )}
        {error && <ErrorBanner message={error} />}
        {data && <FeatureTable data={data} featureColumns={featureColumns} />}
      </div>
    </details>
  );
}

function FeatureTable({
  data,
  featureColumns,
}: {
  data: ClinicalFeaturesResponse;
  featureColumns: string[];
}) {
  const displayCols = ['sample_id', 'patient_id', 'n_total', ...featureColumns.slice(0, 6)];
  const rows = data.features.slice(0, 12);
  const cols = displayCols.filter(c => rows[0] && c in rows[0]);

  return (
    <div className="overflow-x-auto mt-3 border border-slate-800 rounded-lg max-h-52">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-800 bg-slate-900/80 sticky top-0">
            {cols.map(c => (
              <th key={c} className="px-3 py-2.5 font-medium whitespace-nowrap">
                {featureLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-800/40 hover:bg-slate-900/40">
              {cols.map(c => (
                <td key={c} className="px-3 py-2 text-slate-400 whitespace-nowrap tabular-nums">
                  {typeof row[c] === 'number'
                    ? (row[c] as number).toFixed(row[c]! < 10 ? 2 : 1)
                    : String(row[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.features.length > 12 && (
        <p className="text-[10px] text-slate-600 px-3 py-2 bg-slate-900/50">
          Showing 12 of {data.features.length} rows.
        </p>
      )}
    </div>
  );
}

type SpatialState = {
  enabled: boolean;
  statistic: 'K' | 'G';
  typeA: string;
  typeB: string;
  radius: number;
  minFocalCells: number;
};

function SpatialClusterPanel({
  cellTypes,
  spatial,
  onChange,
}: {
  cellTypes: string[];
  spatial: SpatialState;
  onChange: (s: SpatialState) => void;
}) {
  return (
    <details className="rounded-xl border border-slate-800 bg-slate-900/30 group">
      <summary className="px-5 py-3.5 cursor-pointer list-none flex items-center justify-between gap-3 hover:bg-slate-900/50 transition-colors">
        <div className="flex items-center gap-2.5">
          <Sparkles size={16} className={clsx(spatial.enabled ? 'text-brand-400' : 'text-slate-600')} />
          <div>
            <p className="text-xs font-medium text-slate-300">Optional spatial clustering</p>
            <p className="text-[10px] text-slate-600">
              Add Ripley K or NN-G as a feature in comparisons, regression, survival, and summary plots
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {spatial.enabled && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-950 border border-brand-800 text-brand-300">
              On
            </span>
          )}
          <ChevronDown size={16} className="text-slate-600 transition-transform group-open:rotate-180" />
        </div>
      </summary>
      <div className="px-5 pb-5 border-t border-slate-800/80 space-y-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={spatial.enabled}
            onChange={e => onChange({ ...spatial, enabled: e.target.checked })}
            className="mt-0.5 rounded border-slate-600 text-brand-500 focus:ring-brand-500/30"
          />
          <span className="text-xs text-slate-400 leading-relaxed">
            Include per-sample spatial clustering statistic alongside cell features
          </span>
        </label>
        {spatial.enabled && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <FormField label="Statistic">
              <select
                className="input text-xs w-full"
                value={spatial.statistic}
                onChange={e => {
                  const s = e.target.value as 'K' | 'G';
                  onChange({ ...spatial, statistic: s, radius: s === 'K' ? 50 : 20 });
                }}
              >
                <option value="K">Ripley K (L − r)</option>
                <option value="G">Nearest-neighbor G</option>
              </select>
            </FormField>
            <FormField label="Focal cell type">
              <select
                className="input text-xs w-full"
                value={spatial.typeA}
                onChange={e => onChange({ ...spatial, typeA: e.target.value })}
              >
                {cellTypes.map(ct => (
                  <option key={ct} value={ct}>{ct}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Cross type (optional)" hint="For cross-K / cross-G">
              <select
                className="input text-xs w-full"
                value={spatial.typeB}
                onChange={e => onChange({ ...spatial, typeB: e.target.value })}
              >
                <option value="">None (univariate)</option>
                {cellTypes.filter(ct => ct !== spatial.typeA).map(ct => (
                  <option key={ct} value={ct}>{ct}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Radius (px)">
              <input
                type="number"
                min={5}
                max={500}
                className="input text-xs w-full"
                value={spatial.radius}
                onChange={e => onChange({ ...spatial, radius: Math.max(5, Number(e.target.value) || 50) })}
              />
            </FormField>
            <FormField label="Min focal cells">
              <input
                type="number"
                min={1}
                className="input text-xs w-full"
                value={spatial.minFocalCells}
                onChange={e => onChange({ ...spatial, minFocalCells: Math.max(1, Number(e.target.value) || 10) })}
              />
            </FormField>
          </div>
        )}
      </div>
    </details>
  );
}

function ClinicalGroupTest({
  datasetId,
  level,
  featureColumns,
  survivalColumns,
  clinicalRows,
  spatialRequest,
}: {
  datasetId: string;
  level: 'sample' | 'patient';
  featureColumns: string[];
  survivalColumns: string[];
  clinicalRows: Array<Record<string, string | number | null>>;
  spatialRequest: Record<string, unknown>;
}) {
  const [featureColumn, setFeatureColumn] = useState('');
  const [groupColumn, setGroupColumn] = useState('');
  const [groupA, setGroupA] = useState('');
  const [groupB, setGroupB] = useState('');

  const featureOpts = useMemo(() => featureOptions(featureColumns), [featureColumns]);

  useEffect(() => {
    if (featureColumns.length && !featureColumns.includes(featureColumn)) {
      setFeatureColumn(defaultFeature(featureColumns));
    }
  }, [featureColumns, featureColumn]);

  useEffect(() => {
    const eligible = survivalColumns.filter(c => !ID_COLUMNS.has(c));
    if (!groupColumn && eligible.length) {
      setGroupColumn(defaultGroup(eligible));
    }
  }, [survivalColumns, groupColumn]);

  const groupLevels = useMemo(() => {
    if (!groupColumn || clinicalRows.length === 0) return [];
    const levels = new Set<string>();
    for (const r of clinicalRows) {
      const v = r[groupColumn];
      if (v != null && v !== '') levels.add(String(v));
    }
    return Array.from(levels).sort();
  }, [clinicalRows, groupColumn]);

  useEffect(() => {
    if (groupLevels.length >= 2) {
      setGroupA(prev => (groupLevels.includes(prev) ? prev : groupLevels[0]));
      setGroupB(prev => (groupLevels.includes(prev) ? prev : groupLevels[1]));
    } else {
      setGroupA('');
      setGroupB('');
    }
  }, [groupLevels]);

  const req = useMemo(() => {
    if (!featureColumn || !groupColumn) return null;
    const base = {
      datasetId,
      level,
      featureColumn,
      groupColumn,
      ...spatialRequest,
    };
    if (groupLevels.length > 2 && groupA && groupB) {
      return { ...base, groupA, groupB };
    }
    return base;
  }, [datasetId, level, featureColumn, groupColumn, spatialRequest, groupLevels.length, groupA, groupB]);

  const { data, loading, error } = useClinicalWilcoxon(req);

  return (
    <AnalysisCard
      icon={<GitCompare size={16} />}
      title="Compare groups"
      description="Test whether a cell feature or spatial clustering statistic differs between clinical groups (e.g. stage, treatment, recurrence)."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Feature" hint="Cell marker, ratio, or spatial clustering">
          <select
            className="input text-xs w-full"
            value={featureColumn}
            onChange={e => setFeatureColumn(e.target.value)}
          >
            {featureOpts.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Clinical group" hint="Column defining the groups">
          <select
            className="input text-xs w-full"
            value={groupColumn}
            onChange={e => setGroupColumn(e.target.value)}
          >
            {survivalColumns.filter(c => !ID_COLUMNS.has(c) && c !== 'time').map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </FormField>
      </div>
      {groupLevels.length > 2 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Group A" hint={`${groupLevels.length} levels — pick two to compare`}>
            <select
              className="input text-xs w-full"
              value={groupA}
              onChange={e => setGroupA(e.target.value)}
            >
              {groupLevels.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Group B">
            <select
              className="input text-xs w-full"
              value={groupB}
              onChange={e => setGroupB(e.target.value)}
            >
              {groupLevels.filter(g => g !== groupA).map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </FormField>
        </div>
      )}
      {loading && <LoadingBanner text="Running Wilcoxon test…" />}
      {error && <ErrorBanner message={error} />}
      {data && (
        <ResultsPanel
          title="Wilcoxon results"
          onExportCsv={() =>
            downloadCsv(
              [
                {
                  feature: data.request.feature_column,
                  group_column: data.request.group_column,
                  group_a: data.wilcoxon.group_a,
                  group_b: data.wilcoxon.group_b,
                  p_value: data.wilcoxon.p_value,
                  w: data.wilcoxon.w,
                  rank_biserial: data.wilcoxon.rank_biserial,
                },
                ...data.wilcoxon.points.map(p => ({
                  sample_id: p.sample_id,
                  group: p.group,
                  stat: p.stat,
                })),
              ],
              `wilcoxon-${datasetId}.csv`,
            )
          }
        >
          <WilcoxonResults data={data} featureLabel={featureLabel(data.request.feature_column)} />
        </ResultsPanel>
      )}
    </AnalysisCard>
  );
}

function ClinicalRegression({
  datasetId,
  level,
  featureColumns,
  survivalColumns,
  spatialRequest,
}: {
  datasetId: string;
  level: 'sample' | 'patient';
  featureColumns: string[];
  survivalColumns: string[];
  spatialRequest: Record<string, unknown>;
}) {
  const [outcomeColumn, setOutcomeColumn] = useState('status');
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [covariates, setCovariates] = useState<string[]>([]);
  const [clusterPatients, setClusterPatients] = useState(true);

  useEffect(() => {
    if (survivalColumns.includes('status')) setOutcomeColumn('status');
    else if (survivalColumns.length) {
      setOutcomeColumn(survivalColumns.find(c => !ID_COLUMNS.has(c)) ?? 'status');
    }
  }, [survivalColumns]);

  useEffect(() => {
    if (featureColumns.length && selectedFeatures.length === 0) {
      const def = defaultFeature(featureColumns);
      const extra = featureColumns.filter(c => c.startsWith('ratio_')).slice(0, 1);
      setSelectedFeatures([def, ...extra].filter((v, i, a) => a.indexOf(v) === i));
    }
  }, [featureColumns, selectedFeatures.length]);

  useEffect(() => {
    const spatialOn = Boolean(
      (spatialRequest as { includeSpatialCluster?: boolean }).includeSpatialCluster,
    );
    if (spatialOn && featureColumns.includes('spatial_cluster_stat')) {
      setSelectedFeatures(prev =>
        prev.includes('spatial_cluster_stat') ? prev : [...prev, 'spatial_cluster_stat'],
      );
    } else {
      setSelectedFeatures(prev => prev.filter(c => c !== 'spatial_cluster_stat'));
    }
  }, [spatialRequest, featureColumns]);

  useEffect(() => {
    setCovariates(
      PREFERRED_COVARIATES.filter(
        c => survivalColumns.includes(c) && c !== outcomeColumn,
      ),
    );
  }, [outcomeColumn, survivalColumns]);

  const covariateOptions = survivalColumns.filter(
    c => !ID_COLUMNS.has(c) && c !== outcomeColumn && c !== 'time',
  );

  const req = useMemo(() => {
    if (selectedFeatures.length === 0) return null;
    return {
      datasetId,
      level,
      outcomeColumn,
      featureColumns: selectedFeatures,
      covariates,
      clusterPatients,
      ...spatialRequest,
    };
  }, [datasetId, level, outcomeColumn, selectedFeatures, covariates, clusterPatients, spatialRequest]);

  const { data, loading, error } = useClinicalLinear(req);

  const toggleFeature = (col: string) => {
    setSelectedFeatures(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col],
    );
  };
  const toggleCov = (col: string) => {
    setCovariates(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col],
    );
  };

  return (
    <AnalysisCard
      icon={<LineChart size={16} />}
      title="Regression models"
      description="Predict a clinical outcome from cell features and covariates. Binary outcomes use logistic regression; numeric outcomes use linear regression."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Outcome variable">
          <select
            className="input text-xs w-full"
            value={outcomeColumn}
            onChange={e => setOutcomeColumn(e.target.value)}
          >
            {survivalColumns.filter(c => !ID_COLUMNS.has(c)).map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Standard errors">
          <select
            className="input text-xs w-full"
            value={clusterPatients ? 'yes' : 'no'}
            onChange={e => setClusterPatients(e.target.value === 'yes')}
          >
            <option value="yes">Cluster-robust (by patient)</option>
            <option value="no">Standard</option>
          </select>
        </FormField>
      </div>
      <CovariateChips
        title="Predictors — cell features & spatial"
        subtitle="Select imaging features; enable spatial clustering above to include K/G stat"
        options={featureColumns}
        selected={selectedFeatures}
        onToggle={toggleFeature}
        labelFn={col =>
          col === 'spatial_cluster_stat' ? 'Spatial clustering (K/G)' : featureLabel(col)
        }
      />
      <CovariateChips
        title="Covariates — clinical"
        subtitle="Adjust for demographics and treatment"
        options={covariateOptions}
        selected={covariates}
        onToggle={toggleCov}
      />
      {loading && <LoadingBanner text="Fitting model…" />}
      {error && <ErrorBanner message={error} />}
      {data && (
        <ResultsPanel title="Model output">
          <LinearModelResults lin={data.linear} clusteringLabel="Spatial cluster" />
        </ResultsPanel>
      )}
    </AnalysisCard>
  );
}

function BetaBinomialRegression({
  datasetId,
  level,
  featureColumns,
  survivalColumns,
  spatialRequest,
}: {
  datasetId: string;
  level: 'sample' | 'patient';
  featureColumns: string[];
  survivalColumns: string[];
  spatialRequest: Record<string, unknown>;
}) {
  const countColumns = featureColumns.filter(c => c.startsWith('count_'));
  const [countColumn, setCountColumn] = useState('');
  const [totalColumn, setTotalColumn] = useState('n_total');
  const [outcomeColumn, setOutcomeColumn] = useState('status');
  const [covariates, setCovariates] = useState<string[]>([]);
  const [clusterPatients, setClusterPatients] = useState(true);

  useEffect(() => {
    if (countColumns.length && !countColumn) {
      const def = countColumns.find(c =>
        /cd8|t_cell|tcell/i.test(c)
      ) ?? countColumns[0];
      setCountColumn(def);
    }
  }, [countColumns, countColumn]);

  useEffect(() => {
    if (survivalColumns.includes('status')) setOutcomeColumn('status');
    else if (survivalColumns.length) {
      setOutcomeColumn(survivalColumns.find(c => !ID_COLUMNS.has(c)) ?? 'status');
    }
  }, [survivalColumns]);

  useEffect(() => {
    setCovariates(
      PREFERRED_COVARIATES.filter(
        c => survivalColumns.includes(c) && c !== outcomeColumn,
      ),
    );
  }, [outcomeColumn, survivalColumns]);

  const toggleCov = (col: string) => {
    setCovariates(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col],
    );
  };

  const covariateOptions = survivalColumns.filter(
    c => !ID_COLUMNS.has(c) && c !== outcomeColumn && c !== 'time',
  );

  const denominatorOptions = useMemo(() => {
    const opts = [{ value: 'n_total', label: 'n_total (all cells)' }];
    for (const col of countColumns) {
      if (col !== countColumn) {
        opts.push({ value: col, label: featureLabel(col) });
      }
    }
    return opts;
  }, [countColumns, countColumn]);

  const req = useMemo(() => {
    if (!countColumn) return null;
    return {
      datasetId,
      level,
      countColumn,
      totalColumn,
      outcomeColumn,
      covariates,
      clusterPatients,
      ...spatialRequest,
    };
  }, [datasetId, level, countColumn, totalColumn, outcomeColumn, covariates, clusterPatients, spatialRequest]);

  const { data, loading, error } = useClinicalBetaBinomial(req);
  const bb = data?.beta_binomial;

  return (
    <AnalysisCard
      icon={<FlaskConical size={16} />}
      title="Beta-binomial model"
      description="Model per-sample cell-count proportions as overdispersed binomial outcomes. Accounts for varying denominator sizes and between-sample overdispersion beyond standard binomial. The clinical variable is the predictor."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Count (numerator)" hint="Positive cells, e.g. T cells in tumor">
          <select
            className="input text-xs w-full"
            value={countColumn}
            onChange={e => setCountColumn(e.target.value)}
          >
            {countColumns.map(c => (
              <option key={c} value={c}>{featureLabel(c)}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Total (denominator)" hint="Reference compartment, default all cells">
          <select
            className="input text-xs w-full"
            value={totalColumn}
            onChange={e => setTotalColumn(e.target.value)}
          >
            {denominatorOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Clinical predictor">
          <select
            className="input text-xs w-full"
            value={outcomeColumn}
            onChange={e => setOutcomeColumn(e.target.value)}
          >
            {survivalColumns.filter(c => !ID_COLUMNS.has(c)).map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Standard errors">
          <select
            className="input text-xs w-full"
            value={clusterPatients ? 'yes' : 'no'}
            onChange={e => setClusterPatients(e.target.value === 'yes')}
          >
            <option value="yes">Cluster-robust (by patient)</option>
            <option value="no">Standard</option>
          </select>
        </FormField>
      </div>
      <CovariateChips
        title="Covariates — clinical"
        subtitle="Adjust for demographics and treatment"
        options={covariateOptions}
        selected={covariates}
        onToggle={toggleCov}
      />
      {loading && <LoadingBanner text="Fitting beta-binomial model…" />}
      {error && <ErrorBanner message={error} />}
      {bb && (
        <ResultsPanel title="Beta-binomial output">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <StatPill label="n" value={String(bb.n)} />
            <StatPill label="Mean proportion" value={`${(bb.mean_proportion * 100).toFixed(1)}%`} />
            <StatPill label="Dispersion (φ)" value={isFinite(bb.dispersion) ? bb.dispersion.toFixed(4) : '—'} />
            {bb.aic != null && isFinite(bb.aic) && (
              <StatPill label="AIC" value={bb.aic.toFixed(1)} />
            )}
          </div>
          {bb.family === 'quasibinomial' && (
            <p className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2 mb-3">
              True beta-binomial fitting failed for this model — using quasibinomial GLM as a last resort. Results are approximate.
            </p>
          )}
          <LinearModelResults
            lin={{
              n: bb.n,
              formula: bb.formula,
              family: bb.family,
              outcome_column: bb.count_column,
              covariates: bb.covariates,
              primary: bb.primary,
              estimate_table: bb.estimate_table,
              model_rows: bb.model_rows?.map(r => ({
                sample_id: r.sample_id,
                patient_id: r.patient_id,
                observed: r.proportion,
                fitted: r.proportion,
                residual: 0,
                ...Object.fromEntries(
                  bb.predictors.map(p => [p, r[p]]),
                ),
              })),
            }}
          />
        </ResultsPanel>
      )}
    </AnalysisCard>
  );
}

function ClinicalSurvivalSection({
  datasetId,
  level,
  featureColumns,
  survivalColumns,
  spatialRequest,
}: {
  datasetId: string;
  level: 'sample' | 'patient';
  featureColumns: string[];
  survivalColumns: string[];
  spatialRequest: Record<string, unknown>;
}) {
  const hasTimeStatus = survivalColumns.includes('time') && survivalColumns.includes('status');
  const [featureColumn, setFeatureColumn] = useState('');
  const [covariates, setCovariates] = useState<string[]>([]);
  const [dichotomize, setDichotomize] = useState<'median' | 'tertile' | 'trichotomize' | 'none'>('median');
  const [clusterPatients, setClusterPatients] = useState(true);

  useEffect(() => {
    if (featureColumns.length && !featureColumn) {
      setFeatureColumn(defaultFeature(featureColumns));
    }
  }, [featureColumns, featureColumn]);

  useEffect(() => {
    setCovariates(
      PREFERRED_COVARIATES.filter(c => survivalColumns.includes(c) && c !== 'time' && c !== 'status'),
    );
  }, [survivalColumns]);

  const covariateOptions = survivalColumns.filter(
    c => !ID_COLUMNS.has(c) && c !== 'time' && c !== 'status',
  );

  const req = useMemo(() => {
    if (!hasTimeStatus || !featureColumn) return null;
    return {
      datasetId,
      level,
      featureColumn,
      covariates,
      dichotomize,
      clusterPatients,
      ...spatialRequest,
    };
  }, [datasetId, level, featureColumn, covariates, dichotomize, clusterPatients, hasTimeStatus, spatialRequest]);

  const { data, loading, error } = useClinicalSurvival(req);

  if (!hasTimeStatus) {
    return (
      <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-5 flex gap-3">
        <Info size={18} className="text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-100">Survival columns required</p>
          <p className="text-xs text-amber-200/80 mt-1 leading-relaxed">
            Your clinical CSV must include <code className="text-amber-100/90">time</code> (follow-up
            days) and <code className="text-amber-100/90">status</code> (event indicator) to run
            Kaplan–Meier and Cox models.
          </p>
        </div>
      </div>
    );
  }

  const toggleCov = (col: string) => {
    setCovariates(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col],
    );
  };

  return (
    <AnalysisCard
      icon={<HeartPulse size={16} />}
      title="Survival analysis"
      description="Kaplan–Meier curves, log-rank test, and Cox proportional hazards for a cell feature or spatial clustering statistic."
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <FormField label="Feature" hint="Cell marker, ratio, or spatial clustering">
          <select
            className="input text-xs w-full"
            value={featureColumn}
            onChange={e => setFeatureColumn(e.target.value)}
          >
            {featureOptions(featureColumns).map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </FormField>
        <FormField label="KM stratification">
          <select
            className="input text-xs w-full"
            value={dichotomize}
            onChange={e => setDichotomize(e.target.value as 'median' | 'tertile' | 'trichotomize' | 'none')}
          >
            <option value="median">Median split + KM</option>
            <option value="tertile">Tertile extremes + KM</option>
            <option value="trichotomize">Low / medium / high (tertile groups + KM)</option>
            <option value="none">Continuous (Cox only)</option>
          </select>
        </FormField>
        <FormField label="Standard errors">
          <select
            className="input text-xs w-full"
            value={clusterPatients ? 'yes' : 'no'}
            onChange={e => setClusterPatients(e.target.value === 'yes')}
          >
            <option value="yes">Cluster-robust (by patient)</option>
            <option value="no">Standard</option>
          </select>
        </FormField>
      </div>
      <CovariateChips
        title="Cox covariates"
        subtitle="Additional clinical variables in the multivariable model"
        options={covariateOptions}
        selected={covariates}
        onToggle={toggleCov}
      />
      {loading && <LoadingBanner text="Fitting Cox model…" />}
      {error && <ErrorBanner message={error} />}
      {data && (
        <ResultsPanel
          title="Survival results"
          onExportCsv={() => {
            const cox = data.survival.cox;
            downloadCsv(
              [
                {
                  feature: data.request.feature_column,
                  formula: cox.formula,
                  n: cox.n,
                  n_events: cox.n_events,
                  hr: cox.primary.hr,
                  hr_lower: cox.primary.hr_lower,
                  hr_upper: cox.primary.hr_upper,
                  p_value: cox.primary.p_value,
                  concordance: cox.concordance,
                  logrank_p: data.survival.logrank?.p_value,
                },
              ],
              `survival-cox-${datasetId}.csv`,
            );
          }}
        >
          <SurvivalResults data={data} featureLabel={featureLabel(data.request.feature_column)} />
        </ResultsPanel>
      )}
    </AnalysisCard>
  );
}

function ResultsPanel({
  title,
  children,
  onExportCsv,
}: {
  title: string;
  children: ReactNode;
  onExportCsv?: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 overflow-hidden">
      <div className="px-4 py-2 border-b border-slate-800/80 bg-slate-900/50 flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-medium">{title}</p>
        {onExportCsv && (
          <button
            type="button"
            onClick={onExportCsv}
            className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300"
          >
            <Download size={11} /> CSV
          </button>
        )}
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </div>
  );
}

function IdOverlapBanner({
  overlap,
  loading,
  error,
  hasSurvival,
}: {
  overlap: IdOverlapResponse | null;
  loading: boolean;
  error: string | null;
  hasSurvival: boolean;
}) {
  if (!hasSurvival) return null;

  if (loading) {
    return (
      <p className="text-xs text-slate-500 flex items-center gap-2">
        <Loader2 size={14} className="animate-spin" /> Checking ID overlap…
      </p>
    );
  }

  if (error?.includes('404')) {
    return (
      <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-xs text-amber-200/90 flex gap-2">
        <AlertCircle size={16} className="shrink-0 mt-0.5" />
        <span>
          ID overlap check unavailable — restart the API with <code className="text-amber-100">npm run api</code>.
        </span>
      </div>
    );
  }

  if (!overlap?.has_clinical) return null;

  const ratePct = Math.round(overlap.match_rate * 100);
  const ok = overlap.n_matched >= 5;
  return (
    <div
      className={clsx(
        'rounded-lg border px-4 py-3 text-xs flex flex-wrap items-start gap-3',
        ok ? 'border-slate-800 bg-slate-900/40 text-slate-400' : 'border-amber-800/40 bg-amber-950/20 text-amber-200/90',
      )}
    >
      <Info size={16} className={clsx('shrink-0 mt-0.5', ok ? 'text-slate-500' : 'text-amber-400')} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-300">
          ID overlap: {overlap.n_matched} of {overlap.n_clinical_rows} clinical rows matched imaging samples
          {overlap.match_by ? ` (via ${overlap.match_by})` : ''}
          {' · '}{ratePct}%
        </p>
        {!ok && (
          <p className="mt-1 leading-relaxed">
            Association screening and formal tests need at least 5 matched samples. Ensure clinical{' '}
            <code className="text-amber-100">sample_id</code> values exactly match imaging metadata
            (see unmatched IDs below).
          </p>
        )}
        {overlap.unmatched_clinical && overlap.unmatched_clinical.length > 0 && (
          <p className="mt-1 text-[10px] text-slate-500 truncate">
            Unmatched clinical IDs: {overlap.unmatched_clinical.slice(0, 8).join(', ')}
            {overlap.unmatched_clinical.length > 8 ? ` (+${overlap.unmatched_clinical.length - 8} more)` : ''}
          </p>
        )}
      </div>
    </div>
  );
}

function CovariateChips({
  title,
  subtitle,
  options,
  selected,
  onToggle,
  labelFn = featureLabel,
}: {
  title: string;
  subtitle?: string;
  options: string[];
  selected: string[];
  onToggle: (col: string) => void;
  labelFn?: (col: string) => string;
}) {
  if (options.length === 0) return null;
  return (
    <div>
      <p className="text-[11px] font-medium text-slate-400">{title}</p>
      {subtitle && <p className="text-[10px] text-slate-600 mt-0.5 mb-2">{subtitle}</p>}
      {!subtitle && <div className="mb-2" />}
      <div className="flex flex-wrap gap-2">
        {options.map(col => (
          <button
            key={col}
            type="button"
            onClick={() => onToggle(col)}
            className={clsx(
              'px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
              selected.includes(col)
                ? 'bg-brand-900/40 border-brand-600/60 text-brand-200 shadow-sm'
                : 'bg-slate-900/60 border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300',
            )}
          >
            {labelFn(col)}
          </button>
        ))}
      </div>
    </div>
  );
}

function WilcoxonResults({
  data,
  featureLabel: featLabel,
}: {
  data: { wilcoxon: WilcoxonResponse['wilcoxon'] };
  featureLabel: string;
}) {
  const wx = data.wilcoxon;
  const [ga, gb] = wx.groups;
  const significant = wx.p_value < 0.05;
  return (
    <>
      <MetricGrid>
        <Metric label="p value" value={formatP(wx.p_value)} accent={significant ? 'good' : 'neutral'} highlight={significant} />
        <Metric label="W statistic" value={String(wx.w)} />
        <Metric label={`n (${ga.label})`} value={String(ga.n)} />
        <Metric label={`n (${gb.label})`} value={String(gb.n)} />
        <Metric label="Effect size (r)" value={formatNum(wx.rank_biserial, 2)} />
      </MetricGrid>
      <WilcoxonBoxPlot points={wx.points} label={featLabel} groupA={wx.group_a} groupB={wx.group_b} />
    </>
  );
}

function SurvivalResults({
  data,
  featureLabel: featLabel,
}: {
  data: import('../../api/types').ClinicalSurvivalResponse;
  featureLabel: string;
}) {
  const cox = data.survival.cox;
  const lr = data.survival.logrank;
  const coxSig = cox.primary.p_value < 0.05;
  return (
    <>
      <MetricGrid>
        <Metric label="Cox p value" value={formatP(cox.primary.p_value)} accent={coxSig ? 'good' : 'neutral'} highlight={coxSig} />
        <Metric
          label="Hazard ratio"
          value={formatNum(cox.primary.hr, 2)}
          sub={`95% CI ${formatRange(cox.primary.hr_lower, cox.primary.hr_upper, 2)}`}
        />
        {lr && (
          <Metric
            label="Log-rank p"
            value={formatP(lr.p_value)}
            accent={lr.p_value < 0.05 ? 'good' : 'neutral'}
          />
        )}
        <Metric label="Sample size" value={String(cox.n)} />
        <Metric label="Events" value={String(cox.n_events)} />
        <Metric label="Concordance" value={formatNum(cox.concordance, 3)} />
      </MetricGrid>
      <p className="text-[10px] text-slate-600 font-mono break-all px-1">{cox.formula}</p>
      {cox.km && <KMPlot data={cox.km} title={`Survival by ${featLabel} (high vs low)`} />}
    </>
  );
}

function MetricGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">{children}</div>
  );
}

function WilcoxonBoxPlot({
  points,
  label,
  groupA,
  groupB,
}: {
  points: Array<{ sample_id: string; group: string; stat: number }>;
  label: string;
  groupA: string;
  groupB: string;
}) {
  const traces: Data[] = [groupA, groupB].map((g, i) => ({
    type: 'box',
    name: g,
    y: points.filter(p => p.group === g).map(p => p.stat),
    boxpoints: 'all',
    marker: { color: i === 0 ? '#3b82f6' : '#f97316', size: 5 },
  }));
  const layout: Partial<Layout> = {
    title: { text: `${label} by clinical group`, font: { size: 13, color: '#e2e8f0' } },
    height: 280,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(15,23,42,0.5)',
    font: { color: '#94a3b8', size: 11 },
    margin: { l: 52, r: 24, t: 36, b: 44 },
    yaxis: { title: { text: label }, gridcolor: '#1e293b', zerolinecolor: '#334155' },
    xaxis: { gridcolor: '#1e293b' },
    showlegend: true,
    legend: { orientation: 'h', y: 1.12, font: { size: 10 } },
  };
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-2">
      <Plot data={traces} layout={layout} style={{ width: '100%' }} config={{ displayModeBar: false }} />
    </div>
  );
}

function KMPlot({ data, title }: { data: CoxKM; title: string }) {
  const groups = Array.from(new Set(data.group));
  const traces: Data[] = groups.map((g, i) => {
    const indices = data.group.map((gn, idx) => (gn === g ? idx : -1)).filter(idx => idx >= 0);
    return {
      type: 'scatter',
      mode: 'lines',
      name: g,
      x: indices.map(idx => data.time[idx]),
      y: indices.map(idx => data.surv[idx]),
      line: { width: 2.5, shape: 'hv', color: i === 0 ? '#3b82f6' : '#f97316' },
    };
  });
  const layout: Partial<Layout> = {
    title: { text: title, font: { size: 13, color: '#e2e8f0' } },
    height: 320,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(15,23,42,0.5)',
    font: { color: '#94a3b8', size: 11 },
    margin: { l: 52, r: 24, t: 36, b: 44 },
    xaxis: { title: { text: 'Time' }, gridcolor: '#1e293b' },
    yaxis: { title: { text: 'Survival probability' }, range: [0, 1.05], gridcolor: '#1e293b' },
    legend: { orientation: 'h', y: 1.12, font: { size: 10 } },
  };
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-2">
      <Plot data={traces} layout={layout} style={{ width: '100%' }} config={{ displayModeBar: false }} />
    </div>
  );
}

function Metric({
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

function LoadingBanner({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 flex items-center gap-3">
      <Loader2 size={18} className="animate-spin text-brand-400 shrink-0" />
      <p className="text-xs text-slate-400">{text}</p>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-center">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-slate-200">{value}</p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-800/50 bg-rose-950/30 p-4 flex gap-3">
      <AlertCircle size={18} className="shrink-0 text-rose-400 mt-0.5" />
      <p className="text-xs text-rose-200/90 leading-relaxed">{message}</p>
    </div>
  );
}

function ClinicalUploadPanel({
  datasetId,
  apiDetailLoaded,
  onUploaded,
}: {
  datasetId: string;
  apiDetailLoaded?: boolean;
  onUploaded?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const isLocalOnlyId = datasetId.startsWith('ds_');

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const resp = await uploadSurvival(datasetId, file);
      setSuccess(`${resp.survival_rows} matched sample(s) — clinical analysis is now available.`);
      onUploaded?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950 p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-brand-950 border border-brand-800/50 flex items-center justify-center mx-auto mb-4">
          <Stethoscope size={28} className="text-brand-400" />
        </div>
        <h2 className="text-base font-semibold text-slate-100">Clinical analysis</h2>
        <p className="text-sm text-slate-400 mt-2 leading-relaxed">
          Attach a clinical metadata file to compare cell features with outcomes such as stage,
          treatment, and survival.
        </p>
      </div>

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          {[
            {
              step: '1',
              title: 'Prepare CSV',
              body: 'One row per sample_id with time, status, and clinical columns (e.g. race, stage, grade). To add columns only, upload sample_id + race without time/status.',
            },
            { step: '2', title: 'Upload', body: 'Match IDs to cells in this dataset (sample_id or patient_id).' },
            { step: '3', title: 'Analyze', body: 'Summary plots, group tests, regression, and Cox models unlock automatically.' },
          ].map(({ step, title, body }) => (
            <div key={step} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
              <span className="inline-flex w-6 h-6 rounded-full bg-slate-800 text-[10px] font-bold text-slate-300 items-center justify-center mb-2">
                {step}
              </span>
              <p className="text-xs font-medium text-slate-300">{title}</p>
              <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>

        {!apiDetailLoaded && !isLocalOnlyId && (
          <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-4 py-3 flex gap-2 text-xs text-amber-200/90">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>
              Dataset not on the R API — run <code className="text-amber-100">npm run dev</code> and
              upload cells via Contribute first.
            </span>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv"
          className="hidden"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full border-2 border-dashed border-slate-700 rounded-xl p-8 text-center hover:border-brand-700/50 hover:bg-brand-950/20 transition-colors"
        >
          <Upload size={24} className="mx-auto text-slate-500 mb-2" />
          <p className="text-sm font-medium text-slate-300">
            {file ? file.name : 'Choose clinical CSV or TSV'}
          </p>
          <p className="text-[10px] text-slate-600 mt-1">
            Required: sample_id (or patient_id), time, status · Optional: stage, grade, treatment…
          </p>
        </button>

        <button
          type="button"
          onClick={handleUpload}
          disabled={!file || uploading || isLocalOnlyId}
          className="btn-primary w-full sm:w-auto text-sm disabled:opacity-50 flex items-center justify-center gap-2 mx-auto"
        >
          {uploading ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Uploading…
            </>
          ) : (
            'Attach clinical data'
          )}
        </button>

        {success && (
          <p className="text-sm text-emerald-300 flex items-center justify-center gap-2">
            <CheckCircle2 size={16} /> {success}
          </p>
        )}
        {error && (
          <p className="text-sm text-rose-300 flex items-center justify-center gap-2">
            <AlertCircle size={16} /> {error}
          </p>
        )}
      </div>
    </div>
  );
}
