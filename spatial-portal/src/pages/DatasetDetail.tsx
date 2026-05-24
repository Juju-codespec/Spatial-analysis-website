import { useParams, Link } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Download, Share2, BookOpen, GitCompare,
  MessageSquare, ChevronRight, Users, Calendar,
  MapPin, ExternalLink, Send, Layers, BarChart2, Info,
  Activity, HeartPulse
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { MOCK_COMMENTS } from '../data/mockData';
import SpatialPlot from '../components/visualization/SpatialPlot';
import HeatmapView from '../components/visualization/HeatmapView';
import LayerControls from '../components/visualization/LayerControls';
import SpatialStatsView from '../components/visualization/SpatialStatsView';
import SurvivalView from '../components/visualization/SurvivalView';
import { getDataset } from '../api/client';
import type { ApiDatasetDetail } from '../api/types';
import clsx from 'clsx';

type ViewTab = 'spatial' | 'heatmap' | 'stats' | 'survival';
type SideTab = 'layers' | 'metadata' | 'comments';

export default function DatasetDetail() {
  const { id } = useParams<{ id: string }>();
  const { datasets, toggleCompare, compareIds, currentUser, hydrateDatasetCells } = useStore();
  const dataset = datasets.find(d => d.id === id);
  const [apiDetail, setApiDetail] = useState<ApiDatasetDetail | null>(null);

  const refreshDetail = useCallback(() => {
    if (!id) return;
    getDataset(id).then(setApiDetail).catch(() => setApiDetail(null));
  }, [id]);

  // Hydrate cells from the R API on first view if the dataset came from
  // /datasets and hasn't been visualised yet.
  useEffect(() => {
    if (!id) return;
    void hydrateDatasetCells(id);
    // Pull the detail payload (samples list, has_survival, cell-type counts)
    // separately from cells so the new tabs always know whether survival
    // analysis is available even before any spatial map is rendered.
    refreshDetail();
  }, [id, hydrateDatasetCells, refreshDetail]);

  const [activeMarker, setActiveMarker] = useState('');
  const [viewTab, setViewTab] = useState<ViewTab>('spatial');
  const [sideTab, setSideTab] = useState<SideTab>('layers');
  const [comment, setComment] = useState('');
  const [localComments, setLocalComments] = useState(MOCK_COMMENTS.filter(c => c.datasetId === id));

  if (!dataset) {
    return (
      <div className="pt-14 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-400 mb-4">Dataset not found.</p>
          <Link to="/explore" className="btn-primary">Back to Explore</Link>
        </div>
      </div>
    );
  }

  const isInCompare = compareIds.includes(dataset.id);

  const handleComment = () => {
    if (!comment.trim() || !currentUser) return;
    setLocalComments(prev => [...prev, {
      id: `c_${Date.now()}`,
      datasetId: dataset.id,
      userId: currentUser.id,
      userName: currentUser.name,
      text: comment.trim(),
      createdAt: new Date().toISOString().split('T')[0],
    }]);
    setComment('');
  };

  return (
    <div className="pt-14 min-h-screen">
      {/* Breadcrumb + title bar */}
      <div className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm sticky top-14 z-30">
        <div className="max-w-screen-xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <Link to="/explore" className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors shrink-0">
            <ArrowLeft size={12} /> Datasets
          </Link>
          <ChevronRight size={12} className="text-slate-700 shrink-0" />
          <span className="text-xs text-slate-400 truncate flex-1 min-w-0">{dataset.title}</span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => toggleCompare(dataset.id)}
              className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors',
                isInCompare ? 'bg-brand-900 border-brand-700 text-brand-300' : 'btn-ghost')}
            >
              <GitCompare size={13} /> {isInCompare ? 'In Compare' : 'Compare'}
            </button>
            <button className="btn-ghost text-xs"><Share2 size={13} /> Share</button>
            <button className="btn-secondary text-xs"><Download size={13} /> Download</button>
          </div>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-4 py-6">
        {/* Title section */}
        <div className="mb-6">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1">
              <h1 className="text-xl font-bold text-slate-100 leading-tight mb-2">{dataset.title}</h1>
              <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500">
                <span className="flex items-center gap-1"><Users size={11} />{dataset.contributor}</span>
                <span>·</span>
                <span>{dataset.institution}</span>
                <span>·</span>
                <span className="flex items-center gap-1"><Calendar size={11} />{new Date(dataset.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}</span>
                {dataset.doi && (
                  <>
                    <span>·</span>
                    <a href={`https://doi.org/${dataset.doi}`} target="_blank" rel="noopener noreferrer"
                       className="flex items-center gap-1 text-brand-400 hover:text-brand-300 transition-colors">
                      <BookOpen size={11} /> {dataset.publication} <ExternalLink size={10} />
                    </a>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-500 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2">
              <div className="text-center"><div className="text-lg font-bold text-slate-200">{(dataset.cellCount / 1000).toFixed(1)}k</div><div>Cells</div></div>
              <div className="w-px h-8 bg-slate-800" />
              <div className="text-center"><div className="text-lg font-bold text-slate-200">{dataset.sampleCount}</div><div>Samples</div></div>
              <div className="w-px h-8 bg-slate-800" />
              <div className="text-center"><div className="text-lg font-bold text-slate-200">{dataset.viewCount.toLocaleString()}</div><div>Views</div></div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="tag">{dataset.cancerType}</span>
            <span className="tag-blue">{dataset.technique.split(' ')[0]}</span>
            {dataset.tags.map(t => <span key={t} className="tag text-[10px]">{t}</span>)}
          </div>
        </div>

        {/* Main viewer layout */}
        <div className="flex gap-4">
          {/* Visualization panel */}
          <div className="flex-1 min-w-0">
            {/* View mode tabs */}
            <div className="flex items-center gap-1 mb-3 border-b border-slate-800 pb-3 flex-wrap">
              <button onClick={() => setViewTab('spatial')} className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                viewTab === 'spatial' ? 'bg-slate-800 text-slate-100' : 'text-slate-500 hover:text-slate-300')}>
                <Layers size={13} /> Spatial Map
              </button>
              <button onClick={() => setViewTab('heatmap')} className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                viewTab === 'heatmap' ? 'bg-slate-800 text-slate-100' : 'text-slate-500 hover:text-slate-300')}>
                <BarChart2 size={13} /> Expression Heatmap
              </button>
              <button onClick={() => setViewTab('stats')} className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                viewTab === 'stats' ? 'bg-slate-800 text-slate-100' : 'text-slate-500 hover:text-slate-300')}>
                <Activity size={13} /> Spatial Stats
              </button>
              <button onClick={() => setViewTab('survival')} className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                viewTab === 'survival' ? 'bg-slate-800 text-slate-100' : 'text-slate-500 hover:text-slate-300')}>
                <HeartPulse size={13} /> Survival
              </button>
            </div>

            {viewTab === 'spatial' && (
              <SpatialPlot dataset={dataset} activeMarker={activeMarker} height={520} />
            )}

            {viewTab === 'heatmap' && (
              <div className="card p-5">
                <p className="text-xs font-semibold text-slate-300 mb-4">Mean Marker Expression per Cell Type</p>
                <HeatmapView dataset={dataset} />
              </div>
            )}

            {viewTab === 'stats' && (
              <SpatialStatsView
                datasetId={dataset.id}
                availableCellTypes={apiDetail ? Object.keys(apiDetail.cell_types) : dataset.cellTypes}
              />
            )}

            {viewTab === 'survival' && (
              <SurvivalView
                datasetId={dataset.id}
                availableCellTypes={apiDetail ? Object.keys(apiDetail.cell_types) : dataset.cellTypes}
                hasSurvival={apiDetail?.has_survival ?? false}
                onSurvivalAttached={refreshDetail}
              />
            )}

            {/* Description */}
            <div className="card p-5 mt-4">
              <h3 className="text-sm font-semibold text-slate-200 mb-2">About this Dataset</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{dataset.description}</p>
            </div>
          </div>

          {/* Right sidebar */}
          <aside className="w-60 shrink-0">
            {/* Side tabs */}
            <div className="flex border-b border-slate-800 mb-4">
              {([['layers', <Layers size={12} />, 'Layers'], ['metadata', <Info size={12} />, 'Info'], ['comments', <MessageSquare size={12} />, `Notes (${localComments.length})`]] as const).map(([tab, icon, label]) => (
                <button key={tab} onClick={() => setSideTab(tab as SideTab)}
                  className={clsx('flex items-center gap-1 px-2.5 py-2 text-[11px] font-medium border-b-2 transition-colors -mb-px',
                    sideTab === tab ? 'border-brand-500 text-brand-400' : 'border-transparent text-slate-500 hover:text-slate-300')}>
                  {icon} {label}
                </button>
              ))}
            </div>

            {sideTab === 'layers' && (
              <LayerControls dataset={dataset} activeMarker={activeMarker} onMarkerChange={setActiveMarker} />
            )}

            {sideTab === 'metadata' && (
              <div className="space-y-4 text-xs">
                <MetaSection title="Study Details">
                  <MetaRow label="Cancer Type" value={dataset.cancerType} />
                  <MetaRow label="Tissue" value={dataset.tissue} />
                  <MetaRow label="Technique" value={dataset.technique} />
                  <MetaRow label="Date" value={new Date(dataset.date).toLocaleDateString()} />
                  <MetaRow label="Status" value={dataset.status} />
                </MetaSection>
                <MetaSection title="Methods">
                  <p className="text-slate-500 leading-relaxed text-[11px]">{dataset.methods}</p>
                </MetaSection>
                <MetaSection title="Data Source">
                  <p className="text-slate-500 leading-relaxed text-[11px]">{dataset.dataSource}</p>
                </MetaSection>
                {dataset.doi && (
                  <MetaSection title="Publication">
                    <a href={`https://doi.org/${dataset.doi}`} target="_blank" rel="noopener noreferrer"
                       className="text-brand-400 hover:text-brand-300 text-[11px] flex items-center gap-1">
                      {dataset.publication} <ExternalLink size={10} />
                    </a>
                  </MetaSection>
                )}
                {dataset.region && (
                  <MetaSection title="Institution Location">
                    <div className="flex items-center gap-1.5 text-slate-500">
                      <MapPin size={11} />
                      <span className="text-[11px]">{dataset.region.name}</span>
                    </div>
                  </MetaSection>
                )}
              </div>
            )}

            {sideTab === 'comments' && (
              <div className="space-y-3">
                {localComments.length === 0 && (
                  <p className="text-xs text-slate-600 text-center py-4">No comments yet.</p>
                )}
                {localComments.map(c => (
                  <div key={c.id} className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-5 h-5 rounded-full bg-brand-800 flex items-center justify-center text-[9px] font-bold text-brand-300">
                        {c.userName[0]}
                      </div>
                      <span className="text-[11px] font-medium text-slate-300 truncate">{c.userName}</span>
                      <span className="text-[10px] text-slate-600 ml-auto shrink-0">{c.createdAt}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">{c.text}</p>
                  </div>
                ))}
                {currentUser ? (
                  <div className="mt-3">
                    <textarea
                      value={comment}
                      onChange={e => setComment(e.target.value)}
                      placeholder="Add a note..."
                      rows={3}
                      className="input text-xs resize-none"
                    />
                    <button onClick={handleComment} disabled={!comment.trim()} className="btn-primary w-full mt-2 text-xs justify-center py-1.5 disabled:opacity-50">
                      <Send size={12} /> Post Note
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-600 text-center py-2">
                    <Link to="/login" className="text-brand-400 hover:text-brand-300">Sign in</Link> to add notes.
                  </p>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function MetaSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="section-heading">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-slate-600 shrink-0 w-20">{label}</span>
      <span className="text-slate-300 capitalize flex-1">{value}</span>
    </div>
  );
}
