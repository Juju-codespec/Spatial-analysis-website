import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Microscope, LogIn, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { MOCK_USERS } from '../data/mockData';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const ok = login(email, password);
    if (ok) {
      navigate('/explore');
    } else {
      setError('No account found with that email. Try a demo account below.');
    }
  };

  const quickLogin = (userEmail: string) => {
    login(userEmail, 'demo');
    navigate('/explore');
  };

  return (
    <div className="pt-14 min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-brand-700 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Microscope size={22} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-100">
            {mode === 'login' ? 'Sign in to SpatialBio' : 'Create an account'}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {mode === 'login' ? 'Access your datasets and visualizations' : 'Join the spatial biology research community'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          {mode === 'signup' && (
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1.5">Full Name</label>
              <input type="text" className="input" placeholder="Dr. Jane Smith" />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-slate-400 block mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="input"
              placeholder="you@institution.edu"
              required
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-400 block mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="input pr-10"
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {mode === 'signup' && (
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1.5">Institution</label>
              <input type="text" className="input" placeholder="University / Cancer Center" />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-rose-950/30 border border-rose-800/50 rounded-lg text-xs text-rose-400">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary w-full justify-center py-2.5 text-sm mt-2">
            <LogIn size={15} />
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>

          <p className="text-center text-xs text-slate-500">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
              className="text-brand-400 hover:text-brand-300 transition-colors font-medium">
              {mode === 'login' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </form>

        {/* Demo accounts */}
        <div className="mt-5 card p-4">
          <p className="text-xs font-semibold text-slate-500 mb-3 text-center">Demo Accounts — click to sign in</p>
          <div className="space-y-2">
            {MOCK_USERS.slice(0, 4).map(u => (
              <button key={u.id} onClick={() => quickLogin(u.email)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-900/60 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 transition-colors text-left">
                <div className="w-7 h-7 rounded-full bg-brand-800 flex items-center justify-center text-[11px] font-bold text-brand-300 shrink-0">
                  {u.name[0]}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-200 truncate">{u.name}</p>
                  <p className="text-[10px] text-slate-500 truncate">{u.institution} · {u.role}</p>
                </div>
              </button>
            ))}
            <button onClick={() => quickLogin('admin@spatialportal.io')}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-900/60 hover:bg-slate-800 border border-brand-900 hover:border-brand-700 transition-colors text-left">
              <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-[11px] font-bold text-slate-300 shrink-0">A</div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-200">Portal Admin</p>
                <p className="text-[10px] text-brand-400">Administrator account</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
