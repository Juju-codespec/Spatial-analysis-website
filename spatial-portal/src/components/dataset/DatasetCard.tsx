import { Link } from 'react-router-dom';
import { Users, FlaskConical, Eye, GitCompare, BookOpen } from 'lucide-react';
import type { Dataset } from '../../types';
import { useStore } from '../../store/useStore';
import SpatialPlot from '../visualization/SpatialPlot';
import clsx from 'clsx';

interface Props {
  dataset: Dataset;
  compact?: boolean;
}

const TECHNIQUE_TAG_CLASS: Record<string, string> = {
  'Multiplex IHC (mIHC)':                  'tag-blue',
  'Spatial Transcriptomics (10x Visium)':  'tag-purple',
  'CODEX (CO-Detection by indEXing)':      'tag-green',
  'Multiplex IF (Opal)':                   'tag-amber',
  'MERFISH':                               'tag-rose',
};

export default function DatasetCard({ dataset, compact = false }: Props) {
  const { toggleCompare, compareIds } = useStore();
  const isInCompare = compareIds.includes(dataset.id);

  return (
    <div className={clsx('card-hover group flex flex-col overflow-hidden', compact && 'h-auto')}>
      {/* Mini preview */}
      {!compact && (
        <div className="relative h-44 bg-slate-950 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 scale-[0.85] origin-top-left -translate-x-4 -translate-y-4">
            <SpatialPlot dataset={dataset} miniMode height={176} />
          </div>
          {dataset.cells.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80">
              <span className="text-[10px] text-slate-500 animate-pulse">Loading preview…</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900/95 via-slate-900/30 to-transparent" />
          <div className="absolute top-2 right-2 flex items-center gap-1.5">
            <span className={clsx('badge text-[10px]', TECHNIQUE_TAG_CLASS[dataset.technique] || 'tag')}>
              {dataset.technique.split(' ')[0]}
            </span>
            {dataset.status === 'published' && (
              <span className="badge bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px]">Published</span>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="p-4 flex flex-col flex-1 gap-3">
        <div>
          <Link to={`/dataset/${dataset.id}`}>
            <h3 className="text-sm font-semibold text-slate-100 group-hover:text-brand-400 transition-colors line-clamp-2 leading-snug">
              {dataset.title}
            </h3>
          </Link>
          {!compact && (
            <p className="mt-1.5 text-xs text-slate-500 line-clamp-2 leading-relaxed">{dataset.description}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <span className="tag text-[10px]">{dataset.cancerType}</span>
          {compact && <span className={clsx('badge text-[10px]', TECHNIQUE_TAG_CLASS[dataset.technique] || 'tag')}>{dataset.technique.split(' ')[0]}</span>}
          {dataset.markers.slice(0, 3).map(m => (
            <span key={m} className="tag-blue text-[10px]">{m}</span>
          ))}
          {dataset.markers.length > 3 && <span className="tag text-[10px]">+{dataset.markers.length - 3}</span>}
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-500 mt-auto">
          <span className="flex items-center gap-1"><FlaskConical size={11} />{dataset.sampleCount} samples</span>
          <span className="flex items-center gap-1"><Users size={11} />{(dataset.cellCount / 1000).toFixed(1)}k cells</span>
          {!compact && <span className="flex items-center gap-1 ml-auto"><Eye size={11} />{dataset.viewCount.toLocaleString()}</span>}
        </div>

        {!compact && (
          <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-slate-500 truncate">{dataset.contributor}</p>
              <p className="text-[10px] text-slate-600 truncate">{dataset.institution}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <Link to={`/dataset/${dataset.id}`} className="btn-secondary text-[11px] px-2.5 py-1.5">
                <Eye size={11} /> View
              </Link>
              <button
                onClick={e => { e.preventDefault(); toggleCompare(dataset.id); }}
                className={clsx(
                  'px-2.5 py-1.5 rounded-lg border text-[11px] flex items-center gap-1 transition-colors',
                  isInCompare
                    ? 'bg-brand-900 border-brand-700 text-brand-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                )}
                title={isInCompare ? 'Remove from compare' : 'Add to compare'}
              >
                <GitCompare size={11} />
              </button>
              {dataset.doi && (
                <a href={`https://doi.org/${dataset.doi}`} target="_blank" rel="noopener noreferrer"
                   className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors">
                  <BookOpen size={11} />
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
