import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  /** Optional message rendered above the error details. */
  fallbackTitle?: string;
}

interface State {
  error: Error | null;
}

/**
 * Last-ditch error boundary. Without this, an uncaught render error (e.g. the
 * `Math.min(...giantArray)` crash that used to fire on large uploads) tears
 * the whole React tree down and leaves a blank page that looks identical to
 * a browser "black-out".
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] render crashed:', error, info);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="pt-14 min-h-screen flex items-center justify-center p-6">
        <div className="card p-6 max-w-lg w-full">
          <div className="flex items-center gap-2 text-rose-400 mb-3">
            <AlertTriangle size={18} />
            <h2 className="text-base font-semibold">
              {this.props.fallbackTitle ?? 'Something went wrong'}
            </h2>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            The view crashed before it could finish rendering. Your data is
            still safe — try reloading the view or going back to a previous
            page.
          </p>
          <pre className="text-[11px] text-rose-300/90 bg-rose-950/30 border border-rose-900/60 rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap">
            {String(this.state.error.message || this.state.error)}
          </pre>
          <div className="flex gap-2 mt-4">
            <button onClick={this.reset} className="btn-primary text-sm">
              <RotateCcw size={13} /> Try again
            </button>
            <button
              onClick={() => window.location.assign('/')}
              className="btn-secondary text-sm"
            >
              Go home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
