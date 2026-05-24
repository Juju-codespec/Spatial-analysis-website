import { Link } from 'react-router-dom';
import { ArrowRight, Layers, Search, Upload, Database, BarChart3, ChevronRight } from 'lucide-react';
import { MOCK_DATASETS } from '../data/mockData';
import DatasetCard from '../components/dataset/DatasetCard';
import SpatialPlot from '../components/visualization/SpatialPlot';
import { useState } from 'react';

const STATS = [
  { value: '5', label: 'Datasets', sub: 'publicly available' },
  { value: '9K+', label: 'Cells Mapped', sub: 'across all studies' },
  { value: '5', label: 'Cancer Types', sub: 'represented' },
  { value: '5', label: 'Institutions', sub: 'contributing' },
];

const FEATURES = [
  { icon: Layers, title: 'Spatial Visualization', desc: 'Interactive cell-level tissue maps with toggleable cell type layers, marker expression overlays, and zoom-to-region capabilities.' },
  { icon: Search, title: 'Dataset Explorer', desc: 'Browse and filter datasets by cancer type, technique, marker panel, or institution. Open any dataset into the full visualization viewer.' },
  { icon: BarChart3, title: 'Side-by-Side Comparison', desc: 'Compare two datasets simultaneously. Toggle markers in sync and examine spatial differences across studies or treatment conditions.' },
  { icon: Upload, title: 'Contribute Data', desc: 'Guided upload portal for submitting spatial datasets. Map your columns, add metadata, and auto-format data for visualization.' },
];

export default function Home() {
  const featured = MOCK_DATASETS.slice(0, 3);
  const [heroDataset] = useState(MOCK_DATASETS[0]);
  const [heroMarker, setHeroMarker] = useState('');

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative pt-20 pb-0 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-brand-950/20 via-transparent to-transparent pointer-events-none" />

        <div className="max-w-screen-xl mx-auto px-4 pt-12 pb-0">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left: text */}
            <div className="animate-slide-up">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-950 border border-brand-800 text-brand-400 text-xs font-medium mb-6">
                <div className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
                Open Spatial Biology Research Portal
              </div>
              <h1 className="text-4xl md:text-5xl font-bold text-slate-100 leading-tight tracking-tight mb-5">
                Explore spatial tumor<br />
                <span className="text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(135deg, #598bff 0%, #a78bfa 100%)' }}>
                  microenvironment data
                </span>
              </h1>
              <p className="text-slate-400 text-base leading-relaxed mb-8 max-w-lg">
                An interactive research platform for visualizing, contributing, and comparing spatial biology datasets.
                Explore cell distributions, marker expression, and immune architecture across cancer types.
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <Link to="/explore" className="btn-primary px-5 py-2.5 text-sm">
                  Browse Datasets <ArrowRight size={15} />
                </Link>
                <Link to="/upload" className="btn-secondary px-5 py-2.5 text-sm">
                  <Upload size={15} /> Contribute Data
                </Link>
              </div>

              {/* Stats row */}
              <div className="mt-10 flex items-center gap-6 flex-wrap">
                {STATS.map(s => (
                  <div key={s.label}>
                    <div className="text-xl font-bold text-slate-100">{s.value}</div>
                    <div className="text-xs text-slate-500">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: live spatial preview */}
            <div className="relative">
              <div className="rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
                {/* Fake toolbar */}
                <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-600/70" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-600/70" />
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-600/70" />
                  </div>
                  <span className="text-xs text-slate-500 font-mono truncate max-w-[200px]">{heroDataset.title.slice(0, 36)}…</span>
                  <div className="flex gap-1">
                    {heroDataset.markers.slice(0, 3).map(m => (
                      <button key={m} onClick={() => setHeroMarker(heroMarker === m ? '' : m)}
                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${heroMarker === m ? 'bg-brand-800 border-brand-600 text-brand-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'}`}>
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <SpatialPlot dataset={heroDataset} activeMarker={heroMarker} height={340} />
              </div>
              {/* Decorative glow */}
              <div className="absolute -inset-4 bg-brand-600/5 rounded-3xl blur-3xl -z-10" />
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 max-w-screen-xl mx-auto px-4">
        <div className="text-center mb-12">
          <p className="section-heading">Platform Capabilities</p>
          <h2 className="text-2xl font-bold text-slate-100">Built for spatial biology research</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="card p-5 hover:border-slate-700 transition-colors">
              <div className="w-9 h-9 bg-brand-950 border border-brand-800 rounded-lg flex items-center justify-center mb-4">
                <Icon size={17} className="text-brand-400" />
              </div>
              <h3 className="text-sm font-semibold text-slate-200 mb-2">{title}</h3>
              <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Featured Datasets */}
      <section className="py-16 bg-slate-900/40 border-y border-slate-800">
        <div className="max-w-screen-xl mx-auto px-4">
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="section-heading">Featured Datasets</p>
              <h2 className="text-xl font-bold text-slate-100">Recent contributions</h2>
            </div>
            <Link to="/explore" className="btn-ghost text-sm">
              View all <ChevronRight size={14} />
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {featured.map(ds => <DatasetCard key={ds.id} dataset={ds} />)}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 max-w-screen-xl mx-auto px-4">
        <div className="card p-10 text-center">
          <h2 className="text-2xl font-bold text-slate-100 mb-3">Have spatial data to share?</h2>
          <p className="text-slate-400 text-sm max-w-lg mx-auto mb-6">
            Contribute your spatial biology datasets to make them accessible to the research community.
            Guided upload, automatic visualization, and dataset management included.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link to="/login" className="btn-primary px-6 py-2.5">
              Get Started <ArrowRight size={15} />
            </Link>
            <Link to="/explore" className="btn-ghost">
              <Database size={15} /> Browse Datasets
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
