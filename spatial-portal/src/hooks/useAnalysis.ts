// React hooks for spatial/survival analyses backed by the R API.
//
// Each hook owns its own loading/error state and re-fires when its key
// parameters change. State updates are dispatched only after at least one
// `await` boundary so they never run synchronously inside the effect body
// (the lint rule `react-hooks/set-state-in-effect` would otherwise flag
// the loading-flag set).

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

// Generic helper that drives an async request hook. We deliberately do all
// state writes from inside `then`/`catch` callbacks so they happen on a
// later microtask, not synchronously in the effect body.
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

/** Run Ripley's K against the backend; null means "don't run". */
export function useRipleyK(req: RipleyKRequest | null) {
  return useAsync<RipleyKRequest, RipleyKResponse>(req, r =>
    analyzeRipleyK(r).then(unwrapSync<RipleyKResponse>),
  );
}

export function useNnG(req: RipleyKRequest | null) {
  return useAsync<RipleyKRequest, NnGResponse>(req, r =>
    analyzeNnG(r).then(unwrapSync<NnGResponse>),
  );
}

export function useCox(req: CoxRequest | null) {
  return useAsync<CoxRequest, CoxResponse>(req, analyzeCox);
}

/**
 * Poll the `/jobs/:id` endpoint until the job completes. Default poll
 * interval is 1.5s; cleans up on unmount or when the id changes.
 */
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

function unwrapSync<T>(value: T | { jobId: string; status: string }): T {
  if (value && typeof value === 'object' && 'jobId' in value) {
    throw new Error('Backend returned a job id; use useJobResult to poll it.');
  }
  return value as T;
}

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
