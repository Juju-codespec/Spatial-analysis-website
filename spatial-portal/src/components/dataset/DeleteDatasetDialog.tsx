import { useState } from 'react';
import { Trash2, Loader2, AlertCircle } from 'lucide-react';
import type { Dataset } from '../../types';
import { useStore } from '../../store/useStore';

interface Props {
  dataset: Dataset | null;
  onClose: () => void;
  onDeleted?: () => void;
}

export default function DeleteDatasetDialog({ dataset, onClose, onDeleted }: Props) {
  const { removeDataset } = useStore();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!dataset) return null;

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await removeDataset(dataset.id);
      onClose();
      onDeleted?.();
    } catch (e) {
      setError((e as Error).message || 'Failed to delete dataset.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
      onClick={() => !deleting && onClose()}
    >
      <div
        className="card max-w-sm w-full p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-rose-950 border border-rose-900 flex items-center justify-center text-rose-400 shrink-0">
            <Trash2 size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-100">Delete dataset?</h3>
            <p className="text-xs text-slate-400 mt-1">
              <strong className="text-slate-200">&ldquo;{dataset.title}&rdquo;</strong> will be
              removed from Explore and from the backend cache. This cannot be undone.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-3 p-2.5 border border-rose-700/60 bg-rose-950/30 rounded-lg text-xs text-rose-300 flex items-start gap-2">
            <AlertCircle size={12} className="text-rose-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-2 justify-end mt-5">
          <button
            onClick={onClose}
            disabled={deleting}
            className="btn-secondary text-xs disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium transition-colors disabled:opacity-60 flex items-center gap-1.5"
          >
            {deleting
              ? <><Loader2 size={13} className="animate-spin" /> Deleting…</>
              : <><Trash2 size={13} /> Delete</>}
          </button>
        </div>
      </div>
    </div>
  );
}
