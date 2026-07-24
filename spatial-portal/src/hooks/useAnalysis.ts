// React hooks for spatial/survival analyses backed by the R API.

import { useEffect, useState } from 'react';
import {
  ApiError,
  analyzeCox,
  analyzeBivariateCox,
  analyzeNnG,
  analyzeRipleyK,
  analyzeLinear,
  analyzeWilcoxon,
  analyzeClinicalWilcoxon,
  analyzeClinicalLinear,
  analyzeClinicalBetaBinomial,
  analyzeClinicalSurvival,
  getClinicalFeatures,
  getClinicalSummary,
  analyzeClinicalSummaryTests,
  getIdOverlap,
  associationScreeningAvailable,
  analyzeClinicalAssociationMatrix,
  getJob,
  type ClinicalSummaryTestsRequest,
  type ClinicalAssociationMatrixRequest,
  type ClinicalLinearRequest,
  type ClinicalBetaBinomialRequest,
  type ClinicalSurvivalRequest,
  type ClinicalWilcoxonRequest,
  type CoxRequest,
  type BivariateCoxRequest,
  type ClinicalSpatialQuery,
  type LinearRequest,
  type RipleyKRequest,
  type WilcoxonRequest,
} from '../api/client';
import type {
  ClinicalLinearResponse,
  ClinicalSurvivalResponse,
  ClinicalWilcoxonResponse,
  ClinicalAssociationMatrixResponse,
  IdOverlapResponse,
  CoxResponse,
  BivariateCoxResponse,
  JobStatus,
  LinearResponse,
  NnGResponse,
  RipleyKResponse,
  WilcoxonResponse,
  BetaBinomialResponse,
} from '../api/types';

type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

const initial = <T>(): AsyncState<T> => ({ data: null, loading: false, error: null });

async function pollJob<T>(jobId: string, intervalMs = 1500, maxAttempts = 120): Promise<T> {
  for (let i = 0; i < maxAttempts; i++) {
    const job = await getJob<T>(jobId);
    if (job.status === 'completed') return job.result as T;
    if (job.status === 'failed') throw new Error(job.error ?? 'Job failed');
    await new Promise(resolve => window.setTimeout(resolve, intervalMs));
  }
  throw new Error('Analysis job timed out');
}

async function runSpatialJob<T>(
  req: RipleyKRequest,
  fetcher: (r: RipleyKRequest) => Promise<T | { jobId: string; status: string }>,
): Promise<T> {
  const res = await fetcher(req);
  if (res && typeof res === 'object' && 'jobId' in res) {
    return pollJob<T>(res.jobId);
  }
  return res as T;
}

