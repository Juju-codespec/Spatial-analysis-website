// Thin fetch wrapper for the spatial-portal R backend.
//
// The base URL comes from VITE_API_URL (see .env.development). All requests
// flow through `apiFetch` so we get consistent error handling and a single
// place to inject auth headers later if needed.

import type {
  ApiDatasetMeta,
  ApiDatasetDetail,
  ApiCellsResponse,
  RipleyKResponse,
  NnGResponse,
  CoxResponse,
  BivariateCoxResponse,
  LinearResponse,
  WilcoxonResponse,
  ClinicalFeaturesResponse,
  ClinicalSummaryResponse,
  ClinicalSummaryTestsResponse,
  ClinicalWilcoxonResponse,
  ClinicalLinearResponse,
  ClinicalSurvivalResponse,
  JobStatus,
  ClinicalAssociationMatrixResponse,
  IdOverlapResponse,
  CellPlotResponse,
  BetaBinomialResponse,
  PhenotypeSummaryResponse,
} from './types';

export const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? safeParse(text) : null;
  if (!res.ok) {
    const record =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    const fromBody =
      (typeof record?.message === 'string' && record.message) ||
      (typeof record?.error === 'string' && record.error) ||
      undefined;
    const msg = fromBody || res.statusText || `Request failed (${res.status})`;
    throw new ApiError(res.status, body, msg);
  }
  return body as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---- Datasets --------------------------------------------------------------

export const getDatasets = () => apiFetch<ApiDatasetMeta[]>('/datasets');

export const getDataset = (id: string) =>
  apiFetch<ApiDatasetDetail>(`/datasets/${encodeURIComponent(id)}`);

export const getIdOverlap = (id: string) =>
  apiFetch<IdOverlapResponse>(`/datasets/${encodeURIComponent(id)}/id-overlap`);

export const getCells = (
  id: string,
  params: { sample_id?: string; cell_type?: string; downsample?: number } = {},
) => {
  const qs = new URLSearchParams();
  if (params.sample_id) qs.set('sample_id', params.sample_id);
  if (params.cell_type) qs.set('cell_type', params.cell_type);
  if (params.downsample) qs.set('downsample', String(params.downsample));
  const query = qs.toString();
  return apiFetch<ApiCellsResponse>(
    `/datasets/${encodeURIComponent(id)}/cells${query ? `?${query}` : ''}`,
  );
};

/** Fetch a ggplot2 core scatter map for one sample as a base64-encoded PNG.
 *  Uses coord_equal() on the backend so circular TMA cores render as circles.
 */
export const getCellPlot = (
  id: string,
  params: { sample_id: string; cell_type?: string; width?: number; height?: number; point_size?: number },
) => {
  const qs = new URLSearchParams({ sample_id: params.sample_id });
  if (params.cell_type)  qs.set('cell_type',  params.cell_type);
  if (params.width)      qs.set('width',      String(params.width));
  if (params.height)     qs.set('height',     String(params.height));
  if (params.point_size) qs.set('point_size', String(params.point_size));
  return apiFetch<CellPlotResponse>(
    `/datasets/${encodeURIComponent(id)}/plot?${qs.toString()}`,
  );
};

export const uploadDataset = (
  file: File,
  options: {
    survival?: File;
    title?: string;
    cancer_type?: string;
    tissue?: string;
  } = {},
): Promise<{ id: string; meta: ApiDatasetMeta; message: string }> => {
  const form = new FormData();
  const isRds = file.name.toLowerCase().endsWith('.rds');
  if (isRds) {
    form.append('rds', file, file.name);
  } else {
    form.append('cells', file, file.name);
  }
  if (options.survival) form.append('survival', options.survival, options.survival.name);
  if (options.title) form.append('title', options.title);
  if (options.cancer_type) form.append('cancer_type', options.cancer_type);
  if (options.tissue) form.append('tissue', options.tissue);
  return apiFetch('/datasets', { method: 'POST', body: form });
};

/** Delete a user-uploaded dataset on the backend. */
export const deleteDataset = (
  id: string,
): Promise<{ id: string; deleted: boolean; message: string }> =>
  apiFetch(`/datasets/${encodeURIComponent(id)}`, { method: 'DELETE' });

export interface UploadSurvivalResponse {
  id: string;
  has_survival: boolean;
  survival_rows: number;
  survival_columns: string[];
  message: string;
}

/** Attach (or replace) the survival CSV for an existing dataset. */
export const uploadSurvival = (
  datasetId: string,
  survival: File,
): Promise<UploadSurvivalResponse> => {
  const form = new FormData();
  form.append('survival', survival, survival.name);
  return apiFetch<UploadSurvivalResponse>(
    `/datasets/${encodeURIComponent(datasetId)}/survival`,
    { method: 'POST', body: form },
  );
};

// ---- Analysis --------------------------------------------------------------

export interface RipleyKRequest {
  datasetId: string;
  typeA: string;
  typeB?: string | null;
  sampleId?: string | null;
  rMax?: number;
  correction?: string;
  windowType?: 'convex' | 'bbox';
  nsim?: number;
  minFocalCells?: number;
  async?: boolean;
}

