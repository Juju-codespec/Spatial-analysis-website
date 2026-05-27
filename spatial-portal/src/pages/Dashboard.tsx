import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Database, Eye, Download, Plus, Edit, Trash2, Lock } from 'lucide-react';
import { useStore } from '../store/useStore';
import DeleteDatasetDialog from '../components/dataset/DeleteDatasetDialog';
import clsx from 'clsx';

export default function Dashboard() {
  const { currentUser, datasets } = useStore();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const confirmTarget = datasets.find(d => d.id === pendingDeleteId) ?? null;

  if (!currentUser) {
    return (
      <div className="pt-14 min-h-screen flex items-center justify-center">
        <div className="card p-8 text-center max-w-sm">
          <Lock size={32} className="text-slate-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-slate-200 mb-2">Sign In Required</h2>
          <p className="text-sm text-slate-500 mb-5">Please sign in to view your dashboard.</p>
          <Link to="/login" className="btn-primary w-full justify-center">Sign In</Link>
        </div>
      </div>
    );
  }

  // Show anything the user contributed locally plus any backend-tracked
  // uploads (contributorId === 'upload') so they always have a place to
  // manage and delete their data.
  const myDatasets = datasets.filter(d =>
    d.contributorId === currentUser.id || d.contributorId === 'upload'
  );

  return (
    <div className="pt-14 min-h-screen">
      <div className="max-w-screen-xl mx-auto px-4 py-10">
        {/* Profile header */}
        <div className="card p-6 mb-8 flex items-center gap-5">
          <div className="w-14 h-14 rounded-full bg-brand-800 flex items-center justify-center text-xl font-bold text-brand-200 shrink-0">
            {currentUser.name[0]}
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-slate-100">{currentUser.name}</h1>
            <p className="text-sm text-slate-500">{currentUser.institution}</p>
            <div className="flex items-center gap-3 mt-1">
              <span className="tag-blue text-[10px]">{currentUser.role}</span>
              <span className="text-xs text-slate-600">{currentUser.email}</span>
            </div>
          </div>
          <Link to="/upload" className="btn-primary text-sm">
            <Plus size={14} /> Upload Dataset
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'My Datasets', value: myDatasets.length, icon: Database },
            { label: 'Total Views', value: myDatasets.reduce((a, d) => a + d.viewCount, 0).toLocaleString(), icon: Eye },
            { label: 'Downloads', value: myDatasets.reduce((a, d) => a + d.downloads, 0).toLocaleString(), icon: Download },
            { label: 'Published', value: myDatasets.filter(d => d.status === 'published').length, icon: Database },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon size={14} className="text-slate-500" />
                <span className="text-xs text-slate-500">{label}</span>
              </div>
              <div className="text-2xl font-bold text-slate-100">{value}</div>
            </div>
          ))}
        </div>

        {/* My datasets table */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">My Datasets</h2>
            <Link to="/upload" className="btn-ghost text-xs"><Plus size={12} /> New</Link>
          </div>

          {myDatasets.length === 0 ? (
            <div className="p-12 text-center">
              <Database size={32} className="text-slate-700 mx-auto mb-3" />
              <p className="text-sm text-slate-500 mb-4">You haven't uploaded any datasets yet.</p>
              <Link to="/upload" className="btn-primary text-sm">Upload your first dataset</Link>
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {myDatasets.map(ds => (
                <div key={ds.id} className="px-5 py-4 flex items-center gap-4 hover:bg-slate-900/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <Link to={`/dataset/${ds.id}`} className="text-sm font-medium text-slate-200 hover:text-brand-400 transition-colors line-clamp-1">{ds.title}</Link>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="tag text-[10px]">{ds.cancerType}</span>
                      <span className={clsx('badge text-[10px]',
                        ds.status === 'published' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                        ds.status === 'pending'   ? 'bg-amber-950 text-amber-400 border border-amber-800' :
                        'bg-slate-800 text-slate-400 border border-slate-700'
                      )}>{ds.status}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-500 shrink-0">
                    <span className="flex items-center gap-1"><Eye size={11} />{ds.viewCount.toLocaleString()}</span>
                    <span className="flex items-center gap-1"><Download size={11} />{ds.downloads}</span>
                    <span>{new Date(ds.date).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button className="btn-ghost text-xs p-1.5" title="Edit (coming soon)"><Edit size={13} /></button>
                    <button
                      onClick={() => setPendingDeleteId(ds.id)}
                      className="btn-ghost text-xs p-1.5 text-rose-500 hover:text-rose-400 hover:bg-rose-950/30"
                      title="Delete dataset"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <DeleteDatasetDialog
        dataset={confirmTarget}
        onClose={() => setPendingDeleteId(null)}
      />
    </div>
  );
}
