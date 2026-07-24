import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen, HeartPulse, Stethoscope, Microscope, ChevronRight, ChevronDown,
  Info, AlertCircle, CheckCircle2, Sigma, Layers, Target, Rocket, HelpCircle,
  ArrowUp, Map, BarChart2, Activity, Search, ExternalLink,
} from 'lucide-react';
import clsx from 'clsx';
import { API_URL } from '../api/client';

// ─── Section IDs ───────────────────────────────────────────────────────────
const SECTIONS = [
  { id: 'overview',        label: 'Overview',                  icon: BookOpen },
  { id: 'getting-started', label: 'Getting Started',           icon: Rocket },
  { id: 'module-guide',    label: 'Using Each Tab',            icon: Layers },
  { id: 'cell-types',      label: 'Cell Types',                icon: Microscope },
  { id: 'spatial-stats',   label: 'Spatial Statistics',        icon: Sigma },
  { id: 'survival',        label: 'Survival Analysis',         icon: HeartPulse },
  { id: 'clinical',        label: 'Clinical Analysis',           icon: Stethoscope },
  { id: 'interpretation',  label: 'Interpreting Results',      icon: Target },
  { id: 'quality',         label: 'Data Quality & Thresholds', icon: CheckCircle2 },
  { id: 'faq',             label: 'FAQ & Troubleshooting',     icon: HelpCircle },
  { id: 'glossary',        label: 'Glossary',                  icon: BookOpen },
];

// ─── Reusable components ───────────────────────────────────────────────────

function SectionHeading({ id, icon: Icon, children }: { id: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <h2 id={id} className="flex items-center gap-3 text-2xl font-bold text-slate-100 mb-6 scroll-mt-20">
      <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-brand-900/60 border border-brand-700/40">
        <Icon size={18} className="text-brand-400" />
      </span>
      {children}
    </h2>
  );
}

function SubHeading({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="text-lg font-semibold text-slate-200 mb-3 mt-8 scroll-mt-20">
      {children}
    </h3>
  );
}