function useAsync<TReq, TRes>(
  req: TReq | null,
  fetcher: (r: TReq) => Promise<TRes>,
): AsyncState<TRes> {
  const [state, setState] = useState<AsyncState<TRes>>(initial());
  const key = req ? JSON.stringify(req) : '';

  useEffect(() => {
    if (!req) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setState({ data: null, loading: true, error: null });
      return fetcher(req).then(
        result => {
          if (cancelled) return;
          setState({ data: result, loading: false, error: null });
        },
        err => {
          if (cancelled) return;
          setState({ data: null, loading: false, error: errorMessage(err) });
        },
      );
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

export function useRipleyK(req: RipleyKRequest | null) {
  return useAsync<RipleyKRequest, RipleyKResponse>(req, r =>
    runSpatialJob(r, analyzeRipleyK),
  );
}

export function useNnG(req: RipleyKRequest | null) {
  return useAsync<RipleyKRequest, NnGResponse>(req, r =>
    runSpatialJob(r, analyzeNnG),
  );
}

export function useCox(req: CoxRequest | null) {
  return useAsync<CoxRequest, CoxResponse>(req, analyzeCox);
}

export function useBivariateCox(req: BivariateCoxRequest | null) {
  return useAsync<BivariateCoxRequest, BivariateCoxResponse>(req, analyzeBivariateCox);
}

export function useWilcoxon(req: WilcoxonRequest | null) {
  return useAsync<WilcoxonRequest, WilcoxonResponse>(req, analyzeWilcoxon);
}

export function useLinear(req: LinearRequest | null) {
  return useAsync<LinearRequest, LinearResponse>(req, analyzeLinear);
}

export function useClinicalFeatures(
  datasetId: string | null,
  level: 'sample' | 'patient' = 'sample',
  spatial?: ClinicalSpatialQuery | null,
) {
  const req = datasetId ? { datasetId, level, spatial: spatial ?? null } : null;
  return useAsync(
    req,
    r => getClinicalFeatures(r.datasetId, r.level, r.spatial ?? undefined),
  );
}

export function useClinicalSummary(
  datasetId: string | null,
  level: 'sample' | 'patient' = 'sample',
  spatial?: ClinicalSpatialQuery | null,
) {
  const req = datasetId ? { datasetId, level, spatial: spatial ?? null } : null;
  return useAsync(req, r => getClinicalSummary(r.datasetId, r.level, r.spatial ?? undefined));
}

export function useClinicalSummaryTests(req: ClinicalSummaryTestsRequest | null) {
  return useAsync(req, analyzeClinicalSummaryTests);
}

export function useClinicalAssociationMatrix(req: ClinicalAssociationMatrixRequest | null) {
  return useAsync<ClinicalAssociationMatrixRequest, ClinicalAssociationMatrixResponse>(
    req,
    analyzeClinicalAssociationMatrix,
  );
}

export function useIdOverlap(datasetId: string | null, enabled = true) {
  const [state, setState] = useState<AsyncState<IdOverlapResponse>>(initial());
  const key = datasetId && enabled ? datasetId : '';

  useEffect(() => {
    if (!datasetId || !enabled) return;
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    getIdOverlap(datasetId).then(
      data => {
        if (!cancelled) setState({ data, loading: false, error: null });
      },
      err => {
        if (!cancelled) {
          setState({ data: null, loading: false, error: errorMessage(err) });
        }
      },
    );
    return () => { cancelled = true; };
  }, [key, datasetId, enabled]);

  return state;
}

export { associationScreeningAvailable };

export function useClinicalWilcoxon(req: ClinicalWilcoxonRequest | null) {
  return useAsync<ClinicalWilcoxonRequest, ClinicalWilcoxonResponse>(
    req,
    analyzeClinicalWilcoxon,
  );
}

export function useClinicalLinear(req: ClinicalLinearRequest | null) {
  return useAsync<ClinicalLinearRequest, ClinicalLinearResponse>(
    req,
    analyzeClinicalLinear,
  );
}

export function useClinicalBetaBinomial(req: ClinicalBetaBinomialRequest | null) {
  return useAsync<ClinicalBetaBinomialRequest, BetaBinomialResponse>(
    req,
    analyzeClinicalBetaBinomial,
  );
}

export function useClinicalSurvival(req: ClinicalSurvivalRequest | null) {
  return useAsync<ClinicalSurvivalRequest, ClinicalSurvivalResponse>(
    req,
    analyzeClinicalSurvival,
  );
}

export function useJobResult<T>(jobId: string | null, intervalMs = 1500): AsyncState<T> & { status: JobStatus<T>['status'] | null } {
  const [state, setState] = useState<AsyncState<T> & { status: JobStatus<T>['status'] | null }>(
    { ...initial<T>(), status: null },
  );

  useEffect(() => {
    if (!jobId) {
      Promise.resolve().then(() => setState({ ...initial<T>(), status: null }));
      return;
    }
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const job = await getJob<T>(jobId);
        if (cancelled) return;
        if (job.status === 'completed') {
          setState({ data: (job.result ?? null) as T | null, loading: false, error: null, status: 'completed' });
          return;
        }
        if (job.status === 'failed') {
          setState({ data: null, loading: false, error: job.error ?? 'Job failed', status: 'failed' });
          return;
        }
        setState(prev => ({ ...prev, loading: true, status: job.status }));
        timer = window.setTimeout(() => { void tick(); }, intervalMs);
      } catch (e) {
        if (cancelled) return;
        setState({ data: null, loading: false, error: errorMessage(e), status: 'failed' });
      }
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [jobId, intervalMs]);

  return state;
}

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
