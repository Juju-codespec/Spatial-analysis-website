import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Upload, FileText, CheckCircle2, ChevronRight, ChevronLeft,
  AlertCircle, X, Columns, Tag, Eye, Lock, Loader2, Sparkles
} from 'lucide-react';
import { useStore } from '../store/useStore';
import type { Dataset, SpatialLayer } from '../types';
import { parseFile, detectFormat } from '../utils/cellParser';
import { uploadDataset, ApiError, getDataset, getCells } from '../api/client';
import clsx from 'clsx';

const STEPS = [
  { id: 1, label: 'Upload Files', icon: Upload },
  { id: 2, label: 'Map Columns', icon: Columns },
  { id: 3, label: 'Add Metadata', icon: Tag },
  { id: 4, label: 'Review & Submit', icon: Eye },
];

const ACCEPTED_TYPES = ['.csv', '.xlsx', '.geojson', '.json', '.tsv', '.rds'];
// Cap how many cells we keep in memory for client-side plotting. Mirrors the
// `downsample: 30000` used by the R API in useStore.hydrateDatasetCells so the
// SpatialPlot canvas never has to render hundreds of thousands of points.
const PLOT_CELL_CAP = 30000;
// Files larger than this are parsed on the R server only (avoids browser OOM).
const SERVER_PARSE_BYTES = 2 * 1024 * 1024;

function isDataFile(f: File): boolean {
  const n = f.name.toLowerCase();
  return n.endsWith('.rds') || n.endsWith('.csv') || n.endsWith('.tsv');
}

function isServerSideParse(f: File): boolean {
  return f.name.toLowerCase().endsWith('.rds') || f.size > SERVER_PARSE_BYTES;
}

function sampleEvenly<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  const out: T[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = arr[Math.floor(i * step)];
  return out;
}
const CANCER_TYPES_LIST = ['Lung (NSCLC)', 'Breast (ER+/HER2−)', 'Melanoma', 'Colorectal', 'Pancreatic (PDAC)', 'Ovarian', 'Prostate', 'Glioblastoma', 'Other'];
const TECHNIQUES_LIST = ['Multiplex IHC (mIHC)', 'Spatial Transcriptomics (10x Visium)', 'CODEX', 'Multiplex IF (Opal)', 'MERFISH', 'SLIDE-seq', 'Stereo-seq', 'Other'];

const CELL_TYPE_COLORS: Record<string, string> = {
  'Tumor': '#ef4444', 'CD8+ T Cell': '#3b82f6', 'CD4+ T Cell': '#8b5cf6',
  'Macrophage': '#f59e0b', 'NK Cell': '#10b981', 'B Cell': '#06b6d4',
  'Stromal': '#6b7280', 'CAF': '#f97316', 'Fibroblast': '#84cc16',
};
const FALLBACK_COLORS = ['#ef4444','#3b82f6','#8b5cf6','#f59e0b','#10b981','#06b6d4','#f97316','#84cc16','#ec4899','#6b7280'];

interface ColumnMap { x: string; y: string; cellType: string; markers: string[]; }
interface Metadata {
  title: string; description: string; cancerType: string; tissue: string;
  technique: string; markers: string; doi: string; methods: string; isPublic: boolean;
}


