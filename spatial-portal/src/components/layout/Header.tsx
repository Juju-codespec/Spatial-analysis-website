import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Microscope, Search, Upload, BarChart3, Grid3X3, LogIn, LogOut, ChevronDown, Shield, User } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useState } from 'react';
import clsx from 'clsx';

const NAV = [
  { label: 'Explore', to: '/explore', icon: Grid3X3 },
  { label: 'Compare', to: '/compare', icon: BarChart3 },
  { label: 'Contribute', to: '/upload', icon: Upload },
];

export default function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, logout } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/explore?search=${encodeURIComponent(searchValue)}`);
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/60">
      <div className="max-w-screen-xl mx-auto px-4 h-14 flex items-center gap-4">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 shrink-0 group">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center group-hover:bg-brand-500 transition-colors">
            <Microscope size={16} className="text-white" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-bold text-slate-100 tracking-tight">SpatialBio</span>
            <span className="text-[10px] text-slate-500 font-medium tracking-widest uppercase">Portal</span>
          </div>
        </Link>

        {/* Nav */}
        <nav className="hidden md:flex items-center gap-1 ml-4">
          {NAV.map(({ label, to, icon: Icon }) => (
            <Link key={to} to={to} className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              location.pathname === to
                ? 'text-brand-400 bg-brand-950'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            )}>
              <Icon size={14} />
              {label}
            </Link>
          ))}
        </nav>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex-1 max-w-sm hidden md:block">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search datasets..."
              value={searchValue}
              onChange={e => setSearchValue(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 text-slate-300 placeholder-slate-600 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600"
            />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-2">
          {currentUser ? (
            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-sm text-slate-300 transition-colors"
              >
                <div className="w-5 h-5 rounded-full bg-brand-700 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-white">{currentUser.name[0]}</span>
                </div>
                <span className="hidden md:block max-w-[120px] truncate">{currentUser.name}</span>
                <ChevronDown size={12} className="text-slate-500" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-52 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl py-1 z-50">
                  <div className="px-3 py-2 border-b border-slate-800">
                    <p className="text-xs font-semibold text-slate-200 truncate">{currentUser.name}</p>
                    <p className="text-xs text-slate-500 truncate">{currentUser.email}</p>
                  </div>
                  <Link to="/dashboard" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors">
                    <User size={14} /> My Dashboard
                  </Link>
                  {currentUser.role === 'admin' && (
                    <Link to="/admin" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors">
                      <Shield size={14} /> Admin Panel
                    </Link>
                  )}
                  <button onClick={() => { logout(); setMenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-rose-400 hover:bg-slate-800 transition-colors">
                    <LogOut size={14} /> Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link to="/login" className="btn-primary text-xs px-3 py-1.5">
              <LogIn size={13} /> Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
