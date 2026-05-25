// React hooks for spatial/survival analyses backed by the R API.

import { useEffect, useState } from 'react';
import {
  ApiError,
  analyzeCox,
  analyzeNnG,
  analyzeRipleyK,
  getJob,
  type CoxRequest,
  type RipleyKRequest,
} from '../api/client';
import type {
  CoxResponse,
  JobStatus,
  NnGResponse,
  RipleyKResponse,
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
