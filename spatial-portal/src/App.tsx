import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Header from './components/layout/Header';
import Footer from './components/layout/Footer';
import Home from './pages/Home';
import Explore from './pages/Explore';
import DatasetDetail from './pages/DatasetDetail';
import Upload from './pages/Upload';
import Login from './pages/Login';
import Compare from './pages/Compare';
import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';
import ErrorBoundary from './components/shared/ErrorBoundary';
import { useStore } from './store/useStore';

export default function App() {
  const loadDatasets = useStore(s => s.loadDatasets);
  useEffect(() => { void loadDatasets(); }, [loadDatasets]);

  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Header />
        <main className="flex-1">
          <ErrorBoundary>
            <Routes>
              <Route path="/"            element={<Home />} />
              <Route path="/explore"     element={<Explore />} />
              <Route path="/dataset/:id" element={<DatasetDetail />} />
              <Route path="/upload"      element={<Upload />} />
              <Route path="/login"       element={<Login />} />
              <Route path="/compare"     element={<Compare />} />
              <Route path="/dashboard"   element={<Dashboard />} />
              <Route path="/admin"       element={<Admin />} />
              <Route path="*"            element={<Home />} />
            </Routes>
          </ErrorBoundary>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}