function Callout({ type = 'info', children }: { type?: 'info' | 'tip' | 'warn'; children: React.ReactNode }) {
  const styles = {
    info: 'bg-sky-950/50 border-sky-700/40 text-sky-300',
    tip:  'bg-emerald-950/50 border-emerald-700/40 text-emerald-300',
    warn: 'bg-amber-950/50 border-amber-700/40 text-amber-300',
  };
  const Icon = type === 'warn' ? AlertCircle : type === 'tip' ? CheckCircle2 : Info;
  return (
    <div className={clsx('flex gap-3 rounded-lg border p-4 mb-5 text-sm leading-relaxed', styles[type])}>
      <Icon size={16} className="shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 px-5 py-3 rounded-lg bg-slate-900 border border-slate-700/60 font-mono text-sm text-brand-300 overflow-x-auto">
      {children}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto mb-6 rounded-xl border border-slate-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-900/80">
            {headers.map(h => (
              <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-800">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={clsx('border-b border-slate-800/50 last:border-0', i % 2 === 0 ? 'bg-slate-950' : 'bg-slate-900/30')}>
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2.5 text-slate-300 align-top">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CellTypeBadge({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="font-medium text-slate-200">{label}</span>
    </span>
  );
}

function WorkflowStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 mb-5">
      <span className="flex items-center justify-center w-7 h-7 rounded-full bg-brand-900/60 border border-brand-700/50 text-xs font-bold text-brand-400 shrink-0">
        {n}
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-200 mb-1">{title}</p>
        <div className="text-sm text-slate-400 leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function FaqItem({ q, children }: { q: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-slate-800 overflow-hidden mb-2">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-slate-200 hover:bg-slate-900/60 transition-colors"
      >
        {q}
        <ChevronDown size={14} className={clsx('text-slate-500 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm text-slate-400 leading-relaxed border-t border-slate-800/60 pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

function CollapsibleCellTypeCard({ ct }: {
  ct: { label: string; color: string; markers: string; role: string; biology: string; interpretation: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-3 bg-slate-900/60 hover:bg-slate-900 transition-colors text-left"
      >
        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: ct.color }} />
        <span className="font-semibold text-slate-100">{ct.label}</span>
        <span className="hidden sm:inline text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono">{ct.markers}</span>
        <span className="hidden md:inline text-xs px-2 py-0.5 rounded-full border border-slate-700 text-slate-500">{ct.role}</span>
        <ChevronDown size={14} className={clsx('ml-auto text-slate-500 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-5 py-4 grid md:grid-cols-2 gap-4 text-sm text-slate-400 leading-relaxed border-t border-slate-800/60">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">Biology</p>
            {ct.biology}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">Interpretation</p>
            {ct.interpretation}
          </div>
        </div>
      )}
    </div>
  );
}

function ClusterDiagram() {
  return (
    <div className="grid grid-cols-3 gap-4 my-5">
      {[
        { label: 'Dispersed (L−r < 0)', dots: [[20,70],[75,25],[30,30],[80,75],[55,55]], color: '#64748b' },
        { label: 'Random (L−r ≈ 0)', dots: [[25,25],[70,30],[40,70],[75,65],[55,45]], color: '#94a3b8' },
        { label: 'Clustered (L−r > 0)', dots: [[35,35],[42,42],[48,38],[40,48],[45,45]], color: '#3b82f6' },
      ].map(({ label, dots, color }) => (
        <div key={label} className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
          <svg viewBox="0 0 100 100" className="w-full h-24 mb-2">
            <rect width="100" height="100" fill="rgba(15,23,42,0.5)" rx="4" />
            {dots.map(([cx, cy], i) => (
              <circle key={i} cx={cx} cy={cy} r="4" fill={color} opacity={0.9} />
            ))}
          </svg>
          <p className="text-[10px] text-center text-slate-400 font-medium">{label}</p>
        </div>
      ))}
    </div>
  );
}

function QuadrantDiagram() {
  const cells = [
    { key: 'tl', label: 'Hi cluster · Lo abund', sub: 'Organized but sparse', color: '#f97316', pos: 'col-start-1 row-start-1' },
    { key: 'tr', label: 'Hi cluster · Hi abund', sub: 'Hot / inflamed', color: '#10b981', pos: 'col-start-2 row-start-1' },
    { key: 'bl', label: 'Lo cluster · Lo abund', sub: 'Reference (cold)', color: '#64748b', pos: 'col-start-1 row-start-2' },
    { key: 'br', label: 'Lo cluster · Hi abund', sub: 'Scattered inflamed', color: '#3b82f6', pos: 'col-start-2 row-start-2' },
  ];
  return (
    <div className="my-5 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <p className="text-xs text-slate-500 mb-3 text-center">Bivariate Cox quadrants (clustering × abundance)</p>
      <div className="grid grid-cols-2 gap-1 max-w-sm mx-auto">
        {cells.map(c => (
          <div key={c.key} className={clsx('rounded-lg border border-slate-700/60 p-3 text-center', c.pos)}>
            <span className="inline-block w-2.5 h-2.5 rounded-sm mb-1.5" style={{ background: c.color }} />
            <p className="text-[10px] font-semibold text-slate-300">{c.label}</p>
            <p className="text-[9px] text-slate-500 mt-0.5">{c.sub}</p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-600 text-center mt-3">↑ higher clustering · → higher abundance</p>
    </div>
  );
}

function TocNav({ activeSection, className }: { activeSection: string; className?: string }) {
  return (
    <nav className={clsx('space-y-0.5', className)}>
      {SECTIONS.map(({ id, label, icon: Icon }) => (
        <a
          key={id}
          href={`#${id}`}
          className={clsx(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap',
            activeSection === id
              ? 'bg-brand-950 text-brand-400 font-medium'
              : 'text-slate-500 hover:text-slate-300 hover:bg-slate-900',
          )}
        >
          <Icon size={14} className="shrink-0" />
          {label}
        </a>
      ))}
    </nav>
  );
}

function BackToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className="fixed bottom-6 right-6 z-40 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 hover:text-slate-100 hover:bg-slate-700 shadow-lg transition-colors"
      aria-label="Back to top"
    >
      <ArrowUp size={14} /> Top
    </button>
  );
}

const GLOSSARY: Array<{ term: string; def: string }> = [
  { term: 'CSR', def: 'Complete Spatial Randomness — a null model where points are distributed uniformly at random within the tissue window.' },
  { term: 'TME', def: 'Tumor microenvironment — the cellular and structural context surrounding tumor cells, including immune and stromal cells.' },
  { term: 'TLS', def: 'Tertiary lymphoid structure — organized lymphoid aggregates within tumors, often rich in B and T cells.' },
  { term: 'CAF', def: 'Cancer-associated fibroblast — activated stromal cell that can remodel ECM and influence immune access to tumor nests.' },
  { term: 'Cox PH', def: 'Cox proportional hazards model — semi-parametric regression relating covariates to survival hazard over time.' },
  { term: 'HR', def: 'Hazard ratio — multiplicative change in event hazard per unit increase in a predictor. HR = 1 means no association.' },
  { term: 'KM', def: 'Kaplan-Meier — non-parametric estimator of survival probability over time, used for curve visualization.' },
  { term: 'FDR', def: 'False discovery rate — expected proportion of false positives among rejected null hypotheses; used in screening matrices.' },
  { term: 'Cross-K / Cross-G', def: 'Spatial statistic measuring co-localisation of one cell type relative to another (e.g. CD8+ T cells near Tumor cells).' },
  { term: 'mIF', def: 'Multiplex immunofluorescence — imaging technique staining multiple protein markers simultaneously.' },
];

// ─── Cell type data ────────────────────────────────────────────────────────

const CELL_TYPES = [
  {
    label: 'CD8+ T Cell',
    color: '#3b82f6',
    markers: 'CD8',
    role: 'Cytotoxic T lymphocyte',
    biology: 'CD8+ T cells are the primary effectors of anti-tumor immunity. Upon recognizing tumor antigens presented on MHC class I molecules, they kill target cells via perforin/granzyme secretion and Fas–FasL signaling. High infiltration of CD8+ T cells into tumors is strongly associated with improved prognosis across many cancer types.',
    interpretation: 'Elevated CD8+ T cell density or percentage generally indicates an "inflamed" tumor immune phenotype. Spatial clustering of CD8+ T cells near tumor cells (high cross-K or cross-G statistic) suggests active cytolytic attack rather than peripheral immune exclusion.',
  },
  {
    label: 'CD4+ T Cell',
    color: '#06b6d4',
    markers: 'CD4',
    role: 'Helper T lymphocyte',
    biology: 'CD4+ T cells coordinate adaptive immune responses by activating cytotoxic T cells, B cells, and macrophages through cytokine secretion (e.g. IFN-γ, IL-2). The CD4+ pool contains multiple functional subsets including T helper 1 (Th1), regulatory T cells (Treg), and follicular helpers (Tfh), which can have pro- or anti-tumor effects depending on context.',
    interpretation: 'CD4+ T cell presence alone is insufficient to judge immune state—Th1-polarized cells support tumor killing, while Tregs (also CD4+) suppress immune activity. Ratio of CD4+ to tumor cells and co-localization with CD8+ T cells provide richer context.',
  },
  {
    label: 'T Cell',
    color: '#818cf8',
    markers: 'CD3 (pan-T cell)',
    role: 'Pan-T lymphocyte (CD3+)',
    biology: 'CD3 marks all mature T lymphocytes—encompassing CD4+ helpers, CD8+ cytotoxic cells, and less abundant NKT cells. When individual T-cell subset markers are not available, CD3 provides a measure of overall T cell infiltration.',
    interpretation: 'Used as a summary immune infiltration metric when CD4/CD8 subtyping is unavailable. In spatial analyses, the T Cell type aggregates CD4+, CD8+, and generic CD3+ cells into a combined group for T-cell clustering statistics.',
  },
  {
    label: 'Macrophage',
    color: '#f59e0b',
    markers: 'CD68, CD163',
    role: 'Tumor-associated macrophage (TAM)',
    biology: 'Macrophages are abundant innate immune cells in the tumor microenvironment. CD68 marks all macrophages; CD163 specifically marks the anti-inflammatory M2-like subset. TAMs can exhibit pro-inflammatory (M1-like, anti-tumor) or immunosuppressive (M2-like, pro-tumor) phenotypes. High M2-like macrophage infiltration is associated with poor prognosis in many solid tumors.',
    interpretation: 'Macrophage density and spatial proximity to tumor cells reflect the balance of immune suppression vs. activation. Co-localization of macrophages and tumor cells without T cell co-localization may indicate an immune-excluded or desert phenotype.',
  },
  {
    label: 'NK Cell',
    color: '#10b981',
    markers: 'CD56',
    role: 'Natural killer lymphocyte',
    biology: 'NK cells provide MHC-unrestricted cytotoxicity against tumor cells that downregulate MHC class I to evade T cells—complementing the adaptive immune response. They release cytotoxic granules and produce IFN-γ. NK cell infiltration is associated with improved outcomes in several hematologic and solid tumors.',
    interpretation: 'NK cell clustering near tumor cells can indicate innate immune surveillance activity. Their presence in the tumor core versus stroma may reflect different functional states.',
  },
  {
    label: 'B Cell',
    color: '#a78bfa',
    markers: 'CD19, CD20',
    role: 'B lymphocyte',
    biology: 'B cells in the tumor microenvironment can organize into tertiary lymphoid structures (TLS) that support local adaptive immune responses. They present antigens, produce antibodies, and interact with T cells. B cell infiltration has been linked to improved outcomes and response to immune checkpoint blockade in multiple cancer types.',
    interpretation: 'Dense aggregates of B cells often indicate TLS formation. Spatial clustering statistics for B cells can distinguish organized TLS (strong clustering at relevant radii) from scattered infiltration.',
  },
  {
    label: 'Tumor',
    color: '#ef4444',
    markers: 'CK (cytokeratin), PanCK, EpCAM',
    role: 'Epithelial / tumor cell',
    biology: 'Pan-cytokeratin and EpCAM mark epithelial cells, identifying tumor cells in carcinomas. The spatial distribution of tumor cells defines the tumor boundary and core, providing the context for all immune infiltration measurements.',
    interpretation: 'Tumor cell density defines the regional context for immune analysis. Tumor-proximal analysis compares immune statistics specifically within the tumor region. High tumor cell density with low surrounding immune cell density indicates an immune-cold or excluded phenotype.',
  },
  {
    label: 'CAF',
    color: '#f97316',
    markers: 'FAP, αSMA (ASMA/SMA)',
    role: 'Cancer-associated fibroblast',
    biology: 'CAFs are activated stromal fibroblasts that remodel the extracellular matrix, produce pro-tumorigenic cytokines, and can physically exclude immune cells from the tumor nest. FAP (fibroblast activation protein) and αSMA (alpha-smooth muscle actin) mark activated fibroblasts in the tumor stroma.',
    interpretation: 'High CAF abundance surrounding tumor nests, particularly when immune cells are excluded from the tumor core, is a hallmark of the immune-excluded microenvironment. CAF clustering between tumor and immune cells may indicate physical immune barrier formation.',
  },
  {
    label: 'Stromal',
    color: '#84cc16',
    markers: 'Various stromal markers',
    role: 'Non-tumor, non-immune stromal cell',
    biology: 'A broad class covering stromal cells not specifically sub-typed as CAFs. Includes endothelial cells, pericytes, and generic fibroblasts depending on the panel used.',
    interpretation: 'Stromal cells define the architectural scaffold of the tumor. Their spatial distribution relative to tumor and immune cells helps contextualize immune infiltration patterns.',
  },
  {
    label: 'Other / Unknown',
    color: '#64748b',
    markers: 'No positive phenotype markers',
    role: 'Unclassified cell',
    biology: 'Cells that do not express any of the canonical panel markers above a positivity threshold. May represent cell types not covered by the multiplex panel, doublets, or ambiguous phenotypes.',
    interpretation: 'Should not be used as a focal cell type in spatial analyses unless the study specifically investigates untyped cells. High "Other" fraction may indicate panel coverage issues or data quality concerns.',
  },
];

// ─── Main page ─────────────────────────────────────────────────────────────

export default function Documentation() {
  const [activeSection, setActiveSection] = useState('overview');
  const [cellTypeFilter, setCellTypeFilter] = useState('');
  const observer = useRef<IntersectionObserver | null>(null);

  const filteredCellTypes = CELL_TYPES.filter(ct =>
    !cellTypeFilter ||
    ct.label.toLowerCase().includes(cellTypeFilter.toLowerCase()) ||
    ct.markers.toLowerCase().includes(cellTypeFilter.toLowerCase()) ||
    ct.role.toLowerCase().includes(cellTypeFilter.toLowerCase()),
  );

  useEffect(() => {
    const ids = SECTIONS.map(s => s.id);
    observer.current = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (e.isIntersecting) setActiveSection(e.target.id);
        });
      },
      { rootMargin: '-20% 0px -70% 0px' }
    );
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) observer.current!.observe(el);
    });
    return () => observer.current?.disconnect();
  }, []);

  return (
    <div className="min-h-screen pt-14 bg-slate-950">
      {/* Page header */}
      <div className="border-b border-slate-800/60 bg-gradient-to-b from-slate-900/60 to-transparent">
        <div className="max-w-screen-xl mx-auto px-6 py-12">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-4">
            <Link to="/" className="hover:text-slate-300 transition-colors">Home</Link>
            <ChevronRight size={12} />
            <span className="text-slate-400">Documentation</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-brand-900/60 border border-brand-700/40 flex items-center justify-center">
              <BookOpen size={22} className="text-brand-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-100 tracking-tight">Documentation</h1>
              <p className="text-slate-500 mt-1 text-sm">User guide, methods, cell types, and result interpretation</p>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile TOC */}
      <div className="lg:hidden sticky top-14 z-30 border-b border-slate-800/60 bg-slate-950/95 backdrop-blur-sm">
        <div className="max-w-screen-xl mx-auto px-4 py-2 overflow-x-auto">
          <TocNav activeSection={activeSection} className="flex gap-1" />
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 py-10 flex gap-10">
        {/* Sidebar TOC */}
        <aside className="hidden lg:block w-56 shrink-0">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">On this page</p>
            <TocNav activeSection={activeSection} />
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 max-w-3xl space-y-16">

          {/* ── Overview ── */}
          <section id="overview">
            <SectionHeading id="overview" icon={BookOpen}>Overview</SectionHeading>
            <p className="text-slate-400 leading-relaxed mb-4">
              SpatialBio Portal combines multiplex immunofluorescence (mIF) imaging data with clinical metadata to
              enable spatial and statistical analyses of the tumor microenvironment (TME). Cell positions and phenotypes
              derived from image segmentation are stored per-sample, enabling computation of spatial point-pattern
              statistics, survival models, and clinical association tests.
            </p>
            <p className="text-slate-400 leading-relaxed mb-4">
              All analyses run against a plumber-based R API backend. The frontend presents results interactively
              across five analysis modules: Spatial Map, Expression Heatmap, Spatial Statistics, Survival, and
              Clinical Analysis.
            </p>
            <Callout type="info">
              New here? Start with the <a href="#getting-started" className="text-brand-400 hover:underline font-medium">Getting Started</a> guide,
              then see <a href="#module-guide" className="text-brand-400 hover:underline font-medium">Using Each Tab</a> for control-by-control help.
            </Callout>
            <Callout type="tip">
              Statistical analyses require a minimum of <strong>10 cells per sample</strong> for the focal cell type
              and at least <strong>2 samples</strong> for group comparisons. Samples below these thresholds are
              automatically excluded from spatial statistics calculations.
            </Callout>
            <Table
              headers={['Module', 'What it tests', 'Required data']}
              rows={[
                ['Spatial Statistics', 'Spatial clustering / dispersal of cell types', 'Cell coordinates + type'],
                ['Survival Analysis', 'Association of spatial clustering with patient outcome', 'Cell data + survival metadata'],
                ['Clinical Analysis', 'Link cell abundance or clustering to clinical variables', 'Cell data + clinical CSV'],
                ['Expression Heatmap', 'Mean marker expression per cell type', 'Cell data + marker intensities'],
                ['Spatial Map', 'Visual inspection of cell distribution', 'Cell coordinates + type'],
              ]}
            />
          </section>

          {/* ── Getting Started ── */}
          <section id="getting-started">
            <SectionHeading id="getting-started" icon={Rocket}>Getting Started</SectionHeading>
            <p className="text-slate-400 leading-relaxed mb-6">
              This walkthrough takes you from opening a dataset to your first survival or clinical analysis —
              everything through the browser, no setup required on your side.
            </p>

            <WorkflowStep n={1} title="Open or upload a dataset">
              Upload your own data via <Link to="/upload" className="text-brand-400 hover:underline">Contribute</Link>,
              or open an existing dataset from <Link to="/explore" className="text-brand-400 hover:underline">Explore</Link> to
              try the portal with bundled demo cohorts. Supported cell formats:{' '}
              <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">.csv</code>,{' '}
              <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">.tsv</code>,{' '}
              <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">.parquet</code>, or{' '}
              <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">.rds</code>.
              When uploading, map <strong className="text-slate-300">x</strong> and <strong className="text-slate-300">y</strong> coordinates
              plus either a <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">cell_type</code> column
              or <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">phenotype_*</code> marker columns.
            </WorkflowStep>

            <WorkflowStep n={2} title="Explore spatial patterns">
              Open your dataset and use <strong className="text-slate-300">Spatial Map</strong> to visually inspect
              cell distributions, then <strong className="text-slate-300">Spatial Stats</strong> for formal clustering
              tests. Pick a focal cell type and optional cross type (e.g. CD8+ T Cell × Tumor).
            </WorkflowStep>

            <WorkflowStep n={3} title="Attach outcome data">
              On the <strong className="text-slate-300">Survival</strong> or <strong className="text-slate-300">Clinical Analysis</strong> tab,
              upload a CSV if none is linked yet. IDs in that file must match your imaging data — see the table below.
              The Clinical tab shows an <strong className="text-slate-300">ID overlap</strong> banner when rows fail to match.
            </WorkflowStep>

            <WorkflowStep n={4} title="Run analyses and export">
              Configure controls (cell type, radius, analysis level), review Cox or association results, and use
              <strong className="text-slate-300"> Export CSV</strong> buttons to download result tables.
            </WorkflowStep>

            <SubHeading id="file-formats">Required file formats</SubHeading>
            <Table
              headers={['File', 'Required columns', 'Optional columns', 'Enables']}
              rows={[
                [
                  'Cells',
                  <span key="c1"><code className="text-brand-300 text-xs">x</code>, <code className="text-brand-300 text-xs">y</code>, <code className="text-brand-300 text-xs">cell_type</code> or <code className="text-brand-300 text-xs">phenotype_*</code></span>,
                  <code key="c2" className="text-brand-300 text-xs">sample_id</code>,
                  'All modules',
                ],
                [
                  'Survival / clinical',
                  <span key="s1"><code className="text-brand-300 text-xs">sample_id</code> or <code className="text-brand-300 text-xs">patient_id</code>, <code className="text-brand-300 text-xs">time</code>, <code className="text-brand-300 text-xs">status</code></span>,
                  'age, stage, grade, arm, treatment, …',
                  'Survival + Clinical tabs',
                ],
                [
                  'Clinical only',
                  <span key="cl1"><code className="text-brand-300 text-xs">sample_id</code> or <code className="text-brand-300 text-xs">patient_id</code> + any clinical variables</span>,
                  '—',
                  'Clinical Analysis tab',
                ],
              ]}
            />

            <SubHeading id="id-linking">Linking imaging to clinical data</SubHeading>
            <Table
              headers={['ID column', 'When to use', 'Behaviour']}
              rows={[
                ['sample_id', 'One tissue core / section per row', 'Each sample analysed independently (unless aggregated to patient)'],
                ['patient_id', 'Multiple cores per patient', 'Required for patient-level analysis; enables cluster-robust SE across cores'],
              ]}
            />
            <Callout type="warn">
              If survival upload fails with a 404 or your dataset id starts with <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">ds_</code>,
              the cells never reached the backend — re-upload via Contribute with the API running.
            </Callout>

            <p className="text-sm text-slate-500">
              API reference:{' '}
              <a href={`${API_URL}/__docs__/`} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline inline-flex items-center gap-1">
                Swagger docs <ExternalLink size={12} />
              </a>
            </p>
          </section>

          {/* ── Module Guide ── */}
          <section id="module-guide">
            <SectionHeading id="module-guide" icon={Layers}>Using Each Tab</SectionHeading>
            <p className="text-slate-400 leading-relaxed mb-6">
              Each tab in the dataset viewer answers a different question. This section maps controls to outcomes so
              you know what to change when results look unexpected.
            </p>

            <SubHeading id="guide-spatial-map">
              <span className="inline-flex items-center gap-2"><Map size={16} className="text-brand-400" /> Spatial Map</span>
            </SubHeading>
            <p className="text-slate-400 leading-relaxed mb-3 text-sm">
              Visual QC of cell positions per sample. Select a sample from the dropdown, toggle cell types in the
              layer panel, and zoom or pan the canvas. Two render modes are available:
            </p>
            <Table
              headers={['Control', 'What it does']}
              rows={[
                ['Sample selector', 'Switches which tissue section is displayed'],
                ['Layer toggles', 'Show/hide individual cell types by colour'],
                ['Canvas mode', 'Interactive client-side plot (up to ~30k cells, downsampled)'],
                ['ggplot mode', 'Server-rendered static image from the R API'],
              ]}
            />
            <Callout type="tip">
              Use Spatial Map first to confirm segmentation looks reasonable before trusting spatial statistics.
            </Callout>

            <SubHeading id="guide-heatmap">
              <span className="inline-flex items-center gap-2"><BarChart2 size={16} className="text-brand-400" /> Expression Heatmap</span>
            </SubHeading>
            <p className="text-slate-400 leading-relaxed mb-3 text-sm">
              Shows mean marker intensity (or phenotype co-expression fraction) per cell type. Useful for validating
              that CD8+, Tumor, and other assignments match expected marker patterns. Requires marker intensity
              columns in the upload or an API phenotype summary.
            </p>

            <SubHeading id="guide-spatial-stats">
              <span className="inline-flex items-center gap-2"><Activity size={16} className="text-brand-400" /> Spatial Statistics</span>
            </SubHeading>
            <Table
              headers={['Control', 'What it does']}
              rows={[
                ['Cell Type (type A)', 'Focal cell type for K and G curves'],
                ['Cross type (type B)', 'Optional second type for cross-K / cross-G co-localisation'],
                ['Radius max (rMax)', 'Upper radius for the plotted K/L and G curves'],
                ['Min focal cells', 'Exclude samples with fewer than this many type-A cells'],
                ['CSR envelopes', 'Toggle 49 Monte Carlo simulation bands for significance testing'],
              ]}
            />
            <Callout type="info">
              Per-sample curves include envelopes; the cohort summary line is the mean ± SE of per-sample scalars —
              it does not share the same envelope band.
            </Callout>

            <SubHeading id="guide-survival">
              <span className="inline-flex items-center gap-2"><HeartPulse size={16} className="text-brand-400" /> Survival Analysis</span>
            </SubHeading>
            <Table
              headers={['Control', 'What it does']}
              rows={[
                ['Statistic (K / G)', 'K uses L(r)−r at radius (default 50 px); G uses nearest-neighbour deviation (default 20 px)'],
                ['Cell Type / Cross type', 'Which cells define the spatial scalar; cross type measures co-localisation'],
                ['Radius', 'Scalar evaluation radius — watch for radius guidance warnings'],
                ['Stratification', 'Median/tertile KM splits, trichotomize (3 groups), or continuous Cox (no KM)'],
                ['Analysis unit', 'Patient (mean across cores) or sample/core — patient is default'],
                ['Tissue region', 'Restrict stats to a named region when region labels exist in data'],
                ['Density adjustment', 'Adds n_focal + log(area) covariates to separate clustering from density'],
                ['Patient clustering', 'Cluster-robust SE by patient (sample-level analysis only)'],
                ['Covariates', 'Optional clinical columns (age, stage, grade, arm, …) added to Cox model'],
                ['Export CSV', 'Download Cox coefficient and KM summary table'],
              ]}
            />
            <p className="text-slate-400 text-sm leading-relaxed mb-4">
              The <strong className="text-slate-300">Bivariate</strong> panel below stratifies by clustering × abundance
              into four quadrants — see the <a href="#survival-bivariate" className="text-brand-400 hover:underline">bivariate section</a>.
            </p>

            <SubHeading id="guide-clinical">
              <span className="inline-flex items-center gap-2"><Stethoscope size={16} className="text-brand-400" /> Clinical Analysis</span>
            </SubHeading>
            <p className="text-slate-400 leading-relaxed mb-3 text-sm">
              Recommended workflow: upload clinical CSV → check ID overlap banner → screen in the{' '}
              <strong className="text-slate-300">Association Matrix</strong> → click a significant cell → run a
              confirmatory test in Compare / Regression / Survival sub-tabs.
            </p>
            <Table
              headers={['Control / panel', 'What it does']}
              rows={[
                ['Sample vs patient level', 'Aggregate imaging features per patient or keep per-core rows'],
                ['Association Matrix', 'All marker–clinical pairs with FDR correction — use fdr column for significance'],
                ['Summary plot', 'Visual overview of top associations; click to focus a pair'],
                ['Group comparison', 'Wilcoxon rank-sum between two clinical groups for a cell feature'],
                ['Regression', 'Linear or logistic models predicting a clinical variable from features'],
                ['Survival (clinical)', 'Cox PH using a cell abundance feature as predictor'],
                ['Spatial clustering toggle', 'Include L(r)−r or G scalar as spatial_cluster_stat feature'],
                ['Export CSV', 'Download feature table or test results'],
              ]}
            />
          </section>

          {/* ── Cell Types ── */}
          <section id="cell-types">
            <SectionHeading id="cell-types" icon={Microscope}>Cell Types</SectionHeading>
            <p className="text-slate-400 leading-relaxed mb-6">
              Cell types are assigned during image analysis by thresholding positivity for canonical protein markers.
              The table below summarizes all supported phenotypes, their detection markers, biological role, and how
              to interpret their spatial distribution in the TME context.
            </p>

            <Callout type="tip">
              Cell type assignment is performed automatically from your uploaded data. Each cell is classified by
              the highest-priority positive marker using the canonical hierarchy: CD8 → CD4 → CD3 → CD68/CD163 →
              CD19/CD20 → CD56 → CK/PanCK/EpCAM → FAP/αSMA → Other.
            </Callout>

            <SubHeading id="cell-types-quick-ref">Quick reference</SubHeading>
            <Table
              headers={['Cell type', 'Markers', 'Role']}
              rows={CELL_TYPES.map(ct => [
                <CellTypeBadge key={ct.label} color={ct.color} label={ct.label} />,
                <code key={`m-${ct.label}`} className="text-brand-300 text-xs">{ct.markers}</code>,
                ct.role,
              ])}
            />

            <div className="relative mb-4">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
              <input
                type="search"
                placeholder="Filter cell types…"
                value={cellTypeFilter}
                onChange={e => setCellTypeFilter(e.target.value)}
                className="input text-sm pl-9 w-full"
              />
            </div>

            <div className="space-y-3">
              {filteredCellTypes.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">No cell types match your filter.</p>
              ) : filteredCellTypes.map(ct => (
                <CollapsibleCellTypeCard key={ct.label} ct={ct} />
              ))}
            </div>

            <SubHeading>T Cell Grouping</SubHeading>
            <p className="text-slate-400 leading-relaxed mb-3">
              When CD4+, CD8+, and generic CD3+ cells are all present, the portal can treat them as a combined{' '}
              <strong className="text-slate-300">T Cell</strong> group (sum of all three counts) for abundance
              and ratio features. Use individual CD4/CD8 types when subset-specific spatial clustering matters.
            </p>
          </section>

          {/* ── Spatial Statistics ── */}
          <section id="spatial-stats">
            <SectionHeading id="spatial-stats" icon={Sigma}>Spatial Statistics</SectionHeading>
            <p className="text-slate-400 leading-relaxed mb-4">
              Spatial statistics quantify whether cells of a given type are randomly distributed (Complete Spatial
              Randomness, CSR), clustered together, or dispersed relative to each other or to another cell type.
              The portal implements two classical point-pattern methods: <strong className="text-slate-300">Ripley's K / Besag's L</strong> and
              the <strong className="text-slate-300">Nearest-Neighbour G function</strong>.
            </p>
            <Callout type="info">
              Computations use <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">spatstat</code> with
              an isotropic edge correction (K) and Kaplan-Meier correction (G). The tissue window is approximated
              as the convex hull of all cell positions in each sample.
            </Callout>

            <SubHeading id="k-vs-g">Choosing K vs G</SubHeading>
            <Table
              headers={['Statistic', 'Best for', 'Default radius']}
              rows={[
                ["Ripley's K / L(r)−r", 'Neighbourhood density within radius r — how many cells sit inside a disk around each focal cell', '50 px'],
                ['Nearest-neighbour G', 'Closest-neighbour distances — are cells unusually close to their nearest like-typed neighbour?', '20 px'],
                ['Cross-K / Cross-G', 'Co-localisation of type A near type B (e.g. CD8+ T cells near Tumor)', 'Same radii as above'],
              ]}
            />
            <ClusterDiagram />

            <SubHeading id="ripleys-k">Ripley's K and Besag's L</SubHeading>
            <p className="text-slate-400 leading-relaxed mb-3">
              <strong className="text-slate-300">Ripley's K(r)</strong> counts the expected number of additional cells of the same type
              (univariate) or a second type (cross-K) within radius <em>r</em> of a randomly chosen focal cell,
              normalized by the overall cell density:
            </p>
            <Formula>K(r) = (Area / n²) × Σᵢ Σⱼ≠ᵢ 𝟙[d(i,j) ≤ r] × edge_correction(i,j)</Formula>
            <p className="text-slate-400 leading-relaxed mb-3">
              Because K is hard to interpret visually, it is variance-stabilized into <strong className="text-slate-300">Besag's L(r)</strong>:
            </p>
            <Formula>L(r) = √(K(r) / π)</Formula>
            <p className="text-slate-400 leading-relaxed mb-3">
              Under CSR, L(r) = r. Plotting L(r) − r (the "centered L") gives a flat line at 0 for random
              distributions, positive values for clustering, and negative values for dispersal.
            </p>
            <Table
              headers={['L(r) − r value', 'Interpretation']}
              rows={[
                ['> 0', 'Clustering — more cells within radius r than expected by chance'],
                ['≈ 0', 'Random — distribution consistent with CSR'],
                ['< 0', 'Dispersal — fewer cells within radius r than expected by chance'],
              ]}
            />
            <p className="text-slate-400 leading-relaxed mb-3">
              The default scalar reduction radius for K/L is <strong className="text-slate-300">50 pixels</strong>. The
              scalar exported for survival and clinical analyses is:
            </p>
            <Formula>Spatial scalar (K) = L(r₀) − r₀</Formula>

            <SubHeading id="nn-g">Nearest-Neighbour G Function</SubHeading>
            <p className="text-slate-400 leading-relaxed mb-3">
              <strong className="text-slate-300">G(r)</strong> estimates the cumulative distribution function of the
              distance from a focal cell to its nearest neighbour of the same (or a different) type. Under CSR,
              G(r) = 1 − exp(−λπr²) where λ is the intensity (cells per area).
            </p>
            <Table
              headers={['G(r) − G_CSR(r) value', 'Interpretation']}
              rows={[
                ['> 0', 'Clustering — nearest neighbours are closer than expected'],
                ['≈ 0', 'Random — consistent with CSR'],
                ['< 0', 'Dispersal — nearest neighbours are further than expected'],
              ]}
            />
            <p className="text-slate-400 leading-relaxed mb-3">
              The default radius for G scalar reduction is <strong className="text-slate-300">20 pixels</strong>. The
              exported scalar is:
            </p>
            <Formula>Spatial scalar (G) = G(r₀) − G_CSR(r₀)</Formula>

            <SubHeading>CSR Simulation Envelopes</SubHeading>
            <p className="text-slate-400 leading-relaxed mb-3">
              To assess statistical significance of the observed curves, <strong className="text-slate-300">49 Monte Carlo simulations</strong> of
              CSR patterns are run. The min/max envelope of simulated K or G curves is plotted as a shaded band.
              Observed curves falling outside the envelope indicate statistically significant clustering or dispersal
              at that radius (pointwise α ≈ 0.04).
            </p>
            <Callout type="warn">
              Simulation envelopes are computed per sample. The summary curve shown across all samples uses the
              mean ± standard error of the per-sample scalars and does not directly correspond to the per-sample
              envelopes.
            </Callout>
          </section>

          {/* ── Survival Analysis ── */}
          <section id="survival">
            <SectionHeading id="survival" icon={HeartPulse}>Survival Analysis</SectionHeading>
            <p className="text-slate-400 leading-relaxed mb-4">
              The Survival module links spatial clustering scalars (L(r)−r or G(r)−G_CSR(r)) to patient outcome
              using Cox proportional hazards regression and Kaplan-Meier visualization. Survival metadata must be
              uploaded as a CSV with an ID column (
              <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">sample_id</code> or{' '}
              <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">patient_id</code>),
              <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">time</code>, and
              <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">status</code> (1 = event, 0 = censored).
              Extra columns become optional Cox covariates.
            </p>

            <SubHeading>Cox Proportional Hazards Model</SubHeading>
            <p className="text-slate-400 leading-relaxed mb-3">
              The hazard of the event (death or recurrence) at time <em>t</em> for patient <em>i</em> is modeled as:
            </p>
            <Formula>h(t|xᵢ) = h₀(t) × exp(β × spatial_scalar_i + covariates)</Formula>
            <Table
              headers={['Output', 'How to interpret']}
              rows={[
                ['Hazard Ratio (HR)', 'Multiplicative change in hazard per unit increase in the spatial scalar. Direction depends on biology — for CD8+ cross-K toward tumor, HR < 1 often means higher co-localisation → better outcome; verify with KM curves.'],
                ['95% Confidence Interval', 'Range of plausible HR values. If the interval does not include 1.0, the association is statistically significant at α = 0.05.'],
                ['p-value', 'Two-sided Wald test. p < 0.05 conventionally indicates a statistically significant association.'],
                ['Concordance (C-index)', 'Proportion of patient pairs correctly ranked by risk. 0.5 = random; 1.0 = perfect. Values ≥ 0.60 indicate reasonable discrimination.'],
                ['Log-rank p-value', 'Non-parametric test of KM curve separation when patients are dichotomized (median or tertile split).'],
              ]}
            />
            <Callout type="tip">
              Enable <strong>Density Adjustment</strong> to add cell count and log(tissue area) as covariates.
              This separates the effect of spatial clustering from a simple increase in cell density, which can
              otherwise confound the clustering statistic.
            </Callout>

            <SubHeading id="survival-bivariate">Bivariate Cox (Spatial Clustering × Abundance)</SubHeading>
            <p className="text-slate-400 leading-relaxed mb-4">
              Patients are stratified into four quadrants by independently dichotomizing the spatial clustering
              scalar and cell abundance at the median (or tertile extremes for higher contrast):
            </p>
            <QuadrantDiagram />
            <div className="grid grid-cols-2 gap-3 mb-5">
              {[
                { q: 'High cluster / High abundance', label: 'Hot / Inflamed', color: 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300', desc: 'Both dense and spatially organized immune infiltrate near tumor. Best prognosis in immunotherapy-responsive tumors.' },
                { q: 'Low cluster / High abundance', label: 'Scattered Inflamed', color: 'border-sky-700/50 bg-sky-950/30 text-sky-300', desc: 'High cell count but random distribution — diffuse infiltration without spatial organization.' },
                { q: 'High cluster / Low abundance', label: 'Organized but Sparse', color: 'border-amber-700/50 bg-amber-950/30 text-amber-300', desc: 'Few cells but those present are spatially clustered, potentially reflecting focal immune reactivity.' },
                { q: 'Low cluster / Low abundance', label: 'Cold / Desert', color: 'border-rose-700/50 bg-rose-950/30 text-rose-300', desc: 'Neither abundant nor organized immune infiltrate. Associated with immune evasion and poor immunotherapy response.' },
              ].map(({ q, label, color, desc }) => (
                <div key={q} className={clsx('rounded-lg border p-3 text-sm', color)}>
                  <p className="font-semibold mb-1">{label}</p>
                  <p className="opacity-75 text-xs leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
            <p className="text-slate-400 text-sm leading-relaxed">
              The Low cluster / Low abundance quadrant is the reference group. Cox coefficients for the other
              three quadrants represent the log hazard ratio relative to this reference.
            </p>
          </section>

          {/* ── Clinical Analysis ── */}
          <section id="clinical">
            <SectionHeading id="clinical" icon={Stethoscope}>Clinical Analysis</SectionHeading>
            <p className="text-slate-400 leading-relaxed mb-4">
              The Clinical Analysis module tests associations between image-derived cell features (counts,
              percentages, ratios, and optional spatial clustering scalars) and uploaded clinical variables. It
              supports exploratory screening across all marker–variable pairs and confirmatory single-pair tests.
            </p>

            <Callout type="tip">
              <strong>Recommended workflow:</strong> (1) Upload clinical CSV and confirm the ID overlap banner
              shows matched rows. (2) Screen in the Association Matrix using <strong>FDR</strong>, not raw p-values.
              (3) Click a matrix cell to pre-fill a confirmatory test. (4) Export results for reporting.
            </Callout>

            <SubHeading id="clinical-level">Sample vs patient level</SubHeading>
            <p className="text-slate-400 leading-relaxed mb-3 text-sm">
              Toggle <strong className="text-slate-300">Per patient</strong> to average imaging features across
              all cores belonging to the same <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">patient_id</code>.
              Use patient level when multiple TMA cores map to one subject; use sample level when each core is
              an independent observation (enable cluster-robust SE in survival if patients have multiple cores).
            </p>

            <SubHeading>Feature Engineering</SubHeading>
            <p className="text-slate-400 leading-relaxed mb-3">
              The following features are automatically computed per patient from the imaging data:
            </p>
            <Table
              headers={['Feature', 'Formula', 'Example']}
              rows={[
                ['count_<type>', 'Raw cell count per patient sample', 'count_CD8_T_Cell'],
                ['pct_<type>', '(count_<type> / n_total) × 100', 'pct_Tumor'],
                ['ratio_<A>_over_<B>', 'count_A / count_B', 'ratio_CD8_T_Cell_over_Tumor'],
                ['spatial_cluster_stat', 'L(r₀)−r₀ or G(r₀)−G_CSR(r₀)', 'Per-patient scalar at chosen radius'],
                ['n_total', 'Total cells in all samples for that patient', '—'],
                ['tissue_area', 'Convex hull area (pixels²) summed across samples', '—'],
              ]}
            />

            <SubHeading>Screening (Association Matrix)</SubHeading>
            <p className="text-slate-400 leading-relaxed mb-3">
              The association matrix tests all marker–clinical pairs simultaneously. The statistical method is
              chosen automatically based on the variable types:
            </p>
            <Table
              headers={['Clinical variable', 'Marker type', 'Method', 'Effect size']}
              rows={[
                ['Continuous (numeric)', 'Continuous', 'Spearman correlation', 'ρ (rho)'],
                ['Categorical (2 groups)', 'Continuous', 'Wilcoxon rank-sum', 'Rank-biserial r'],
                ['Categorical (3+ groups)', 'Continuous', 'Kruskal-Wallis', 'η² (eta-squared)'],
                ['Any', 'Count / % / ratio', 'Beta-binomial regression', 'Log-odds ratio'],
                ['Survival (time + event)', 'Any', 'Cox proportional hazards', 'log(HR)'],
              ]}
            />
            <Callout type="warn">
              P-values in the screening matrix are corrected for multiple testing using the
              <strong> Benjamini-Hochberg False Discovery Rate (FDR)</strong> procedure. Use the
              <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">fdr</code> column—not
              the raw p-value—when making significance decisions from the screening matrix.
            </Callout>

            <SubHeading>Confirmatory Tests</SubHeading>
            <Table
              headers={['Test', 'Use case', 'Key outputs']}
              rows={[
                ['Wilcoxon rank-sum', 'Compare continuous cell feature between 2 groups', 'W statistic, p-value, rank-biserial r (effect size)'],
                ['Kruskal-Wallis', 'Compare feature across 3+ groups', 'H statistic, p-value, η²'],
                ['Linear regression', 'Predict continuous clinical variable from cell features', 'Coefficient, SE, p-value, R², adjusted-R²'],
                ['Logistic regression', 'Predict binary clinical outcome', 'Odds ratio, 95% CI, p-value, AIC'],
                ['Beta-binomial regression', 'Model overdispersed cell proportions (count / n_total)', 'Log-odds, dispersion, AIC'],
                ['Cox + KM (clinical)', 'Survival association for a cell-abundance feature', 'HR, CI, p-value, KM curve'],
              ]}
            />

            <SubHeading>Rank-Biserial Correlation</SubHeading>
            <p className="text-slate-400 leading-relaxed">
              The rank-biserial correlation r is the effect size for the Wilcoxon test:
            </p>
            <Formula>r = (2W / (n₁ × n₂)) − 1</Formula>
            <p className="text-slate-400 leading-relaxed mt-2">
              It ranges from −1 to +1. |r| ≈ 0.1 is a small effect, |r| ≈ 0.3 is medium, |r| ≈ 0.5 is large
              (Cohen's conventions). Positive r means the first group has higher values.
            </p>
          </section>

          {/* ── Interpreting Results ── */}
          <section id="interpretation">
            <SectionHeading id="interpretation" icon={Target}>Interpreting Results</SectionHeading>

            <SubHeading>P-values and Multiple Testing</SubHeading>
            <p className="text-slate-400 leading-relaxed mb-4">
              All p-values in single-pair confirmatory tests are raw (uncorrected). When using the screening
              association matrix, always use the FDR-adjusted value. A common threshold is FDR &lt; 0.10 for
              exploratory discovery and FDR &lt; 0.05 for confirmatory claims.
            </p>
            <Table
              headers={['Threshold', 'Interpretation']}
              rows={[
                ['p < 0.05 (raw)', 'Nominally significant in a single confirmatory test'],
                ['FDR < 0.10', 'Exploratory discovery in screening — follow up with confirmatory test'],
                ['FDR < 0.05', 'More stringent discovery threshold in screening'],
                ['Concordance ≥ 0.60', 'Cox model has reasonable discrimination ability'],
                ['|r| ≥ 0.30', 'Medium or larger effect size for Wilcoxon'],
                ['|ρ| ≥ 0.30', 'Moderate Spearman correlation between variables'],
              ]}
            />

            <SubHeading>Spatial Scalar Magnitude</SubHeading>
            <p className="text-slate-400 leading-relaxed mb-3">
              The absolute value of the spatial scalar (L(r)−r or G(r)−G_CSR(r)) depends on the tissue density
              and scale of the imaging data. Because pixel sizes vary across imaging platforms and magnifications,
              the scalar is best interpreted <strong className="text-slate-300">relative to other samples in the
              same dataset</strong> rather than as an absolute biologically universal threshold.
            </p>
            <Callout type="tip">
              Use the median-split (default) or tertile-split dichotomization in survival and clinical analyses to
              avoid relying on platform-specific absolute thresholds.
            </Callout>

            <SubHeading>Common Patterns and Their Meaning</SubHeading>
            <div className="space-y-3">
              {[
                {
                  pattern: 'High CD8+ T cell clustering near Tumor cells (high cross-K/G scalar)',
                  meaning: 'Active cytolytic immune attack — "hot" inflamed microenvironment. Associated with better prognosis and immunotherapy response.',
                  badge: 'Favorable',
                  color: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/40',
                },
                {
                  pattern: 'High CD8+ T cell count but low cross-K/G scalar toward Tumor',
                  meaning: 'Immune exclusion — T cells present in stroma but not infiltrating tumor nest. Despite abundance, anti-tumor function may be limited.',
                  badge: 'Exclusion',
                  color: 'text-amber-400 bg-amber-950/40 border-amber-800/40',
                },
                {
                  pattern: 'High CAF clustering between Tumor and T cells',
                  meaning: 'Physical immune barrier — fibroblasts may impede T cell access to tumor. Often co-occurs with TGF-β signaling.',
                  badge: 'Barrier',
                  color: 'text-rose-400 bg-rose-950/40 border-rose-800/40',
                },
                {
                  pattern: 'High B cell clustering + CD4+ T cells',
                  meaning: 'Tertiary lymphoid structure (TLS) formation. Associated with improved response to immune checkpoint blockade.',
                  badge: 'TLS',
                  color: 'text-sky-400 bg-sky-950/40 border-sky-800/40',
                },
                {
                  pattern: 'Low all immune cell counts, low spatial clustering',
                  meaning: '"Cold" or immune desert microenvironment. Associated with immune evasion and poor response to immunotherapy.',
                  badge: 'Cold',
                  color: 'text-slate-400 bg-slate-900/40 border-slate-700/40',
                },
              ].map(({ pattern, meaning, badge, color }) => (
                <div key={badge} className={clsx('rounded-lg border px-4 py-3 text-sm', color)}>
                  <div className="flex items-start gap-3">
                    <span className={clsx('text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 mt-0.5', color)}>
                      {badge}
                    </span>
                    <div>
                      <p className="font-medium mb-1">{pattern}</p>
                      <p className="opacity-75 leading-relaxed">{meaning}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Data Quality ── */}
          <section id="quality">
            <SectionHeading id="quality" icon={CheckCircle2}>Data Quality & Thresholds</SectionHeading>
            <p className="text-slate-400 leading-relaxed mb-4">
              Several quality thresholds are applied automatically to prevent unreliable results from sparse samples.
            </p>
            <Table
              headers={['Parameter', 'Default value', 'Effect']}
              rows={[
                ['Min cells per sample', '10', 'Samples with fewer total cells are excluded from spatial stats'],
                ['Min focal cells per sample', '10', 'Samples where the focal cell type appears fewer than 10 times are excluded'],
                ['Max cells per sample', '30,000', 'Samples are downsampled to this limit before spatstat computation for performance'],
                ['Max samples analyzed', '500', 'Analysis is capped at 500 samples per run'],
                ['CSR simulations', '49', 'Number of Monte Carlo simulations for envelope estimation'],
                ['API cell payload cap', '50,000', 'Maximum cells returned per API response for the spatial map'],
              ]}
            />
            <Callout type="warn">
              If a dataset has many samples with fewer than 10 focal cells, the effective sample size for survival
              and clinical analyses may be substantially smaller than the number of patients. Check the
              <strong> n</strong> and <strong>n_events</strong> values in the Cox output to verify sufficient power.
            </Callout>

            <SubHeading>Edge Effects</SubHeading>
            <p className="text-slate-400 leading-relaxed mb-3">
              Cells near the tissue boundary have fewer potential neighbours, which can artificially deflate K and
              G estimates. Edge corrections are applied by default:
            </p>
            <Table
              headers={['Function', 'Correction method', 'Notes']}
              rows={[
                ["Ripley's K", 'Isotropic (Ripley) correction', 'Weights each pair by the fraction of a circle at radius r that falls within the window'],
                ['Nearest-neighbour G', 'Kaplan-Meier (km) correction', 'Treats censored observations at the window boundary like right-censored survival data'],
              ]}
            />

            <SubHeading>Cluster-Robust Standard Errors</SubHeading>
            <p className="text-slate-400 leading-relaxed mb-6">
              When multiple tissue samples per patient are present, standard errors for Cox, linear, and logistic
              models are adjusted for within-patient correlation using the
              <strong className="text-slate-300"> sandwich estimator</strong> (clustered by
              <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">patient_id</code>). This
              prevents pseudoreplication from inflating statistical significance when multiple samples contribute
              to the same patient's spatial scalar.
            </p>

            <SubHeading id="limitations">Limitations & caveats</SubHeading>
            <ul className="text-sm text-slate-400 leading-relaxed space-y-2 mb-4 list-disc pl-5">
              <li>Spatial scalars are in <strong className="text-slate-300">pixel units</strong> — compare within a dataset, not across platforms without harmonisation.</li>
              <li>The tissue window is a <strong className="text-slate-300">convex hull</strong> — irregular or perforated tissue may be over-approximated.</li>
              <li>Downsampling (30k cells/sample) preserves density but may smooth fine-grained micro-clustering.</li>
              <li>Screening matrices test many hypotheses — always apply FDR correction before claiming discovery.</li>
              <li>Biological direction of HR depends on cell type and metric — a high auto-K for CD8+ may not mean the same as high cross-K toward tumor.</li>
            </ul>
          </section>

          {/* ── FAQ ── */}
          <section id="faq">
            <SectionHeading id="faq" icon={HelpCircle}>FAQ & Troubleshooting</SectionHeading>
            <p className="text-slate-400 leading-relaxed mb-5 text-sm">
              Common questions when running analyses. For API errors, confirm{' '}
              <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">curl {API_URL}/health</code> succeeds.
            </p>

            <FaqItem q="Why were my samples excluded from spatial stats?">
              Samples are dropped when they have fewer than the <strong>min focal cells</strong> threshold (default 10)
              for the selected cell type, or fewer than 10 total cells. Check the amber warning banner on the
              Survival or Spatial Stats tab for the exact exclusion count.
            </FaqItem>

            <FaqItem q="Why is N in my Cox model smaller than my cohort?">
              ID mismatches between imaging and survival/clinical files, focal-cell filtering, and tissue-region
              restrictions all reduce N. Check the ID overlap banner on Clinical Analysis and the{' '}
              <strong>n</strong> / <strong>n_events</strong> summary in Cox output.
            </FaqItem>

            <FaqItem q="What radius should I use for K or G?">
              Defaults (50 px for K, 20 px for G) work as starting points within a dataset. If the app shows a
              radius guidance warning, the chosen radius may exceed the tissue scale — try a smaller value or
              compare relative rankings via median splits rather than absolute scalars.
            </FaqItem>

            <FaqItem q="HR > 1 — does that mean worse prognosis?">
              Not always. HR direction depends on whether higher clustering is biologically favourable for your
              cell type and metric. Cross-K of CD8+ toward Tumor often favours HR &lt; 1; auto-K at high abundance
              can mean peripheral aggregation. Always read the KM curves alongside the HR.
            </FaqItem>

            <FaqItem q="Backend not reachable / upload failed">
              Start both services with <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">npm run dev</code>.
              Verify <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">{API_URL}/health</code>.
              If the dataset id starts with <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">ds_</code>,
              the original cells upload never reached the API — re-upload via Contribute.
            </FaqItem>

            <FaqItem q="Bivariate Cox shows an empty reference quadrant">
              With tertile splits, no samples may fall in Low cluster · Low abundance. Switch to{' '}
              <strong>Median split</strong> in the bivariate panel, or widen the cohort.
            </FaqItem>

            <FaqItem q="Should I use raw p-values or FDR from the screening matrix?">
              Always use <strong>FDR</strong> for the association matrix. Raw p-values are appropriate only for
              a single pre-specified confirmatory test you planned before seeing the data.
            </FaqItem>

            <FaqItem q="How do I try the app without uploading my own data?">
              Browse <Link to="/explore" className="text-brand-400 hover:underline">Explore</Link> for bundled demo
              datasets, or run <code className="text-brand-300 text-xs bg-slate-900 px-1 py-0.5 rounded">npm run seed:test1</code> to
              load the ovarian TMA test cohort with survival-ready IDs.
            </FaqItem>
          </section>

          {/* ── Glossary ── */}
          <section id="glossary">
            <SectionHeading id="glossary" icon={BookOpen}>Glossary</SectionHeading>
            <p className="text-slate-400 leading-relaxed mb-5 text-sm">
              Short definitions for acronyms and terms used throughout the portal and this documentation.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              {GLOSSARY.map(({ term, def }) => (
                <div key={term} className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
                  <p className="text-sm font-semibold text-brand-300 mb-1">{term}</p>
                  <p className="text-xs text-slate-400 leading-relaxed">{def}</p>
                </div>
              ))}
            </div>
          </section>

          {/* bottom spacer */}
          <div className="h-16" />
        </main>
      </div>
      <BackToTop />
    </div>
  );
}
