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
  hr_lower: number | null;
  hr_upper: number | null;
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
  dichotomize: 'none' | 'median' | 'tertile' | 'trichotomize';
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

export interface BivariateCoxQuadrant {
  label: string;
  n: number;
  n_events: number;
}

export interface BivariateCoxResult {
  n: number;
  n_events: number;
  n_clusters?: number;
  formula: string;
  split: 'median' | 'tertile';
  adjust_density?: boolean;
  density_covariates?: string[];
  clustered?: boolean;
  cluster_id?: string | null;
  concordance: number;
  logtest: number[];
  quadrants: BivariateCoxQuadrant[];
  primary: CoxPrimary;
  coefficients: Array<Record<string, number | string>>;
  confidence_intervals: Array<Record<string, number | string>>;
  km: CoxKM;
}

export interface BivariateCoxResponse {
  request: {
    statistic: 'K' | 'G';
    radius: number;
    typeA: string;
    typeB: string | null;
    correction: string;
    window_type?: string;
    abundance_type: 'pct' | 'count';
    abund_col: string;
    split: 'median' | 'tertile';
    covariates: string[];
    adjust_density?: boolean;
    cluster_patients: boolean;
    min_focal_cells: number;
  };
  stat_summary: Array<{ sample_id: string; stat: number; n_focal?: number; tissue_area?: number }>;
  abund_summary: Array<{ sample_id: string; abund: number }>;
  sample_filter?: {
    min_focal_cells: number;
    n_samples_total: number;
    n_samples_analyzed: number;
    n_samples_excluded: number;
  };
  cox: BivariateCoxResult;
}

export interface WilcoxonGroupSummary {
  label: string;
  n: number;
  mean: number;
  median: number;
  q1: number;
  q3: number;
}

export interface WilcoxonPoint {
  sample_id: string;
  group: string;
  stat: number;
}

export interface WilcoxonResult {
  method: string;
  alternative: string;
  w: number;
  p_value: number;
  group_column: string;
  group_a: string;
  group_b: string;
  rank_biserial: number;
  groups: WilcoxonGroupSummary[];
  points: WilcoxonPoint[];
}

