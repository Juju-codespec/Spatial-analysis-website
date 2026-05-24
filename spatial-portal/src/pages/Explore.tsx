import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, X, LayoutGrid, List, ChevronDown } from 'lucide-react';
import { useStore, useFilteredDatasets } from '../store/useStore';
import { CANCER_TYPES, TECHNIQUES, ALL_MARKERS } from '../data/mockData';
import DatasetCard from '../components/dataset/DatasetCard';
import clsx from 'clsx';

export default function Explore() {
  const [searchParams] = useSearchParams();
  const { filters, setFilters, resetFilters } = useStore();
  const datasets = useFilteredDatasets();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showFilters, setShowFilters] = useState(true);

  useEffect(() => {
    const q = searchParams.get('search');
    if (q) setFilters({ search: q });
  }, [searchParams]);

  const hasActiveFilters = Object.values(filters).some(v => v && v !== 'All');

  return (
    <div className="pt-14 min-h-screen">
      <div className="max-w-screen-xl mx-auto px-4 py-8">
        {/* Page header */}
        <div className="mb-8">
          <p className="section-heading">Dataset Library</p>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-slate-100">Explore Spatial Datasets</h1>
              <p className="text-sm text-slate-500 mt-1">Browse, filter, and open datasets into the interactive visualization viewer</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setViewMode('grid')} className={clsx('btn-ghost p-2', viewMode === 'grid' && 'text-brand-400 bg-brand-950')}>
                <LayoutGrid size={16} />
              </button>
              <button onClick={() => setViewMode('list')} className={clsx('btn-ghost p-2', viewMode === 'list' && 'text-brand-400 bg-brand-950')}>
                <List size={16} />
              </button>
              <button onClick={() => setShowFilters(!showFilters)} className="btn-secondary gap-2">
                <SlidersHorizontal size={14} />
                Filters
                {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />}
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-6">
          {/* Sidebar Filters */}
          {showFilters && (
            <aside className="w-56 shrink-0 animate-fade-in">
              <div className="card p-4 sticky top-20 space-y-5">
                {/* Search */}
                <div>
                  <p className="section-heading">Search</p>
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      placeholder="Keywords..."
                      value={filters.search}
                      onChange={e => setFilters({ search: e.target.value })}
                      className="input pl-8 text-xs"
                    />
                  </div>
                </div>

                {/* Cancer Type */}
                <FilterSelect label="Cancer Type" value={filters.cancerType} onChange={v => setFilters({ cancerType: v })} options={CANCER_TYPES} />

                {/* Technique */}
                <FilterSelect label="Technique" value={filters.technique} onChange={v => setFilters({ technique: v })} options={TECHNIQUES} />

                {/* Marker */}
                <div>
                  <p className="section-heading">Marker</p>
                  <div className="relative">
                    <select
                      value={filters.marker}
                      onChange={e => setFilters({ marker: e.target.value })}
                      className="input text-xs appearance-none pr-7"
                    >
                      <option value="">All Markers</option>
                      {ALL_MARKERS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                  </div>
                </div>

                {/* Reset */}
                {hasActiveFilters && (
                  <button onClick={resetFilters} className="w-full btn-ghost text-xs justify-center text-rose-400 hover:text-rose-300 hover:bg-rose-950/30">
                    <X size={12} /> Clear filters
                  </button>
                )}
              </div>
            </aside>
          )}

          {/* Results */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-4 text-xs text-slate-500">
              <span>{datasets.length} dataset{datasets.length !== 1 ? 's' : ''} found</span>
              {hasActiveFilters && (
                <button onClick={resetFilters} className="flex items-center gap-1 text-brand-400 hover:text-brand-300 transition-colors">
                  <X size={10} /> clear
                </button>
              )}
            </div>

            {datasets.length === 0 ? (
              <div className="card p-12 text-center">
                <p className="text-slate-500 text-sm mb-2">No datasets match your filters.</p>
                <button onClick={resetFilters} className="btn-secondary text-xs mt-2">Clear filters</button>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {datasets.map(ds => <DatasetCard key={ds.id} dataset={ds} />)}
              </div>
            ) : (
              <div className="space-y-3">
                {datasets.map(ds => <DatasetListRow key={ds.id} dataset={ds} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <p className="section-heading">{label}</p>
      <div className="relative">
        <select value={value} onChange={e => onChange(e.target.value)} className="input text-xs appearance-none pr-7">
          {options.map(o => <option key={o} value={o === 'All' ? '' : o}>{o}</option>)}
        </select>
        <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
      </div>
    </div>
  );
}

function DatasetListRow({ dataset }: { dataset: import('../types').Dataset }) {
  const { toggleCompare, compareIds } = useStore();
  const isInCompare = compareIds.includes(dataset.id);
  return (
    <div className="card p-4 hover:border-slate-700 transition-colors">
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <a href={`/dataset/${dataset.id}`} className="text-sm font-semibold text-slate-200 hover:text-brand-400 transition-colors line-clamp-1">{dataset.title}</a>
            <span className="tag text-[10px]">{dataset.cancerType}</span>
            <span className="tag-blue text-[10px]">{dataset.technique.split(' ')[0]}</span>
          </div>
          <p className="text-xs text-slate-500 line-clamp-2 mb-2">{dataset.description}</p>
          <div className="flex items-center gap-3 text-[11px] text-slate-600">
            <span>{dataset.contributor}</span>
            <span>·</span>
            <span>{dataset.institution}</span>
            <span>·</span>
            <span>{dataset.cellCount.toLocaleString()} cells</span>
            <span>·</span>
            <span>{new Date(dataset.date).getFullYear()}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a href={`/dataset/${dataset.id}`} className="btn-primary text-xs px-3 py-1.5">View</a>
          <button onClick={() => toggleCompare(dataset.id)} className={clsx('px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors', isInCompare ? 'bg-brand-900 border-brand-700 text-brand-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600')}>
            Compare
          </button>
        </div>
      </div>
    </div>
  );
}
