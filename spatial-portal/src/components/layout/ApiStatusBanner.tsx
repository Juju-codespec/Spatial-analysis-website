import { AlertCircle, RefreshCw } from 'lucide-react';
import { useStore } from '../../store/useStore';

export default function ApiStatusBanner() {
  const { apiStatus, apiError, loadDatasets } = useStore();

  if (apiStatus !== 'offline') return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 max-w-lg mx-auto rounded-xl border border-amber-800/50 bg-amber-950/95 backdrop-blur-sm shadow-xl">
      <div className="px-4 py-3 flex items-start gap-3 text-xs text-amber-200">
        <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-amber-100">
            Backend offline — showing your last saved dataset list. Analyses need the API running.
          </p>
          {apiError && (
            <p className="text-amber-300/80 mt-0.5 line-clamp-2">{apiError}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void loadDatasets()}
          className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md border border-amber-700/60 text-amber-200 hover:bg-amber-900/50 transition-colors"
        >
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    </div>
  );
}
