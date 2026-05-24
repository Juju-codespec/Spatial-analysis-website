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
  JobStatus,
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
    const fromBody =
      body && typeof body === 'object' && 'message' in body
        ? (body as { message?: unknown }).message
        : undefined;
    const msg =
      (typeof fromBody === 'string' && fromBody) ||
      res.statusText ||
      `Request failed (${res.status})`;
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

export const uploadDataset = (
  cells: File,
  options: {
    survival?: File;
    title?: string;
    cancer_type?: string;
    tissue?: string;
  } = {},
): Promise<{ id: string; meta: ApiDatasetMeta; message: string }> => {
  const form = new FormData();
  form.append('cells', cells, cells.name);
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
  dichotomize?: 'none' | 'median' | 'tertile';
  covariates?: string[];
  adjustDensity?: boolean;
  clusterPatients?: boolean;
}

export const analyzeCox = (req: CoxRequest) =>
  apiFetch<CoxResponse>('/analyze/cox', {
    method: 'POST',
    body: JSON.stringify(req),
  });

export const getJob = <T = unknown>(id: string) =>
  apiFetch<JobStatus<T>>(`/jobs/${encodeURIComponent(id)}`);

export const checkHealth = () =>
  apiFetch<{ status: string; version: string; time: string }>('/health');