export const analyzeRipleyK = (req: RipleyKRequest) =>
  apiFetch<RipleyKResponse | { jobId: string; status: string }>(
    '/analyze/ripleys-k',
    { method: 'POST', body: JSON.stringify(req) },
  );

export const analyzeNnG = (req: RipleyKRequest) =>
  apiFetch<NnGResponse | { jobId: string; status: string }>(
    '/analyze/nn-g',
    { method: 'POST', body: JSON.stringify(req) },
  );

export interface CoxRequest {
  datasetId: string;
  statistic: 'K' | 'G';
  radius: number;
  typeA: string;
  typeB?: string | null;
  correction?: string;
  windowType?: 'convex' | 'bbox';
  dichotomize?: 'none' | 'median' | 'tertile' | 'trichotomize';
  covariates?: string[];
  adjustDensity?: boolean;
  clusterPatients?: boolean;
  minFocalCells?: number;
}

export const analyzeCox = (req: CoxRequest) =>
  apiFetch<CoxResponse>('/analyze/cox', {
    method: 'POST',
    body: JSON.stringify(req),
  });

export interface BivariateCoxRequest {
  datasetId: string;
  statistic: 'K' | 'G';
  radius: number;
  typeA: string;
  typeB?: string | null;
  correction?: string;
  windowType?: 'convex' | 'bbox';
  abundanceType?: 'pct' | 'count';
  split?: 'median' | 'tertile';
  covariates?: string[];
  adjustDensity?: boolean;
  clusterPatients?: boolean;
  minFocalCells?: number;
}

export const analyzeBivariateCox = (req: BivariateCoxRequest) =>
  apiFetch<BivariateCoxResponse>('/analyze/cox-bivariate', {
    method: 'POST',
    body: JSON.stringify(req),
  });

export interface WilcoxonRequest {
  datasetId: string;
  statistic: 'K' | 'G';
  radius: number;
  typeA: string;
  typeB?: string | null;
  correction?: string;
  windowType?: 'convex' | 'bbox';
  groupColumn: string;
  groupA?: string;
  groupB?: string;
  minFocalCells?: number;
}

export const analyzeWilcoxon = (req: WilcoxonRequest) =>
  apiFetch<WilcoxonResponse>('/analyze/wilcoxon', {
    method: 'POST',
    body: JSON.stringify(req),
  });

export interface LinearRequest {
  datasetId: string;
  statistic: 'K' | 'G';
  radius: number;
  typeA: string;
  typeB?: string | null;
  correction?: string;
  windowType?: 'convex' | 'bbox';
  outcomeColumn: string;
  covariates?: string[];
  dichotomize?: 'none' | 'median' | 'tertile' | 'trichotomize';
  adjustDensity?: boolean;
  clusterPatients?: boolean;
  minFocalCells?: number;
}

export const analyzeLinear = (req: LinearRequest) =>
  apiFetch<LinearResponse>('/analyze/linear', {
    method: 'POST',
    body: JSON.stringify(req),
  });

export interface ClinicalSpatialQuery {
  includeSpatialCluster?: boolean;
  statistic?: 'K' | 'G';
  typeA?: string;
  typeB?: string | null;
  radius?: number;
  minFocalCells?: number;
  windowType?: 'convex' | 'bbox';
}

function clinicalSpatialQueryString(spatial?: ClinicalSpatialQuery | null): string {
  if (!spatial?.includeSpatialCluster) return '';
  const params = new URLSearchParams();
  params.set('include_spatial_cluster', 'true');
  if (spatial.statistic) params.set('statistic', spatial.statistic);
  if (spatial.typeA) params.set('type_a', spatial.typeA);
  if (spatial.typeB) params.set('type_b', spatial.typeB);
  if (spatial.radius != null) params.set('radius', String(spatial.radius));
  if (spatial.minFocalCells != null) params.set('min_focal_cells', String(spatial.minFocalCells));
  if (spatial.windowType) params.set('window_type', spatial.windowType);
  const qs = params.toString();
  return qs ? `&${qs}` : '';
}

export const getClinicalFeatures = (
  datasetId: string,
  level: 'sample' | 'patient' = 'sample',
  spatial?: ClinicalSpatialQuery | null,
) =>
  apiFetch<ClinicalFeaturesResponse>(
    `/datasets/${encodeURIComponent(datasetId)}/clinical-features?level=${level}${clinicalSpatialQueryString(spatial)}`,
  );

export const getClinicalSummary = (
  datasetId: string,
  level: 'sample' | 'patient' = 'sample',
  spatial?: ClinicalSpatialQuery | null,
) =>
  apiFetch<ClinicalSummaryResponse>(
    `/datasets/${encodeURIComponent(datasetId)}/clinical-summary?level=${level}${clinicalSpatialQueryString(spatial)}`,
  );

export interface ClinicalSummaryTestsRequest extends ClinicalSpatialQuery {
  datasetId: string;
  level?: 'sample' | 'patient';
  pairs: Array<{ markerColumn: string; clinicalColumn: string }>;
}

