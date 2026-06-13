// Wire types that mirror the plumber API responses defined in
// `spatial-portal-api/R/plumber.R`. Keep these in sync with the backend.

export interface ApiDatasetMeta {
  id: string;
  title: string;
  source: 'vpd' | 'upload' | string;
  cancer_type: string | null;
  tissue: string | null;
  n_cells: number;
  sample_count: number;
  has_survival: boolean;
  cell_types: string[];
  created_at: string | null;
}

export interface ApiSampleRow {
  sample_id: string;
  patient_id?: string;
  n_cells: number;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
}

export interface ApiDatasetDetail {
  meta: ApiDatasetMeta;
  samples: ApiSampleRow[];
  cell_types: Record<string, number>;
  has_survival: boolean;
  survival_columns: string[];
}

export interface ApiCellPoint {
  sample_id: string;
  x: number;
  y: number;
  cell_type: string;
}

export interface ApiCellsResponse {
  n_returned: number;
  n_total: number;
  cell_types?: Record<string, number>;
  cells: ApiCellPoint[];
}

export interface RipleyKPerSample {
  sample_id: string;
  r: number[];
  K_obs: number[];
  K_theo?: number[];
  L_obs: number[];
  L_theo?: number[];
  envelope_lo?: number[];
  envelope_hi?: number[];
  envelope_p?: number;
  n_focal?: number;
  n_total?: number;
  tissue_area?: number;
}

export interface NnGPerSample {
  sample_id: string;
  r: number[];
  G_obs: number[];
  G_theo?: number[];
  envelope_lo?: number[];
  envelope_hi?: number[];
  envelope_p?: number;
  n_focal?: number;
  n_total?: number;
  tissue_area?: number;
}

export interface SpatialAnalysisResponse<TPerSample> {
  type_a: string;
  type_b: string | null;
  correction: string;
  window_type?: string;
  nsim?: number;
  min_focal_cells?: number;
  n_samples_total?: number;
  n_samples_analyzed?: number;
  n_samples_excluded?: number;
  analysis_message?: string | null;
  per_sample: TPerSample[];
  summary: {
    r: number[];
    [key: string]: number[];
  };
}

export type RipleyKResponse = SpatialAnalysisResponse<RipleyKPerSample>;
export type NnGResponse = SpatialAnalysisResponse<NnGPerSample>;

export interface CoxPrimary {
  term: string;
  coef: number;
  hr: number;
  hr_lower: number;
  hr_upper: number;
  se: number;
  p_value: number;
}

export interface CoxKM {
  time: number[];
  surv: number[];
  n_risk: number[];
  n_event: number[];
  upper: number[];
  lower: number[];
  group: string[];
}

export interface CoxResult {
  n: number;
  n_events: number;
  n_clusters?: number;
  formula: string;
  dichotomize: 'none' | 'median' | 'tertile';
  adjust_density?: boolean;
  clustered?: boolean;
  cluster_id?: string | null;
  density_covariates?: string[];
  primary: CoxPrimary;
  coefficients: Array<Record<string, number | string>>;
  confidence_intervals: Array<Record<string, number | string>>;
  concordance: number;
  logtest: number[];
  km: CoxKM | null;
}

export interface CoxResponse {
  request: {
    statistic: 'K' | 'G';
    radius: number;
    typeA: string;
    typeB: string | null;
    correction: string;
    window_type?: string;
    dichotomize: string;
    covariates: string[];
    adjust_density?: boolean;
    cluster_patients?: boolean;
    min_focal_cells?: number;
  };
  stat_summary: Array<{
    sample_id: string;
    stat: number;
    n_focal?: number;
    tissue_area?: number;
  }>;
  sample_filter?: {
    min_focal_cells: number;
    n_samples_total: number;
    n_samples_analyzed: number;
    n_samples_excluded: number;
  };
  cox: CoxResult;
}

export interface JobStatus<T = unknown> {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  submitted: string;
  completed?: string;
  result?: T;
  error?: string;
}
