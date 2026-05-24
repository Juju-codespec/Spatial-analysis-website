import { create } from 'zustand';
import type { User, Dataset, FilterState, CellPoint, SpatialLayer } from '../types';
import { MOCK_USERS, MOCK_DATASETS } from '../data/mockData';
import { getDatasets, getCells, getDataset, deleteDataset as apiDeleteDataset, ApiError } from '../api/client';
import type { ApiDatasetMeta } from '../api/types';

interface AppState {
  currentUser: User | null;
  datasets: Dataset[];
  filters: FilterState;
  compareIds: string[];
  apiStatus: 'idle' | 'loading' | 'online' | 'offline';
  apiError: string | null;
  login: (email: string, _password: string) => boolean;
  logout: () => void;
  setFilters: (f: Partial<FilterState>) => void;
  resetFilters: () => void;
  toggleCompare: (id: string) => void;
  updateDatasetLayers: (datasetId: string, layerId: string, visible: boolean) => void;
  addDataset: (dataset: Dataset) => void;
  /**
   * Remove a dataset from the local list and (best-effort) delete it on the
   * R backend. Always removes locally so the UI updates immediately; backend
   * errors other than 404 are surfaced to the caller.
   */
  removeDataset: (id: string) => Promise<void>;
  loadDatasets: () => Promise<void>;
  hydrateDatasetCells: (id: string) => Promise<void>;
}

const DEFAULT_FILTERS: FilterState = {
  search: '', cancerType: '', technique: '', marker: '', dateRange: '', contributor: '',
};

const CELL_TYPE_COLORS: Record<string, string> = {
  'Tumor':        '#ef4444',
  'CD8+ T Cell':  '#3b82f6',
  'CD4+ T Cell':  '#8b5cf6',
  'T Cell':       '#60a5fa',
  'Macrophage':   '#f59e0b',
  'NK Cell':      '#10b981',
  'B Cell':       '#06b6d4',
  'Stromal':      '#6b7280',
  'CAF':          '#f97316',
  'Fibroblast':   '#84cc16',
  'Other':        '#94a3b8',
};
const FALLBACK_COLORS = ['#ef4444','#3b82f6','#8b5cf6','#f59e0b','#10b981','#06b6d4','#f97316','#84cc16','#ec4899','#6b7280'];

export const useStore = create<AppState>((set, get) => ({
  currentUser: null,
  datasets: MOCK_DATASETS,
  filters: DEFAULT_FILTERS,
  compareIds: [],
  apiStatus: 'idle',
  apiError: null,

  login: (email, password) => {
    void password;
    const user = MOCK_USERS.find(u => u.email === email);
    if (user) { set({ currentUser: user }); return true; }
    return false;
  },

  logout: () => set({ currentUser: null }),

  setFilters: (f) => set(s => ({ filters: { ...s.filters, ...f } })),

  resetFilters: () => set({ filters: DEFAULT_FILTERS }),

  toggleCompare: (id) => set(s => {
    const ids = s.compareIds;
    if (ids.includes(id)) return { compareIds: ids.filter(i => i !== id) };
    if (ids.length >= 2) return { compareIds: [ids[1], id] };
    return { compareIds: [...ids, id] };
  }),

  updateDatasetLayers: (datasetId, layerId, visible) => set(s => ({
    datasets: s.datasets.map(ds =>
      ds.id !== datasetId ? ds : {
        ...ds,
        layers: ds.layers.map(l => l.id === layerId ? { ...l, visible } : l),
      }
    ),
  })),

  addDataset: (dataset) => set(s => ({ datasets: [...s.datasets, dataset] })),

  removeDataset: async (id) => {
    // Drop from compare list and the dataset list first so the UI feels
    // instant; if the API call later fails we surface the error to the
    // caller but don't try to restore the deleted entry.
    set(s => ({
      datasets:   s.datasets.filter(d => d.id !== id),
      compareIds: s.compareIds.filter(c => c !== id),
    }));
    try {
      await apiDeleteDataset(id);
    } catch (e) {
      // 404 is fine — dataset was local-only and never reached the backend.
      if (e instanceof ApiError && e.status === 404) return;
      throw e;
    }
  },

  // Fetch the canonical dataset list from the R API and merge with mocks.
  // On failure we keep the mocks visible so the UI never goes blank.
  loadDatasets: async () => {
    set({ apiStatus: 'loading', apiError: null });
    const prev = get().datasets;
    const mockIds = new Set(MOCK_DATASETS.map(d => d.id));
    try {
      const apiDatasets = await getDatasets();
      const mapped = apiDatasets.map(toFrontendDataset);
      const apiIds = new Set(mapped.map(d => d.id));
      // For API datasets that came from the "upload" source, prefer the
      // local contributor metadata if we have it so they appear under
      // "My Datasets" on the Dashboard.
      const enriched = mapped.map(api => {
        if (api.contributorId !== 'upload') return api;
        const local = prev.find(d => d.id === api.id);
        if (!local) return api;
        return {
          ...api,
          title:         local.title || api.title,
          description:   local.description || api.description,
          contributor:   local.contributor,
          contributorId: local.contributorId,
          institution:   local.institution,
        };
      });
      const mockKept = MOCK_DATASETS.filter(d => !apiIds.has(d.id));
      // Preserve any local user uploads that didn't make it to the backend
      // (e.g. API was offline at upload time) so the user can still see and
      // delete them.
      const localKept = prev.filter(d => !apiIds.has(d.id) && !mockIds.has(d.id));
      set({
        datasets: [...enriched, ...localKept, ...mockKept],
        apiStatus: 'online',
        apiError: null,
      });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      set({ apiStatus: 'offline', apiError: msg });
    }
  },

  // Lazy-load the cells for one API-backed dataset (mock datasets already
  // ship with cells in memory). Called by DatasetDetail before plotting.
  hydrateDatasetCells: async (id: string) => {
    const ds = get().datasets.find(d => d.id === id);
    if (!ds) return;
    // Mock datasets are pre-hydrated; only fetch for API datasets that
    // currently have an empty cells array.
    if (ds.cells.length > 0) return;
    try {
      const [detail, cells] = await Promise.all([
        getDataset(id),
        getCells(id, { downsample: 30000 }),
      ]);
      const points: CellPoint[] = cells.cells.map(c => ({
        x: c.x,
        y: c.y,
        cellType: c.cell_type,
        markers: {},
      }));
      const layers = buildLayersFromCellTypes(Object.keys(detail.cell_types));
      set(state => ({
        datasets: state.datasets.map(d => d.id === id
          ? { ...d, cells: points, layers, cellCount: detail.meta.n_cells, sampleCount: detail.meta.sample_count }
          : d),
      }));
    } catch {
      // Leave dataset un-hydrated; UI will fall back to the empty state.
    }
  },
}));

