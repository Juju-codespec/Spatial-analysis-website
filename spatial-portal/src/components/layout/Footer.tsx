import { Microscope } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="border-t border-slate-800 mt-24 bg-slate-950">
      <div className="max-w-screen-xl mx-auto px-4 py-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 bg-brand-700 rounded-md flex items-center justify-center">
                <Microscope size={13} className="text-white" />
              </div>
              <span className="text-sm font-bold text-slate-200">SpatialBio Portal</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">An open research platform for interactive exploration and contribution of spatial biology and tumor microenvironment data.</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Explore</p>
            <ul className="space-y-2">
              {[['Datasets', '/explore'], ['Compare', '/compare'], ['Contribute', '/upload']].map(([label, to]) => (
                <li key={to}><Link to={to} className="text-xs text-slate-400 hover:text-slate-200 transition-colors">{label}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Resources</p>
            <ul className="space-y-2">
              <li><Link to="/docs" className="text-xs text-slate-400 hover:text-slate-200 transition-colors">Documentation</Link></li>
              {['Data Format Guide', 'API Reference', 'Changelog'].map(l => (
                <li key={l}><span className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer transition-colors">{l}</span></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Platform</p>
            <ul className="space-y-2">
              {['About', 'Privacy Policy', 'Terms of Use', 'Contact'].map(l => (
                <li key={l}><span className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer transition-colors">{l}</span></li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-8 pt-6 border-t border-slate-800/60 flex flex-col md:flex-row items-center justify-between gap-3">
          <p className="text-xs text-slate-600">© 2025 SpatialBio Portal. Open access for research use.</p>
          <p className="text-xs text-slate-600">Built for spatial biology research communities.</p>
        </div>
      </div>
    </footer>
  );
}