export const analyzeClinicalSummaryTests = (req: ClinicalSummaryTestsRequest) =>
  apiFetch<ClinicalSummaryTestsResponse>('/analyze/clinical/summary-tests', {
    method: 'POST',
    body: JSON.stringify(req),
  });

export interface ClinicalAssociationMatrixRequest extends ClinicalSpatialQuery {
  datasetId: string;
  level?: 'sample' | 'patient';
  fdrMethod?: string;
  maxPairs?: number;
  includeCounts?: boolean;
  includeSurvival?: boolean;
  autoSpatial?: boolean;
  clinicalColumns?: string[];
}

export const analyzeClinicalAssociationMatrix = (req: ClinicalAssociationMatrixRequest) =>
  apiFetch<ClinicalAssociationMatrixResponse>('/analyze/clinical/association-matrix', {
    method: 'POST',
    body: JSON.stringify(req),
  });

export interface ClinicalAnalysisBase {
  datasetId: string;
  level?: 'sample' | 'patient';
  includeSpatialCluster?: boolean;
  statistic?: 'K' | 'G';
  typeA?: string;
  typeB?: string | null;
  radius?: number;
  correction?: string;
  windowType?: 'convex' | 'bbox';
  minFocalCells?: number;
}

export interface ClinicalWilcoxonRequest extends ClinicalAnalysisBase {
  featureColumn: string;
  groupColumn: string;
  groupA?: string;
  groupB?: string;
}

export const analyzeClinicalWilcoxon = (req: ClinicalWilcoxonRequest) =>
  apiFetch<ClinicalWilcoxonResponse>('/analyze/clinical/wilcoxon', {
    method: 'POST',
    body: JSON.stringify(req),
  });

export interface ClinicalLinearRequest extends ClinicalAnalysisBase {
  outcomeColumn: string;
  featureColumns?: string[];
  covariates?: string[];
  clusterPatients?: boolean;
}

export const analyzeClinicalLinear = (req: ClinicalLinearRequest) =>
  apiFetch<ClinicalLinearResponse>('/analyze/clinical/linear', {
    method: 'POST',
    body: JSON.stringify(req),
  });

export interface ClinicalBetaBinomialRequest extends ClinicalAnalysisBase {
  countColumn: string;
  totalColumn?: string;
  outcomeColumn: string;
  covariates?: string[];
  clusterPatients?: boolean;
}

export const analyzeClinicalBetaBinomial = (req: ClinicalBetaBinomialRequest) =>
  apiFetch<BetaBinomialResponse>('/analyze/clinical/beta-binomial', {
    method: 'POST',
    body: JSON.stringify(req),
  });

export interface ClinicalSurvivalRequest extends ClinicalAnalysisBase {
  featureColumn: string;
  covariates?: string[];
  dichotomize?: 'none' | 'median' | 'tertile' | 'trichotomize';
  clusterPatients?: boolean;
}

export const analyzeClinicalSurvival = (req: ClinicalSurvivalRequest) =>
  apiFetch<ClinicalSurvivalResponse>('/analyze/clinical/survival', {
    method: 'POST',
    body: JSON.stringify(req),
  });

export const getJob = <T = unknown>(id: string) =>
  apiFetch<JobStatus<T>>(`/jobs/${encodeURIComponent(id)}`);

/**
 * Per-cell-type mean phenotype positivity for the Expression Heatmap.
 * Returns an empty matrix when the dataset has no phenotype_* columns.
 */
export const getPhenotypeSummary = (id: string) =>
  apiFetch<PhenotypeSummaryResponse>(
    `/datasets/${encodeURIComponent(id)}/phenotype-summary`,
  );

export interface HealthResponse {
  status: string;
  version: string;
  time: string;
  capabilities?: {
    clinical_summary?: boolean;
    clinical_features?: boolean;
    clinical_analysis?: boolean;
    association_screening?: boolean;
  };
}

export const checkHealth = () => apiFetch<HealthResponse>('/health');

/** True when this API build exposes clinical-summary (not a stale plumber process). */
export async function clinicalRoutesAvailable(): Promise<boolean> {
  try {
    const health = await checkHealth();
    if (health.capabilities?.clinical_summary === true) return true;
  } catch {
    /* fall through to route probe */
  }
  try {
    const res = await fetch(
      `${API_URL}/datasets/__route_probe__/clinical-summary?level=sample`,
      { headers: { Accept: 'application/json' } },
    );
    const body = (await res.json()) as { error?: string };
    // Route exists → unknown dataset returns not_found, not plumber's generic 404.
    return body.error === 'not_found';
  } catch {
    return false;
  }
}

/** True when association screening routes (id-overlap, association-matrix) are available. */
export async function associationScreeningAvailable(): Promise<boolean> {
  try {
    const health = await checkHealth();
    if (health.capabilities?.association_screening === true) return true;
  } catch {
    /* fall through */
  }
  try {
    const res = await fetch(
      `${API_URL}/datasets/__route_probe__/id-overlap`,
      { headers: { Accept: 'application/json' } },
    );
    const body = (await res.json()) as { error?: string };
    return body.error === 'not_found';
  } catch {
    return false;
  }
}
