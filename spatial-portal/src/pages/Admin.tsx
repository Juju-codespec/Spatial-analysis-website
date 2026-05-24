import { Link } from 'react-router-dom';
import {
  Database, Users, Eye, Download, CheckCircle2, XCircle,
  Clock, BarChart3, Shield, Lock, Search
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { MOCK_USERS } from '../data/mockData';
import { useState } from 'react';
import clsx from 'clsx';

export default function Admin() {
  const { currentUser, datasets } = useStore();
  const [tab, setTab] = useState<'overview' | 'datasets' | 'users'>('overview');
  const [search, setSearch] = useState('');

  if (!currentUser || currentUser.role !== 'admin') {
    return (
      <div className="pt-14 min-h-screen flex items-center justify-center">
        <div className="card p-8 text-center max-w-sm">
          <Shield size={32} className="text-slate-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-slate-200 mb-2">Admin Only</h2>
          <p className="text-sm text-slate-500 mb-5">This area is restricted to administrators.</p>
          <Link to="/login" className="btn-primary w-full justify-center">Sign In as Admin</Link>
        </div>
      </div>
    );
  }

  const published = datasets.filter(d => d.status === 'published');
  const pending   = datasets.filter(d => d.status === 'pending');
  const totalViews = datasets.reduce((a, d) => a + d.viewCount, 0);
  const totalDown  = datasets.reduce((a, d) => a + d.downloads, 0);

  const filteredDatasets = datasets.filter(d =>
    !search || d.title.toLowerCase().includes(search.toLowerCase()) || d.contributor.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="pt-14 min-h-screen">
      <div className="max-w-screen-xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-9 h-9 bg-slate-800 border border-slate-700 rounded-lg flex items-center justify-center">
            <Shield size={16} className="text-slate-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100">Admin Panel</h1>
            <p className="text-xs text-slate-500">Manage datasets, users, and platform settings</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-800 mb-8">
          {(['overview', 'datasets', 'users'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={clsx('px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors',
                tab === t ? 'border-brand-500 text-brand-400' : 'border-transparent text-slate-500 hover:text-slate-300')}>
              {t}
            </button>
          ))}
        </div>

        {/* Overview */}
        {tab === 'overview' && (
          <div className="space-y-8 animate-fade-in">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Datasets', value: datasets.length, icon: Database, color: 'text-brand-400' },
                { label: 'Published', value: published.length, icon: CheckCircle2, color: 'text-emerald-400' },
                { label: 'Pending Review', value: pending.length, icon: Clock, color: 'text-amber-400' },
                { label: 'Total Views', value: totalViews.toLocaleString(), icon: Eye, color: 'text-slate-400' },
                { label: 'Downloads', value: totalDown.toLocaleString(), icon: Download, color: 'text-slate-400' },
                { label: 'Contributors', value: MOCK_USERS.filter(u => u.role === 'researcher').length, icon: Users, color: 'text-purple-400' },
                { label: 'Cancer Types', value: new Set(datasets.map(d => d.cancerType)).size, icon: BarChart3, color: 'text-slate-400' },
                { label: 'Techniques', value: new Set(datasets.map(d => d.technique)).size, icon: BarChart3, color: 'text-slate-400' },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="card p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon size={13} className={color} />
                    <span className="text-xs text-slate-500">{label}</span>
                  </div>
                  <div className="text-2xl font-bold text-slate-100">{value}</div>
                </div>
              ))}
            </div>

            {/* Cancer type breakdown */}
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-200 mb-4">Datasets by Cancer Type</h3>
              <div className="space-y-3">
                {Array.from(new Set(datasets.map(d => d.cancerType))).map(ct => {
                  const count = datasets.filter(d => d.cancerType === ct).length;
                  return (
                    <div key={ct} className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 w-48 truncate">{ct}</span>
                      <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-600 rounded-full" style={{ width: `${(count / datasets.length) * 100}%` }} />
                      </div>
                      <span className="text-xs font-mono text-slate-300 w-5 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recent activity */}
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-800">
                <h3 className="text-sm font-semibold text-slate-200">Recent Datasets</h3>
              </div>
              <div className="divide-y divide-slate-800">
                {datasets.slice(0, 5).map(ds => (
                  <div key={ds.id} className="px-5 py-3 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <Link to={`/dataset/${ds.id}`} className="text-sm text-slate-200 hover:text-brand-400 transition-colors line-clamp-1">{ds.title}</Link>
                      <p className="text-xs text-slate-600 mt-0.5">{ds.contributor} · {ds.date}</p>
                    </div>
                    <span className={clsx('badge text-[10px]',
                      ds.status === 'published' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-amber-950 text-amber-400 border border-amber-800'
                    )}>{ds.status}</span>
                    <div className="flex gap-1">
                      <button className="text-[11px] text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded bg-emerald-950/40 border border-emerald-800/40 transition-colors flex items-center gap-1">
                        <CheckCircle2 size={11} /> Approve
                      </button>
                      <button className="text-[11px] text-rose-400 hover:text-rose-300 px-2 py-1 rounded bg-rose-950/30 border border-rose-800/40 transition-colors flex items-center gap-1">
                        <XCircle size={11} /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Datasets management */}
        {tab === 'datasets' && (
          <div className="animate-fade-in">
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1 max-w-xs">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input type="text" placeholder="Search datasets..." value={search} onChange={e => setSearch(e.target.value)} className="input pl-8 text-xs" />
              </div>
              <span className="text-xs text-slate-500">{filteredDatasets.length} datasets</span>
            </div>
            <div className="card overflow-hidden">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-800">
                  <tr>
                    {['Title', 'Contributor', 'Cancer Type', 'Date', 'Views', 'Status', 'Actions'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-slate-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredDatasets.map(ds => (
                    <tr key={ds.id} className="hover:bg-slate-900/30 transition-colors">
                      <td className="px-4 py-3">
                        <Link to={`/dataset/${ds.id}`} className="text-slate-200 hover:text-brand-400 transition-colors line-clamp-1 max-w-[200px] block">{ds.title}</Link>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{ds.contributor}</td>
                      <td className="px-4 py-3"><span className="tag text-[10px]">{ds.cancerType.split(' ')[0]}</span></td>
                      <td className="px-4 py-3 text-slate-400">{ds.date}</td>
                      <td className="px-4 py-3 font-mono text-slate-300">{ds.viewCount.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <span className={clsx('badge text-[10px]',
                          ds.status === 'published' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                          ds.status === 'pending'   ? 'bg-amber-950 text-amber-400 border border-amber-800' :
                          'bg-slate-800 text-slate-400 border border-slate-700'
                        )}>{ds.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button className="text-emerald-400 hover:text-emerald-300 p-1 rounded hover:bg-emerald-950/30 transition-colors" title="Approve"><CheckCircle2 size={13} /></button>
                          <button className="text-rose-400 hover:text-rose-300 p-1 rounded hover:bg-rose-950/30 transition-colors" title="Reject"><XCircle size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Users management */}
        {tab === 'users' && (
          <div className="animate-fade-in card overflow-hidden">
            <table className="w-full text-xs">
              <thead className="border-b border-slate-800">
                <tr>
                  {['User', 'Email', 'Institution', 'Role', 'Joined', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-slate-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {MOCK_USERS.map(u => (
                  <tr key={u.id} className="hover:bg-slate-900/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-brand-800 flex items-center justify-center text-[10px] font-bold text-brand-200">{u.name[0]}</div>
                        <span className="text-slate-200">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{u.email}</td>
                    <td className="px-4 py-3 text-slate-400">{u.institution}</td>
                    <td className="px-4 py-3">
                      <span className={clsx('badge text-[10px]',
                        u.role === 'admin' ? 'bg-slate-700 text-slate-200 border border-slate-600' :
                        u.role === 'researcher' ? 'tag-blue' : 'tag'
                      )}>{u.role}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{u.joinedAt}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <select className="text-[10px] bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-slate-300 cursor-pointer">
                          <option>researcher</option>
                          <option>admin</option>
                          <option>viewer</option>
                        </select>
                        <button className="text-rose-400 hover:text-rose-300 p-1 rounded hover:bg-rose-950/30 transition-colors" title="Deactivate"><Lock size={11} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