export const useFilteredDatasets = () => {
  const { datasets, filters } = useStore();
  return datasets.filter(ds => {
    if (filters.search && !ds.title.toLowerCase().includes(filters.search.toLowerCase()) &&
        !ds.description.toLowerCase().includes(filters.search.toLowerCase()) &&
        !ds.tags.some(t => t.toLowerCase().includes(filters.search.toLowerCase()))) return false;
    if (filters.cancerType && filters.cancerType !== 'All' && ds.cancerType !== filters.cancerType) return false;
    if (filters.technique && filters.technique !== 'All' && ds.technique !== filters.technique) return false;
    if (filters.marker && !ds.markers.includes(filters.marker)) return false;
    return true;
  });
};

// ---- API <-> frontend type bridges ----------------------------------------

function toFrontendDataset(meta: ApiDatasetMeta): Dataset {
  return {
    id:           meta.id,
    title:        meta.title,
    description:  meta.cancer_type
      ? `${meta.title}. ${meta.n_cells.toLocaleString?.() ?? meta.n_cells} cells across ${meta.sample_count} samples.`
      : meta.title,
    cancerType:   meta.cancer_type ?? 'Unknown',
    tissue:       meta.tissue ?? '',
    technique:    meta.source === 'vpd' ? 'Vectra Polaris (mIF)' : 'Uploaded multiplex IF',
    markers:      [],
    cellTypes:    meta.cell_types ?? [],
    contributor:  meta.source === 'vpd' ? 'VectraPolarisData' : 'You',
    contributorId: meta.source,
    institution:  meta.source === 'vpd' ? 'Bioconductor' : 'Local upload',
    date:         meta.created_at ?? new Date().toISOString().split('T')[0],
    isPublic:     true,
    status:       'published',
    tags:         [meta.cancer_type ?? '', meta.tissue ?? ''].filter(Boolean) as string[],
    cellCount:    meta.n_cells ?? 0,
    sampleCount:  meta.sample_count ?? 0,
    cells:        [], // hydrated on demand via hydrateDatasetCells()
    layers:       buildLayersFromCellTypes(meta.cell_types ?? []),
    methods:      'Per-sample Ripley\'s K and Nearest Neighbour G computed via spatstat; Cox PH against patient survival.',
    dataSource:   meta.source === 'vpd' ? 'VectraPolarisData (Bioconductor)' : 'User upload',
    viewCount:    0,
    downloads:    0,
  };
}

function buildLayersFromCellTypes(cellTypes: string[]): SpatialLayer[] {
  return cellTypes.map((ct, i) => ({
    id:       `ct_${i}`,
    name:     ct,
    type:     'cell',
    cellType: ct,
    color:    CELL_TYPE_COLORS[ct] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
    visible:  true,
    opacity:  0.85,
  }));
}
