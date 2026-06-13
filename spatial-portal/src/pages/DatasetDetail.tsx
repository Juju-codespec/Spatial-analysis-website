import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeft, Download, Share2, BookOpen, GitCompare,
  MessageSquare, ChevronRight, Users, Calendar,
  MapPin, ExternalLink, Send, Layers, BarChart2, Info,
  Activity, HeartPulse, Trash2
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { MOCK_COMMENTS } from '../data/mockData';
import SpatialPlot from '../components/visualization/SpatialPlot';
import CellTypeCountsPanel from '../components/visualization/CellTypeCountsPanel';
import { countCellTypes } from '../utils/cellCounts';
import HeatmapView from '../components/visualization/HeatmapView';
import LayerControls from '../components/visualization/LayerControls';
import SpatialStatsView from '../components/visualization/SpatialStatsView';
import SurvivalView from '../components/visualization/SurvivalView';
import DeleteDatasetDialog from '../components/dataset/DeleteDatasetDialog';
import { getDataset, getCells } from '../api/client';
import { canUserDeleteDataset } from '../utils/datasetOwnership';
import type { ApiDatasetDetail } from '../api/types';
import type { CellPoint, Dataset } from '../types';
import clsx from 'clsx';

type ViewTab = 'spatial' | 'heatmap' | 'stats' | 'survival';
type SideTab = 'layers' | 'metadata' | 'comments';

export default function DatasetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { datasets, toggleCompare, compareIds, currentUser, hydrateDatasetCells } = useStore();
  const dataset = datasets.find(d => d.id === id);
  const [apiDetail, setApiDetail] = useState<ApiDatasetDetail | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);

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
  const [selectedSample, setSelectedSample] = useState('');
  const [sampleCells, setSampleCells] = useState<CellPoint[] | null>(null);
  const [sampleCellTypeCounts, setSampleCellTypeCounts] = useState<Record<string, number> | null>(null);
  const [sampleCellsLoading, setSampleCellsLoading] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>('layers');
  const [comment, setComment] = useState('');
  const [localComments, setLocalComments] = useState(MOCK_COMMENTS.filter(c => c.datasetId === id));

  useEffect(() => {
    if (!id || !selectedSample) {
      setSampleCells(null);
      setSampleCellTypeCounts(null);
      return;
    }
    let cancelled = false;
    setSampleCellsLoading(true);
    getCells(id, { sample_id: selectedSample, downsample: 30000 })
      .then(res => {
        if (cancelled) return;
        setSampleCells(
          res.cells.map(c => ({
            x: c.x,
            y: c.y,
            cellType: c.cell_type,
            markers: {},
            sampleId: c.sample_id,
          })),
        );
        setSampleCellTypeCounts(
          res.cell_types ?? countCellTypes(res.cells.map(c => ({
            x: c.x,
            y: c.y,
            cellType: c.cell_type,
            markers: {},
          }))),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSampleCells(null);
          setSampleCellTypeCounts(null);
        }
      })
      .finally(() => { if (!cancelled) setSampleCellsLoading(false); });
    return () => { cancelled = true; };
  }, [id, selectedSample]);

  const plotDataset: Dataset | undefined = useMemo(() => {
    if (!dataset) return undefined;
    if (!sampleCells) return dataset;
    return { ...dataset, cells: sampleCells, cellCount: sampleCells.length };
  }, [dataset, sampleCells]);

  const spatialCellTypeCounts = useMemo(() => {
    if (!dataset) return {};
    if (selectedSample) {
      return sampleCellTypeCounts ?? (sampleCells ? countCellTypes(sampleCells) : {});
    }
    if (apiDetail?.cell_types && Object.keys(apiDetail.cell_types).length > 0) {
      return apiDetail.cell_types;
    }
    return countCellTypes(dataset.cells);
  }, [dataset, selectedSample, sampleCellTypeCounts, sampleCells, apiDetail]);

  const spatialCountsTitle = selectedSample
    ? `Cell types — ${selectedSample}`
    : 'Cell types — all samples';
  const spatialCountsSubtitle = selectedSample
    ? undefined
    : apiDetail?.cell_types
      ? 'full dataset'
      : dataset.cells.length < dataset.cellCount
        ? 'from displayed cells'
        : undefined;

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
  const deletable = canUserDeleteDataset(dataset, currentUser);

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
              <div className="space-y-3">
                {apiDetail && apiDetail.samples.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <label className="flex items-center gap-2">
                      <span className="text-slate-500">Sample / core</span>
                      <select
                        className="input text-xs min-w-[180px]"
                        value={selectedSample}
                        onChange={e => setSelectedSample(e.target.value)}
                      >
                        <option value="">All samples (downsampled)</option>
                        {apiDetail.samples.map(s => (
                          <option key={s.sample_id} value={s.sample_id}>
                            {s.sample_id} ({s.n_cells.toLocaleString()} cells)
                          </option>
                        ))}
                      </select>
                    </label>
                    {sampleCellsLoading && (
                      <span className="text-slate-500">Loading sample…</span>
                    )}
                    {selectedSample && sampleCells && !sampleCellsLoading && (
                      <span className="text-slate-600">
                        Showing {sampleCells.length.toLocaleString()} cells from {selectedSample}
                      </span>
                    )}
                  </div>
                )}
                <CellTypeCountsPanel
                  title={spatialCountsTitle}
                  counts={spatialCellTypeCounts}
                  layers={dataset.layers}
                  loading={!!selectedSample && sampleCellsLoading}
                  subtitle={spatialCountsSubtitle}
                />
                <SpatialPlot dataset={plotDataset ?? dataset} activeMarker={activeMarker} height={520} />
              </div>
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

            {deletable && (
              <div className="card p-5 mt-4 border-rose-900/40 bg-rose-950/10">
                <h3 className="text-sm font-semibold text-slate-200 mb-1">Manage your upload</h3>
                <p className="text-xs text-slate-500 mb-4">
                  Remove this dataset from Explore and delete it from the server cache.
                  Bundled demo datasets cannot be deleted.
                </p>
                <button
                  onClick={() => setPendingDelete(true)}
                  className="text-xs px-4 py-2 rounded-lg border border-rose-800/60 bg-rose-950/40 text-rose-400 hover:text-rose-300 hover:bg-rose-950/60 transition-colors flex items-center gap-1.5"
                >
                  <Trash2 size={13} /> Delete dataset
                </button>
              </div>
            )}
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

      <DeleteDatasetDialog
        dataset={pendingDelete ? dataset : null}
        onClose={() => setPendingDelete(false)}
        onDeleted={() => navigate('/explore')}
      />
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