export interface WilcoxonResponse {
  request: {
    statistic: 'K' | 'G';
    radius: number;
    typeA: string;
    typeB: string | null;
    correction: string;
    window_type?: string;
    group_column: string;
    group_a: string;
    group_b: string;
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
  eligible_group_columns?: string[];
  wilcoxon: WilcoxonResult;
}

export interface LinearPrimary {
  term: string;
  estimate: number;
  estimate_lower: number;
  estimate_upper: number;
  se: number;
  p_value: number;
  odds_ratio?: number | null;
  odds_ratio_lower?: number | null;
  odds_ratio_upper?: number | null;
}

export interface LinearCoefficient {
  term: string;
  estimate: number;
  se: number;
  z: number;
  p_value: number;
}

export interface LinearEstimateRow {
  term: string;
  estimate: number;
  se: number;
  ci_lower: number;
  ci_upper: number;
  p_value: number;
  odds_ratio?: number | null;
  or_lower?: number | null;
  or_upper?: number | null;
}

export interface LinearModelRow {
  sample_id: string;
  patient_id?: string;
  observed: number;
  fitted: number;
  residual: number;
  predicted_prob?: number;
  predicted_class?: number;
  clustering_stat?: number;
  clustering_group?: string;
  spatial_cluster_stat?: number;
  [key: string]: string | number | undefined;
}

export interface FrequencyRow {
  level?: string;
  count: number;
  observed?: string;
  predicted?: string;
  covariate?: string;
  covariate_level?: string;
  outcome?: string;
}

export interface LinearResult {
  n: number;
  formula: string;
  family: 'gaussian' | 'binomial' | 'beta_binomial' | 'beta_binomial_glmmTMB' | 'beta_binomial_aod' | 'quasibinomial';
  outcome_column: string;
  covariates: string[];
  dichotomize?: string;
  adjust_density?: boolean;
  clustered?: boolean;
  cluster_id?: string | null;
  density_covariates?: string[];
  n_clusters?: number;
  primary: LinearPrimary;
  coefficients: LinearCoefficient[];
  confidence_intervals: Array<{ term: string; lower: number; upper: number }>;
  estimate_table?: LinearEstimateRow[];
  model_rows?: LinearModelRow[];
  outcome_frequency?: FrequencyRow[];
  observed_predicted?: FrequencyRow[];
  covariate_frequencies?: Record<string, FrequencyRow[]>;
  r_squared?: number;
  adj_r_squared?: number;
  sigma?: number;
  aic?: number;
  null_deviance?: number;
  deviance?: number;
}

export interface LinearResponse {
  request: {
    statistic: 'K' | 'G';
    radius: number;
    typeA: string;
    typeB: string | null;
    correction: string;
    window_type?: string;
    outcome_column: string;
    covariates: string[];
    dichotomize?: string;
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
  eligible_outcome_columns?: string[];
  eligible_covariate_columns?: string[];
  linear: LinearResult;
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

export interface ClinicalSummaryMarkerOption {
  cell_type: string;
  count_column: string;
  pct_column: string;
}

export interface ClinicalSummaryResponse {
  has_clinical: boolean;
  level: 'sample' | 'patient';
  n_rows: number;
  cell_types: string[];
  markers: ClinicalSummaryMarkerOption[];
  marker_columns: string[];
  ratio_columns: string[];
  clinical_columns: string[];
  screenable_clinical_columns?: string[];
  column_types: Record<string, 'numeric' | 'categorical' | 'unknown'>;
  rows: Array<Record<string, string | number | null>>;
  include_spatial_cluster?: boolean;
}

export interface ClinicalSummaryTest {
  marker_column: string;
  clinical_column: string;
  association_type?: 'clinical' | 'survival';
  clinical_type?: 'numeric' | 'categorical' | 'survival';
  method?: string;
  statistic?: number;
  effect_size?: number;
  effect_metric?: 'rho' | 'rank_biserial' | 'eta_squared' | 'log_hr' | string;
  effect_strength?: number;
  direction?: 'positive' | 'negative' | 'neutral';
  effect_summary?: string;
  hr?: number;
  hr_lower?: number;
  hr_upper?: number;
  p_value?: number;
  fdr?: number;
  n?: number;
  n_events?: number;
  n_levels?: number;
  error?: string;
}

export interface ClinicalAssociationMatrixResponse {
  level: string;
  n_rows: number;
  marker_columns: string[];
  marker_groups?: {
    spatial?: string[];
    abundance?: string[];
    ratio?: string[];
    count?: string[];
  };
  clinical_columns: string[];
  outcome_columns?: string[];
  fdr_method: string;
  include_counts?: boolean;
  include_survival?: boolean;
  auto_spatial?: boolean;
  spatial_config?: {
    statistic?: string;
    type_a?: string;
    type_b?: string | null;
    radius?: number;
  } | null;
  n_pairs_possible?: number;
  n_pairs_screened?: number;
  n_clinical_pairs?: number;
  n_survival_pairs?: number;
  truncated?: boolean;
  n_tests: number;
  n_success?: number;
  n_failed?: number;
  include_spatial_cluster?: boolean;
  tests: ClinicalSummaryTest[];
}

export interface IdOverlapResponse {
  has_clinical: boolean;
  n_cell_samples: number;
  n_clinical_rows: number;
  n_matched: number;
  match_rate: number;
  match_by?: string;
  matched_ids?: string[];
  unmatched_clinical?: string[];
  unmatched_cell_samples?: string[];
}

export interface ClinicalSummaryTestsResponse {
  level: string;
  n_rows: number;
  tests: ClinicalSummaryTest[];
}

export interface ClinicalFeaturesResponse {
  level: 'sample' | 'patient';
  cell_types: string[];
  feature_columns: string[];
  n_rows: number;
  features: Array<Record<string, string | number | null>>;
  include_spatial_cluster?: boolean;
}

export interface ClinicalWilcoxonResponse {
  request: {
    feature_column: string;
    group_column: string;
    group_a: string;
    group_b: string;
    level: string;
    include_spatial_cluster?: boolean;
  };
  eligible_group_columns?: string[];
  feature_columns?: string[];
  wilcoxon: WilcoxonResult & { feature_column?: string };
}

export interface ClinicalLinearResult {
  n: number;
  formula: string;
  family: 'gaussian' | 'binomial';
  outcome_column: string;
  feature_columns: string[];
  covariates: string[];
  predictors: string[];
  clustered?: boolean;
  cluster_id?: string | null;
  n_clusters?: number;
  primary: LinearPrimary;
  coefficients: LinearCoefficient[];
  confidence_intervals: Array<{ term: string; lower: number; upper: number }>;
  estimate_table?: LinearEstimateRow[];
  model_rows?: LinearModelRow[];
  outcome_frequency?: FrequencyRow[];
  observed_predicted?: FrequencyRow[];
  covariate_frequencies?: Record<string, FrequencyRow[]>;
  r_squared?: number;
  adj_r_squared?: number;
  sigma?: number;
  aic?: number;
  null_deviance?: number;
  deviance?: number;
}

export interface ClinicalLinearResponse {
  request: {
    outcome_column: string;
    feature_columns: string[];
    covariates: string[];
    level: string;
    include_spatial_cluster?: boolean;
    cluster_patients?: boolean;
  };
  eligible_outcome_columns?: string[];
  eligible_covariate_columns?: string[];
  feature_columns?: string[];
  linear: ClinicalLinearResult;
}

export interface BetaBinomialResult {
  n: number;
  formula: string;
  family: 'beta_binomial' | 'beta_binomial_glmmTMB' | 'beta_binomial_aod' | 'quasibinomial';
  count_column: string;
  total_column: string;
  outcome_column: string;
  covariates: string[];
  predictors: string[];
  clustered?: boolean;
  cluster_id?: string | null;
  n_clusters?: number;
  dispersion: number;
  aic?: number;
  mean_proportion: number;
  median_proportion: number;
  primary: LinearPrimary;
  coefficients: LinearCoefficient[];
  confidence_intervals: Array<{ term: string; lower: number; upper: number }>;
  estimate_table?: LinearEstimateRow[];
  model_rows?: Array<{
    sample_id: string;
    patient_id?: string;
    count: number;
    n_total: number;
    proportion: number;
    [key: string]: string | number | undefined;
  }>;
}

export interface BetaBinomialResponse {
  request: {
    count_column: string;
    total_column: string;
    outcome_column: string;
    covariates: string[];
    level: string;
    cluster_patients?: boolean;
  };
  eligible_outcome_columns?: string[];
  eligible_covariate_columns?: string[];
  available_count_columns?: string[];
  feature_columns?: string[];
  beta_binomial: BetaBinomialResult;
}

export interface ClinicalLogRank {
  chisq: number;
  df: number;
  p_value: number;
  n: number[];
  events: number[];
}

export interface ClinicalSurvivalResponse {
  request: {
    feature_column: string;
    covariates: string[];
    dichotomize: string;
    level: string;
    include_spatial_cluster?: boolean;
    cluster_patients?: boolean;
  };
  feature_columns?: string[];
  survival: {
    cox: CoxResult;
    logrank: ClinicalLogRank | null;
    feature_column: string;
  };
}

/**
 * Response from GET /datasets/<id>/phenotype-summary.
 * Per-cell-type mean positivity for each phenotype_* column.
 * Values are 0–1 fractions (e.g. 0.97 = 97 % of cells in that type are positive).
 * `matrix[cellType][marker]` gives the mean for that combination.
 */
export interface PhenotypeSummaryResponse {
  cell_types: string[];
  markers: string[];
  matrix: Record<string, Record<string, number>>;
}

/** Response from GET /datasets/<id>/plot — ggplot2 core map as base64 PNG. */
export interface CellPlotResponse {
  sample_id: string;
  format: 'png';
  width: number;
  height: number;
  n_cells: number;
  /** Base64-encoded PNG bytes (use as `data:image/png;base64,<image_b64>`). */
  image_b64: string;
}
