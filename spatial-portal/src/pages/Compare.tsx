import { Link } from 'react-router-dom';
import { GitCompare, X, ArrowRight } from 'lucide-react';
import { useStore } from '../store/useStore';
import SpatialPlot from '../components/visualization/SpatialPlot';
import HeatmapView from '../components/visualization/HeatmapView';
import { useState } from 'react';
import clsx from 'clsx';

type ViewMode = 'spatial' | 'heatmap';

export default function Compare() {
  const { datasets, compareIds, toggleCompare } = useStore();
  const selected = compareIds.map(id => datasets.find(d => d.id === id)).filter(Boolean) as typeof datasets;
  const [mode, setMode] = useState<ViewMode>('spatial');
  const [markers, setMarkers] = useState<[string, string]>(['', '']);

  const syncMarker = (idx: number, m: string) => {
    const next: [string, string] = [...markers] as [string, string];
    next[idx] = m;
    setMarkers(next);
  };

  if (selected.length === 0) {
    return (
      <div className="pt-14 min-h-screen flex items-center justify-center">
        <div className="text-center max-w-sm">
          <GitCompare size={40} className="text-slate-600 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-slate-200 mb-2">No datasets selected</h2>
          <p className="text-sm text-slate-500 mb-6">Add up to 2 datasets to compare by clicking the compare icon on any dataset card.</p>
          <Link to="/explore" className="btn-primary"><ArrowRight size={14} /> Browse Datasets</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-14 min-h-screen">
      <div className="max-w-screen-xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <p className="section-heading">Side-by-Side Comparison</p>
            <h1 className="text-xl font-bold text-slate-100">Compare Datasets</h1>
          </div>
          <div className="flex items-center gap-2">
            {(['spatial', 'heatmap'] as ViewMode[]).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={clsx('btn-ghost text-xs capitalize', mode === m && 'text-brand-400 bg-brand-950')}>
                {m}
              </button>
            ))}
            <Link to="/explore" className="btn-secondary text-xs"><GitCompare size={12} /> Change selection</Link>
          </div>
        </div>

        {selected.length === 1 && (
          <div className="card p-4 mb-6 border-dashed text-center text-sm text-slate-500">
            Select one more dataset from <Link to="/explore" className="text-brand-400 hover:text-brand-300">Explore</Link> to compare side-by-side.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {selected.map((ds, idx) => (
            <div key={ds.id} className="card overflow-hidden">
              {/* Header */}
              <div className="p-4 border-b border-slate-800 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <Link to={`/dataset/${ds.id}`} className="text-sm font-semibold text-slate-200 hover:text-brand-400 transition-colors line-clamp-1">{ds.title}</Link>
                  <p className="text-xs text-slate-500 mt-0.5">{ds.cancerType} · {ds.technique.split(' ')[0]}</p>
                </div>
                <button onClick={() => toggleCompare(ds.id)} className="text-slate-600 hover:text-rose-400 transition-colors shrink-0">
                  <X size={15} />
                </button>
              </div>

              {/* Marker selector */}
              <div className="px-4 py-2 border-b border-slate-800 flex items-center gap-2 overflow-x-auto">
                <span className="text-[10px] text-slate-500 shrink-0">Color by:</span>
                <button onClick={() => syncMarker(idx, '')}
                  className={clsx('text-[10px] px-2 py-0.5 rounded border whitespace-nowrap transition-colors', !markers[idx] ? 'bg-slate-700 border-slate-600 text-slate-200' : 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300')}>
                  Cell type
                </button>
                {ds.markers.map(m => (
                  <button key={m} onClick={() => syncMarker(idx, markers[idx] === m ? '' : m)}
                    className={clsx('text-[10px] px-2 py-0.5 rounded border whitespace-nowrap font-mono transition-colors',
                      markers[idx] === m ? 'bg-brand-900 border-brand-700 text-brand-300' : 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300')}>
                    {m}
                  </button>
                ))}
              </div>

              {/* Visualization */}
              <div className="p-2">
                {mode === 'spatial' ? (
                  <SpatialPlot dataset={ds} activeMarker={markers[idx]} height={380} />
                ) : (
                  <div className="p-3">
                    <HeatmapView dataset={ds} />
                  </div>
                )}
              </div>

              {/* Quick stats */}
              <div className="px-4 py-3 border-t border-slate-800 grid grid-cols-3 gap-2 text-center">
                {[['Cells', ds.cellCount.toLocaleString()], ['Samples', ds.sampleCount], ['Markers', ds.markers.length]].map(([label, val]) => (
                  <div key={label}>
                    <div className="text-sm font-bold text-slate-200">{val}</div>
                    <div className="text-[10px] text-slate-500">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Side-by-side summary table */}
        {selected.length === 2 && (
          <div className="card mt-6 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-slate-200">Dataset Comparison Summary</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left px-5 py-3 text-slate-500 font-medium w-36">Attribute</th>
                    {selected.map(ds => (
                      <th key={ds.id} className="text-left px-5 py-3 text-slate-300 font-medium">{ds.title.slice(0, 40)}…</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Cancer Type', ...selected.map(d => d.cancerType)],
                    ['Tissue', ...selected.map(d => d.tissue)],
                    ['Technique', ...selected.map(d => d.technique.split(' ')[0])],
                    ['Cells', ...selected.map(d => d.cellCount.toLocaleString())],
                    ['Samples', ...selected.map(d => String(d.sampleCount))],
                    ['Markers', ...selected.map(d => d.markers.join(', '))],
                    ['Cell Types', ...selected.map(d => d.cellTypes.join(', '))],
                    ['Contributor', ...selected.map(d => d.contributor)],
                    ['Institution', ...selected.map(d => d.institution)],
                    ['Date', ...selected.map(d => d.date)],
                  ].map(([label, ...vals]) => (
                    <tr key={label} className="border-b border-slate-800/50 hover:bg-slate-900/30">
                      <td className="px-5 py-2.5 text-slate-500">{label}</td>
                      {vals.map((v, i) => (
                        <td key={i} className="px-5 py-2.5 text-slate-300">{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
