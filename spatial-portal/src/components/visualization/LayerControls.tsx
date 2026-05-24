import { Eye, EyeOff } from 'lucide-react';
import type { Dataset } from '../../types';
import { useStore } from '../../store/useStore';
import clsx from 'clsx';

interface Props {
  dataset: Dataset;
  activeMarker: string;
  onMarkerChange: (m: string) => void;
}

export default function LayerControls({ dataset, activeMarker, onMarkerChange }: Props) {
  const { updateDatasetLayers } = useStore();

  const cellLayers = dataset.layers.filter(l => l.type === 'cell');
  const exprLayers = dataset.layers.filter(l => l.type === 'expression');

  return (
    <div className="space-y-5">
      {/* Cell Type Layers */}
      <div>
        <p className="section-heading">Cell Types</p>
        <div className="space-y-1.5">
          {cellLayers.map(layer => (
            <div key={layer.id} className="flex items-center gap-2">
              <button
                onClick={() => updateDatasetLayers(dataset.id, layer.id, !layer.visible)}
                className="flex items-center gap-2 flex-1 px-2.5 py-1.5 rounded-lg hover:bg-slate-800/60 transition-colors group"
              >
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: layer.color }} />
                <span className={clsx('text-xs flex-1 text-left', layer.visible ? 'text-slate-200' : 'text-slate-600')}>
                  {layer.name}
                </span>
                <span className={clsx('transition-colors', layer.visible ? 'text-slate-400' : 'text-slate-700')}>
                  {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Marker Expression */}
      {dataset.markers.length > 0 && (
        <div>
          <p className="section-heading">Marker Expression</p>
          <p className="text-[10px] text-slate-500 mb-2">Color cells by expression level</p>
          <div className="space-y-1">
            <button
              onClick={() => onMarkerChange('')}
              className={clsx(
                'w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors',
                !activeMarker ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-300'
              )}
            >
              — Cell type colors
            </button>
            {dataset.markers.map(m => (
              <button
                key={m}
                onClick={() => onMarkerChange(activeMarker === m ? '' : m)}
                className={clsx(
                  'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors',
                  activeMarker === m ? 'bg-brand-900 text-brand-300 border border-brand-700' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-300'
                )}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Expression layers toggle */}
          {exprLayers.length > 0 && (
            <div className="mt-3 space-y-1">
              {exprLayers.map(layer => (
                <div key={layer.id} className="flex items-center gap-2">
                  <button
                    onClick={() => updateDatasetLayers(dataset.id, layer.id, !layer.visible)}
                    className="flex items-center gap-2 flex-1 px-2.5 py-1.5 rounded-lg hover:bg-slate-800/60 transition-colors"
                  >
                    <div className="w-2 h-2 rounded-sm shrink-0" style={{ background: layer.color }} />
                    <span className={clsx('text-xs flex-1 text-left', layer.visible ? 'text-slate-200' : 'text-slate-600')}>
                      {layer.name}
                    </span>
                    {layer.visible ? <Eye size={12} className="text-slate-400" /> : <EyeOff size={12} className="text-slate-700" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Cell count summary */}
      <div>
        <p className="section-heading">Summary</p>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Total Cells</span>
            <span className="text-slate-200 font-mono">{dataset.cellCount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Samples</span>
            <span className="text-slate-200 font-mono">{dataset.sampleCount}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Cell Types</span>
            <span className="text-slate-200 font-mono">{dataset.cellTypes.length}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Markers</span>
            <span className="text-slate-200 font-mono">{dataset.markers.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