export default function UploadPage() {
  const { currentUser, addDataset, loadDatasets } = useStore();
  const [step, setStep] = useState(1);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isMultiPhenotype, setIsMultiPhenotype] = useState(false);
  const [detectedFileHeaders, setDetectedFileHeaders] = useState<string[]>([]);
  const [colMap, setColMap] = useState<ColumnMap>({ x: 'x_centroid', y: 'y_centroid', cellType: 'cell_type', markers: [] });
  const [meta, setMeta] = useState<Metadata>({
    title: '', description: '', cancerType: '', tissue: '', technique: '',
    markers: '', doi: '', methods: '', isPublic: true,
  });
  const [submitted, setSubmitted] = useState(false);
  const [parsedCellCount, setParsedCellCount] = useState<number>(0);
  const [parseError, setParseError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverDatasetId, setServerDatasetId] = useState<string | null>(null);
  const [serverWarning, setServerWarning] = useState<string | null>(null);

  // Auto-detect file format whenever the file list changes
  useEffect(() => {
    const textFile = files.find(f => f.name.endsWith('.csv') || f.name.endsWith('.tsv'));
    if (!textFile) { setIsMultiPhenotype(false); setDetectedFileHeaders([]); return; }
    textFile.text().then(text => {
      const sep = textFile.name.endsWith('.tsv') ? '\t' : ',';
      const firstLine = text.split(/\r?\n/)[0] ?? '';
      const headers = firstLine.split(sep).map(h => h.trim().replace(/^"|"$/g, ''));
      setDetectedFileHeaders(headers);
      const fmt = detectFormat(headers);
      setIsMultiPhenotype(fmt === 'multi-phenotype');
      if (fmt === 'multi-phenotype') {
        // Auto-fill coordinate columns from common position column names
        const xCol = headers.find(h => /cell_x|x_centroid|x_position|centroid_x/i.test(h)) ?? colMap.x;
        const yCol = headers.find(h => /cell_y|y_centroid|y_position|centroid_y/i.test(h)) ?? colMap.y;
        setColMap(prev => ({ ...prev, x: xCol, y: yCol }));
      }
    });
  }, [files]);

  if (!currentUser) {
    return (
      <div className="pt-14 min-h-screen flex items-center justify-center">
        <div className="card p-8 text-center max-w-sm">
          <Lock size={32} className="text-slate-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-slate-200 mb-2">Sign In Required</h2>
          <p className="text-sm text-slate-500 mb-5">You need to be signed in to contribute datasets.</p>
          <Link to="/login" className="btn-primary w-full justify-center">Sign In</Link>
        </div>
      </div>
    );
  }

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  const droppedFiles = Array.from(e.dataTransfer.files).filter(f => {
    const n = f.name.toLowerCase();
    return ACCEPTED_TYPES.some(ext => n.endsWith(ext));
  });
    setFiles(prev => [...prev, ...droppedFiles]);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    setFiles(prev => [...prev, ...selected]);
  };

  const validateStep = (): boolean => {
    const errs: Record<string, string> = {};
    if (step === 1 && files.length === 0) errs.files = 'Please upload at least one file.';
    if (step === 3) {
      if (!meta.title.trim()) errs.title = 'Title is required.';
      if (!meta.cancerType) errs.cancerType = 'Cancer type is required.';
      if (!meta.technique) errs.technique = 'Technique is required.';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => { if (validateStep()) setStep(s => Math.min(4, s + 1)); };
  const back = () => setStep(s => Math.max(1, s - 1));

  const handleSubmit = async () => {
    if (!validateStep()) return;
    setSubmitting(true);

    const markerList = meta.markers.split(',').map(m => m.trim()).filter(Boolean);
    setParseError(null);

    const dataFile = files.find(isDataFile);
    const rdsFile = files.find(f => f.name.toLowerCase().endsWith('.rds'));
    const textFile = files.find(f => f.name.endsWith('.csv') || f.name.endsWith('.tsv'));

    if (!dataFile) {
      setErrors({ submit: 'Please upload a CSV, TSV, or RDS (SpatialExperiment) file.' });
      setSubmitting(false);
      return;
    }

    const survivalFile = files.find(f =>
      /survival/i.test(f.name) && (f.name.endsWith('.csv') || f.name.endsWith('.tsv'))
    );

    let cells: import('../types').CellPoint[] = [];
    let cellCount = 0;
    let sampleCount = 1;
    let uniqueCellTypes: string[] = [];

    if (isServerSideParse(dataFile)) {
      // RDS and large CSV/TSV: parse on the R backend only.
      try {
        const resp = await uploadDataset(dataFile, {
          title: meta.title || undefined,
          cancer_type: meta.cancerType || undefined,
          tissue: meta.tissue || undefined,
          survival: survivalFile,
        });
        const detail = await getDataset(resp.id);
        const cellResp = await getCells(resp.id, { downsample: PLOT_CELL_CAP });
        cellCount = detail.meta.n_cells;
        sampleCount = detail.meta.sample_count;
        uniqueCellTypes = detail.meta.cell_types ?? Object.keys(detail.cell_types);
        cells = cellResp.cells.map(c => ({
          x: c.x,
          y: c.y,
          cellType: c.cell_type,
          markers: {},
        }));
        setParsedCellCount(cellCount);
        setServerDatasetId(resp.id);
        setServerWarning(null);
        void loadDatasets();

        const layers: SpatialLayer[] = uniqueCellTypes.map((ct, i) => ({
          id: `ct_${i}`,
          name: ct,
          type: 'cell' as const,
          cellType: ct,
          color: CELL_TYPE_COLORS[ct] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
          visible: true,
          opacity: 0.85,
        }));

        addDataset({
          id: resp.id,
          title: meta.title,
          description: meta.description,
          cancerType: meta.cancerType,
          tissue: meta.tissue,
          technique: meta.technique,
          markers: markerList,
          cellTypes: uniqueCellTypes,
          contributor: currentUser!.name,
          contributorId: currentUser!.id,
          institution: currentUser!.institution,
          date: new Date().toISOString().split('T')[0],
          isPublic: meta.isPublic,
          status: 'published',
          tags: [meta.cancerType, meta.technique].filter(Boolean),
          cellCount,
          sampleCount,
          doi: meta.doi || undefined,
          cells,
          layers,
          methods: meta.methods,
          dataSource: rdsFile ? 'RDS upload (SpatialExperiment)' : currentUser!.institution,
          viewCount: 0,
          downloads: 0,
        });
        setSubmitting(false);
        setSubmitted(true);
        return;
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : (e as Error).message;
        setParseError(msg);
        setSubmitting(false);
        return;
      }
    }

    if (!textFile) {
      setErrors({ submit: 'Please upload a CSV or TSV file containing your cell data.' });
      setSubmitting(false);
      return;
    }

    const parsed = await parseFile(textFile, colMap);

    if (parsed.error) {
      setParseError(parsed.error);
      setSubmitting(false);
      return;
    }

    cells = parsed.cells;
    setParsedCellCount(cells.length);
    uniqueCellTypes = [...new Set(cells.map(c => c.cellType))].filter(Boolean);
    const displayCells = sampleEvenly(cells, PLOT_CELL_CAP);

    const layers: SpatialLayer[] = uniqueCellTypes.map((ct, i) => ({
      id: `ct_${i}`,
      name: ct,
      type: 'cell' as const,
      cellType: ct,
      color: CELL_TYPE_COLORS[ct] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
      visible: true,
      opacity: 0.85,
    }));

    // Mirror the upload to the R backend so spatial stats & survival
    // analysis are available. Frontend fallback path keeps working even
    // if the backend is unreachable.
    let backendId: string | null = null;
    try {
      const survivalFile = files.find(f =>
        /survival/i.test(f.name) && (f.name.endsWith('.csv') || f.name.endsWith('.tsv'))
      );
      const resp = await uploadDataset(textFile, {
        title: meta.title || undefined,
        cancer_type: meta.cancerType || undefined,
        tissue: meta.tissue || undefined,
        survival: survivalFile,
      });
      backendId = resp.id;
      setServerWarning(null);
      // Refresh the dataset list so the new dataset shows up in Explore.
      void loadDatasets();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setServerWarning(`Saved locally only — backend unreachable: ${msg}`);
    }
    setServerDatasetId(backendId);

    const newDataset: Dataset = {
      id: backendId ?? `ds_${Date.now()}`,
      title: meta.title,
      description: meta.description,
      cancerType: meta.cancerType,
      tissue: meta.tissue,
      technique: meta.technique,
      markers: markerList,
      cellTypes: uniqueCellTypes,
      contributor: currentUser!.name,
      contributorId: currentUser!.id,
      institution: currentUser!.institution,
      date: new Date().toISOString().split('T')[0],
      isPublic: meta.isPublic,
      status: 'published',
      tags: [meta.cancerType, meta.technique].filter(Boolean),
      cellCount: cells.length,
      sampleCount: 1,
      doi: meta.doi || undefined,
      cells: displayCells,
      layers,
      methods: meta.methods,
      dataSource: currentUser!.institution,
      viewCount: 0,
      downloads: 0,
    };

    addDataset(newDataset);
    setSubmitting(false);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="pt-14 min-h-screen flex items-center justify-center">
        <div className="card p-10 text-center max-w-md animate-slide-up">
          <CheckCircle2 size={48} className="text-emerald-400 mx-auto mb-5" />
          <h2 className="text-xl font-bold text-slate-100 mb-2">Dataset Published!</h2>
          <p className="text-sm text-slate-400 mb-2">
            <strong className="text-slate-200">"{meta.title}"</strong> is now live in the public dataset library.
          </p>
          <p className="text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 rounded-lg px-3 py-2 mb-4">
            ✓ {parsedCellCount.toLocaleString()} cells parsed from your file — spatial map is ready.
          </p>
          {serverDatasetId && (
            <p className="text-xs text-brand-300 bg-brand-950/40 border border-brand-800/50 rounded-lg px-3 py-2 mb-4">
              Backend dataset id: <code className="text-brand-200">{serverDatasetId}</code> — Ripley K, NN G and Cox endpoints now available for this dataset.
            </p>
          )}
          {serverWarning && (
            <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-2 mb-4">
              {serverWarning}
            </p>
          )}
          <p className="text-xs text-slate-500 mb-7">You can browse it in Explore or manage it from your dashboard.</p>
          <div className="flex gap-3 justify-center">
            <Link to="/explore" className="btn-primary text-sm">Browse Datasets</Link>
            <Link to="/dashboard" className="btn-secondary text-sm">My Dashboard</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-14 min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="mb-8">
          <p className="section-heading">Contribute Data</p>
          <h1 className="text-2xl font-bold text-slate-100">Upload Spatial Dataset</h1>
          <p className="text-sm text-slate-500 mt-1">Share your spatial biology data with the research community in 4 guided steps.</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center flex-1">
              <div className="flex items-center gap-2">
                <div className={clsx('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors',
                  step > s.id ? 'bg-brand-600 border-brand-600 text-white' :
                  step === s.id ? 'border-brand-500 text-brand-400 bg-brand-950' :
                  'border-slate-700 text-slate-600 bg-slate-900'
                )}>
                  {step > s.id ? <CheckCircle2 size={16} /> : s.id}
                </div>
                <span className={clsx('text-xs font-medium hidden sm:block', step === s.id ? 'text-slate-200' : 'text-slate-600')}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={clsx('flex-1 h-px mx-3 transition-colors', step > s.id ? 'bg-brand-600' : 'bg-slate-800')} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="card p-6 min-h-80">
          {/* STEP 1: Upload */}
          {step === 1 && (
            <div>
              <h2 className="text-base font-semibold text-slate-200 mb-1">Upload Your Files</h2>
              <p className="text-xs text-slate-500 mb-5">
                Accepted formats: CSV, TSV, RDS (SpatialExperiment), Excel, GeoJSON. Max 500MB per file.
                Large files and <code className="text-brand-400">.rds</code> uploads are parsed on the server.
              </p>

              <div
                onDrop={handleFileDrop}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                className={clsx(
                  'border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer',
                  dragging ? 'border-brand-500 bg-brand-950/30' : 'border-slate-700 hover:border-slate-600 bg-slate-900/30'
                )}
                onClick={() => document.getElementById('file-input')?.click()}
              >
                <input id="file-input" type="file" multiple accept={ACCEPTED_TYPES.join(',')} className="hidden" onChange={handleFileInput} />
                <Upload size={28} className={clsx('mx-auto mb-3', dragging ? 'text-brand-400' : 'text-slate-500')} />
                <p className="text-sm text-slate-300 font-medium">Drop files here or click to browse</p>
                <p className="text-xs text-slate-600 mt-1">{ACCEPTED_TYPES.join(' · ')}</p>
              </div>

              {errors.files && <p className="text-xs text-rose-400 mt-2 flex items-center gap-1"><AlertCircle size={12} />{errors.files}</p>}

              {files.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold text-slate-400">{files.length} file{files.length > 1 ? 's' : ''} selected</p>
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
                      <FileText size={14} className="text-brand-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-200 truncate">{f.name}</p>
                        <p className="text-[10px] text-slate-600">{(f.size / 1024).toFixed(1)} KB</p>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setFiles(prev => prev.filter((_, j) => j !== i)); }} className="text-slate-600 hover:text-rose-400 transition-colors">
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* STEP 2: Map Columns */}
          {step === 2 && (
            <div>
              <h2 className="text-base font-semibold text-slate-200 mb-1">Map Your Columns</h2>
              {files.some(f => f.name.toLowerCase().endsWith('.rds')) ? (
                <div className="p-4 border border-brand-700/50 bg-brand-950/30 rounded-lg text-xs text-brand-300">
                  <p className="font-semibold mb-1">RDS detected</p>
                  <p className="text-brand-400/80">
                    Coordinates and cell types are extracted automatically on the server from
                    SpatialExperiment objects, portal dataset lists, or plain cell tables
                    (<code className="text-brand-300">x</code>, <code className="text-brand-300">y</code>, <code className="text-brand-300">cell_type</code>).
                    Continue to metadata — no column mapping needed.
                  </p>
                </div>
              ) : (
              <>
              <p className="text-xs text-slate-500 mb-4">Tell us which columns correspond to spatial coordinates and cell identifiers.</p>

              {isMultiPhenotype && (
                <div className="mb-4 p-3 border border-brand-700/50 bg-brand-950/30 rounded-lg text-xs text-brand-300 flex items-start gap-2">
                  <Sparkles size={13} className="shrink-0 mt-0.5 text-brand-400" />
                  <div>
                    <p className="font-semibold mb-0.5">Multi-phenotype format detected</p>
                    <p className="text-brand-400/80">
                      Your file uses <code className="text-brand-300">phenotype_*</code> columns (e.g. <code className="text-brand-300">phenotype_cd8</code>, <code className="text-brand-300">phenotype_ck</code>).
                      Cell types will be derived automatically — no cell type column needed.
                      Coordinate columns have been auto-filled below.
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-slate-400 block mb-1.5">X Coordinate Column *</label>
                    <input type="text" className="input text-xs" placeholder="e.g. x_centroid" value={colMap.x} onChange={e => setColMap(p => ({ ...p, x: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-400 block mb-1.5">Y Coordinate Column *</label>
                    <input type="text" className="input text-xs" placeholder="e.g. y_centroid" value={colMap.y} onChange={e => setColMap(p => ({ ...p, y: e.target.value }))} />
                  </div>
                </div>

                {!isMultiPhenotype && (
                  <div>
                    <label className="text-xs font-medium text-slate-400 block mb-1.5">Cell Type Column *</label>
                    <input type="text" className="input text-xs" placeholder="e.g. cell_type, phenotype" value={colMap.cellType} onChange={e => setColMap(p => ({ ...p, cellType: e.target.value }))} />
                  </div>
                )}

                {!isMultiPhenotype && (
                  <div>
                    <label className="text-xs font-medium text-slate-400 block mb-1.5">Marker/Expression Columns (comma separated)</label>
                    <input type="text" className="input text-xs" placeholder="e.g. CD8, PD-L1, Ki67, MART1" value={colMap.markers.join(', ')}
                      onChange={e => setColMap(p => ({ ...p, markers: e.target.value.split(',').map(m => m.trim()).filter(Boolean) }))} />
                  </div>
                )}
              </div>

              <div className="mt-5 p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
                <p className="text-xs font-semibold text-slate-400 mb-2">Preview mapping</p>
                <div className="flex gap-4 text-xs text-slate-500 flex-wrap">
                  <span>x → <code className="text-brand-400">{colMap.x}</code></span>
                  <span>y → <code className="text-brand-400">{colMap.y}</code></span>
                  {isMultiPhenotype
                    ? <span>cellType → <code className="text-brand-400">auto (phenotype_* columns)</code></span>
                    : <span>cellType → <code className="text-brand-400">{colMap.cellType}</code></span>
                  }
                  {!isMultiPhenotype && colMap.markers.length > 0 && (
                    <span>markers → <code className="text-brand-400">[{colMap.markers.join(', ')}]</code></span>
                  )}
                </div>
                {detectedFileHeaders.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-800">
                    <p className="text-[10px] text-slate-600">Detected headers: {detectedFileHeaders.slice(0, 10).join(', ')}{detectedFileHeaders.length > 10 ? `… +${detectedFileHeaders.length - 10} more` : ''}</p>
                  </div>
                )}
              </div>
              </>
              )}
            </div>
          )}

          {/* STEP 3: Metadata */}
          {step === 3 && (
            <div>
              <h2 className="text-base font-semibold text-slate-200 mb-1">Add Metadata</h2>
              <p className="text-xs text-slate-500 mb-5">Help others discover and understand your dataset.</p>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1.5">Dataset Title *</label>
                  <input type="text" className={clsx('input text-sm', errors.title && 'border-rose-600 ring-rose-600/30')}
                    placeholder="e.g. Lung Cancer TME – PD-L1 Spatial Atlas"
                    value={meta.title} onChange={e => setMeta(p => ({ ...p, title: e.target.value }))} />
                  {errors.title && <p className="text-xs text-rose-400 mt-1 flex items-center gap-1"><AlertCircle size={11} />{errors.title}</p>}
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1.5">Description</label>
                  <textarea rows={3} className="input text-xs resize-none"
                    placeholder="Brief description of the study, cohort, and biological question..."
                    value={meta.description} onChange={e => setMeta(p => ({ ...p, description: e.target.value }))} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-slate-400 block mb-1.5">Cancer Type *</label>
                    <select className={clsx('input text-xs', errors.cancerType && 'border-rose-600')} value={meta.cancerType} onChange={e => setMeta(p => ({ ...p, cancerType: e.target.value }))}>
                      <option value="">Select...</option>
                      {CANCER_TYPES_LIST.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    {errors.cancerType && <p className="text-xs text-rose-400 mt-1">{errors.cancerType}</p>}
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-400 block mb-1.5">Tissue</label>
                    <input type="text" className="input text-xs" placeholder="e.g. Lung, Breast, Skin" value={meta.tissue} onChange={e => setMeta(p => ({ ...p, tissue: e.target.value }))} />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1.5">Technique *</label>
                  <select className={clsx('input text-xs', errors.technique && 'border-rose-600')} value={meta.technique} onChange={e => setMeta(p => ({ ...p, technique: e.target.value }))}>
                    <option value="">Select...</option>
                    {TECHNIQUES_LIST.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {errors.technique && <p className="text-xs text-rose-400 mt-1">{errors.technique}</p>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-slate-400 block mb-1.5">Markers (comma separated)</label>
                    <input type="text" className="input text-xs" placeholder="CD8, PD-L1, Ki67..." value={meta.markers} onChange={e => setMeta(p => ({ ...p, markers: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-400 block mb-1.5">DOI (optional)</label>
                    <input type="text" className="input text-xs" placeholder="10.xxxx/..." value={meta.doi} onChange={e => setMeta(p => ({ ...p, doi: e.target.value }))} />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1.5">Methods Summary</label>
                  <textarea rows={2} className="input text-xs resize-none"
                    placeholder="Briefly describe experimental and analysis methods..."
                    value={meta.methods} onChange={e => setMeta(p => ({ ...p, methods: e.target.value }))} />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-2">Visibility</label>
                  <div className="flex gap-3">
                    <button onClick={() => setMeta(p => ({ ...p, isPublic: true }))} className={clsx('flex-1 py-2.5 rounded-lg border text-xs font-medium transition-colors', meta.isPublic ? 'bg-brand-900 border-brand-600 text-brand-300' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-600')}>
                      Public
                    </button>
                    <button onClick={() => setMeta(p => ({ ...p, isPublic: false }))} className={clsx('flex-1 py-2.5 rounded-lg border text-xs font-medium transition-colors', !meta.isPublic ? 'bg-slate-800 border-slate-500 text-slate-200' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-600')}>
                      Private
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Review */}
          {step === 4 && (
            <div>
              <h2 className="text-base font-semibold text-slate-200 mb-1">Review & Submit</h2>
              <p className="text-xs text-slate-500 mb-5">Confirm your submission details before publishing.</p>

              <div className="space-y-4">
                <ReviewBlock label="Files">
                  {files.map(f => (
                    <p key={f.name} className="text-xs text-slate-300">
                      {f.name} <span className="text-slate-600">({(f.size / 1024).toFixed(1)} KB)</span>
                    </p>
                  ))}
                </ReviewBlock>

                <ReviewBlock label="Column Mapping">
                  <div className="flex gap-4 flex-wrap text-xs text-slate-400">
                    <span>x: <code className="text-brand-400">{colMap.x}</code></span>
                    <span>y: <code className="text-brand-400">{colMap.y}</code></span>
                    <span>cell type: <code className="text-brand-400">{colMap.cellType}</code></span>
                  </div>
                </ReviewBlock>

                <ReviewBlock label="Dataset Info">
                  <div className="space-y-1 text-xs text-slate-400">
                    <div><span className="text-slate-600">Title: </span><span className="text-slate-200">{meta.title || '—'}</span></div>
                    <div><span className="text-slate-600">Cancer Type: </span><span>{meta.cancerType || '—'}</span></div>
                    <div><span className="text-slate-600">Technique: </span><span>{meta.technique || '—'}</span></div>
                    <div><span className="text-slate-600">Markers: </span><span>{meta.markers || '—'}</span></div>
                    <div><span className="text-slate-600">Visibility: </span><span>{meta.isPublic ? 'Public' : 'Private'}</span></div>
                  </div>
                </ReviewBlock>

                <div className="p-3 border border-amber-800/50 bg-amber-950/20 rounded-lg text-xs text-amber-400/80 flex items-start gap-2">
                  <AlertCircle size={13} className="shrink-0 mt-0.5" />
                  <span>By submitting, you confirm this data is de-identified, anonymized, and approved for sharing under your institution's IRB guidelines.</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Parse error banner — shown after a failed submit attempt */}
        {parseError && (
          <div className="mt-4 p-3 border border-rose-700/60 bg-rose-950/30 rounded-lg text-xs text-rose-300 flex items-start gap-2">
            <AlertCircle size={13} className="shrink-0 mt-0.5 text-rose-400" />
            <div>
              <p className="font-semibold mb-0.5">Could not parse cell data</p>
              <p className="text-rose-400/80">{parseError}</p>
              <p className="mt-1.5 text-rose-500">Go back to Step 2 and update your column names to match the headers in your file.</p>
            </div>
          </div>
        )}
        {errors.submit && (
          <div className="mt-4 p-3 border border-rose-700/60 bg-rose-950/30 rounded-lg text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle size={13} className="text-rose-400" />
            {errors.submit}
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-4">
          <button onClick={back} disabled={step === 1} className="btn-secondary text-sm disabled:opacity-40">
            <ChevronLeft size={15} /> Back
          </button>
          {step < 4 ? (
            <button onClick={next} className="btn-primary text-sm">
              Continue <ChevronRight size={15} />
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={submitting} className="btn-primary text-sm px-6 disabled:opacity-60">
              {submitting
                ? <><Loader2 size={15} className="animate-spin" /> Processing…</>
                : <><CheckCircle2 size={15} /> Submit Dataset</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">{label}</p>
      {children}
    </div>
  );
}
