import type { Dataset, User, Comment, CellPoint, SpatialLayer } from '../types';

function gaussian(mean: number, std: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function generateCells(config: {
  n: number;
  clusters: Array<{ cx: number; cy: number; r: number; cellType: string; markers: Record<string, [number, number]> }>;
}): CellPoint[] {
  const cells: CellPoint[] = [];
  const perCluster = Math.floor(config.n / config.clusters.length);
  config.clusters.forEach((cl, ci) => {
    const count = ci === config.clusters.length - 1 ? config.n - cells.length : perCluster;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * cl.r;
      const x = cl.cx + radius * Math.cos(angle) + gaussian(0, cl.r * 0.1);
      const y = cl.cy + radius * Math.sin(angle) + gaussian(0, cl.r * 0.1);
      const markers: Record<string, number> = {};
      for (const [m, [lo, hi]] of Object.entries(cl.markers)) {
        markers[m] = Math.max(0, Math.min(1, lo + Math.random() * (hi - lo) + gaussian(0, 0.05)));
      }
      cells.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, cellType: cl.cellType, markers, cluster: ci, region: cl.cellType });
    }
  });
  return cells;
}

const LAYERS_IMMUNE: SpatialLayer[] = [
  { id: 'tumor',  name: 'Tumor Cells',     type: 'cell',       cellType: 'Tumor',        color: '#ef4444', visible: true,  opacity: 0.85 },
  { id: 'cd8',    name: 'CD8+ T Cells',    type: 'cell',       cellType: 'CD8+ T Cell',  color: '#3b82f6', visible: true,  opacity: 0.85 },
  { id: 'cd4',    name: 'CD4+ T Cells',    type: 'cell',       cellType: 'CD4+ T Cell',  color: '#8b5cf6', visible: true,  opacity: 0.85 },
  { id: 'macro',  name: 'Macrophages',     type: 'cell',       cellType: 'Macrophage',   color: '#f59e0b', visible: false, opacity: 0.85 },
  { id: 'nk',     name: 'NK Cells',        type: 'cell',       cellType: 'NK Cell',      color: '#10b981', visible: false, opacity: 0.85 },
  { id: 'stroma', name: 'Stromal Cells',   type: 'cell',       cellType: 'Stromal',      color: '#6b7280', visible: false, opacity: 0.7 },
  { id: 'tumor_r',name: 'Tumor Region',    type: 'region',     color: '#ef444430', visible: true,  opacity: 0.3 },
  { id: 'pdl1',   name: 'PD-L1 Expr.',     type: 'expression', color: '#f97316', visible: false, opacity: 0.8 },
];

const LAYERS_LUNG: SpatialLayer[] = [
  { id: 'tumor',  name: 'Tumor Cells',     type: 'cell',       cellType: 'Tumor',        color: '#dc2626', visible: true,  opacity: 0.85 },
  { id: 'cd8',    name: 'CD8+ T Cells',    type: 'cell',       cellType: 'CD8+ T Cell',  color: '#2563eb', visible: true,  opacity: 0.85 },
  { id: 'b_cells',name: 'B Cells',         type: 'cell',       cellType: 'B Cell',       color: '#7c3aed', visible: false, opacity: 0.85 },
  { id: 'macro',  name: 'Macrophages',     type: 'cell',       cellType: 'Macrophage',   color: '#d97706', visible: false, opacity: 0.85 },
  { id: 'fibro',  name: 'Fibroblasts',     type: 'cell',       cellType: 'Fibroblast',   color: '#059669', visible: false, opacity: 0.85 },
  { id: 'ki67',   name: 'Ki67 Expr.',      type: 'expression', color: '#ec4899', visible: false, opacity: 0.8 },
];

const LUNG_CELLS = generateCells({
  n: 1800,
  clusters: [
    { cx: 400, cy: 300, r: 150, cellType: 'Tumor', markers: { 'PD-L1': [0.4, 0.95], 'Ki67': [0.5, 0.9], 'CD8': [0, 0.1], 'CK': [0.7, 1] } },
    { cx: 250, cy: 200, r: 80,  cellType: 'CD8+ T Cell', markers: { 'PD-L1': [0, 0.2], 'Ki67': [0.1, 0.4], 'CD8': [0.7, 1], 'CK': [0, 0.05] } },
    { cx: 560, cy: 200, r: 70,  cellType: 'CD8+ T Cell', markers: { 'PD-L1': [0, 0.15], 'Ki67': [0.1, 0.3], 'CD8': [0.8, 1], 'CK': [0, 0.05] } },
    { cx: 350, cy: 480, r: 90,  cellType: 'Macrophage',  markers: { 'PD-L1': [0.2, 0.7], 'Ki67': [0, 0.2], 'CD8': [0, 0.1], 'CK': [0, 0.1] } },
    { cx: 200, cy: 420, r: 60,  cellType: 'B Cell',      markers: { 'PD-L1': [0, 0.1], 'Ki67': [0.1, 0.4], 'CD8': [0, 0.1], 'CK': [0, 0.05] } },
    { cx: 580, cy: 430, r: 75,  cellType: 'Fibroblast',  markers: { 'PD-L1': [0, 0.2], 'Ki67': [0, 0.15], 'CD8': [0, 0.05], 'CK': [0, 0.1] } },
    { cx: 100, cy: 130, r: 55,  cellType: 'CD8+ T Cell', markers: { 'PD-L1': [0, 0.1], 'Ki67': [0.2, 0.5], 'CD8': [0.75, 1], 'CK': [0, 0.05] } },
    { cx: 670, cy: 310, r: 65,  cellType: 'Fibroblast',  markers: { 'PD-L1': [0, 0.15], 'Ki67': [0, 0.1], 'CD8': [0, 0.05], 'CK': [0, 0.08] } },
  ],
});

const BREAST_CELLS = generateCells({
  n: 2200,
  clusters: [
    { cx: 350, cy: 350, r: 180, cellType: 'Tumor', markers: { 'ER': [0.6, 1], 'PR': [0.4, 0.9], 'HER2': [0, 0.3], 'Ki67': [0.3, 0.8], 'CD8': [0, 0.1] } },
    { cx: 180, cy: 180, r: 70,  cellType: 'CD8+ T Cell', markers: { 'ER': [0, 0.05], 'PR': [0, 0.05], 'HER2': [0, 0.05], 'Ki67': [0.2, 0.5], 'CD8': [0.75, 1] } },
    { cx: 540, cy: 180, r: 65,  cellType: 'CD4+ T Cell', markers: { 'ER': [0, 0.05], 'PR': [0, 0.05], 'HER2': [0, 0.05], 'Ki67': [0.1, 0.4], 'CD8': [0.1, 0.4] } },
    { cx: 180, cy: 520, r: 80,  cellType: 'Macrophage',  markers: { 'ER': [0, 0.1], 'PR': [0, 0.1], 'HER2': [0, 0.1], 'Ki67': [0, 0.2], 'CD8': [0, 0.1] } },
    { cx: 540, cy: 520, r: 75,  cellType: 'NK Cell',     markers: { 'ER': [0, 0.05], 'PR': [0, 0.05], 'HER2': [0, 0.05], 'Ki67': [0.1, 0.3], 'CD8': [0.2, 0.6] } },
    { cx: 80,  cy: 350, r: 55,  cellType: 'Stromal',     markers: { 'ER': [0.1, 0.3], 'PR': [0.1, 0.3], 'HER2': [0, 0.1], 'Ki67': [0, 0.15], 'CD8': [0, 0.05] } },
    { cx: 620, cy: 350, r: 60,  cellType: 'Stromal',     markers: { 'ER': [0.1, 0.35], 'PR': [0.1, 0.3], 'HER2': [0, 0.1], 'Ki67': [0, 0.15], 'CD8': [0, 0.05] } },
    { cx: 350, cy: 80,  r: 55,  cellType: 'CD8+ T Cell', markers: { 'ER': [0, 0.05], 'PR': [0, 0.05], 'HER2': [0, 0.05], 'Ki67': [0.2, 0.5], 'CD8': [0.7, 1] } },
    { cx: 350, cy: 620, r: 60,  cellType: 'Macrophage',  markers: { 'ER': [0, 0.15], 'PR': [0, 0.1], 'HER2': [0, 0.1], 'Ki67': [0, 0.25], 'CD8': [0, 0.1] } },
  ],
});

const MELANOMA_CELLS = generateCells({
  n: 1600,
  clusters: [
    { cx: 300, cy: 300, r: 140, cellType: 'Tumor',       markers: { 'MART1': [0.6, 1], 'PD-L1': [0.3, 0.9], 'S100': [0.5, 0.95], 'CD8': [0, 0.1] } },
    { cx: 150, cy: 150, r: 75,  cellType: 'CD8+ T Cell', markers: { 'MART1': [0, 0.05], 'PD-L1': [0, 0.2], 'S100': [0, 0.05], 'CD8': [0.7, 1] } },
    { cx: 460, cy: 150, r: 70,  cellType: 'CD8+ T Cell', markers: { 'MART1': [0, 0.05], 'PD-L1': [0, 0.15], 'S100': [0, 0.05], 'CD8': [0.8, 1] } },
    { cx: 150, cy: 450, r: 70,  cellType: 'Macrophage',  markers: { 'MART1': [0, 0.1], 'PD-L1': [0.2, 0.8], 'S100': [0, 0.1], 'CD8': [0, 0.1] } },
    { cx: 460, cy: 450, r: 65,  cellType: 'NK Cell',     markers: { 'MART1': [0, 0.05], 'PD-L1': [0, 0.15], 'S100': [0, 0.05], 'CD8': [0.3, 0.7] } },
    { cx: 80,  cy: 300, r: 50,  cellType: 'Stromal',     markers: { 'MART1': [0, 0.1], 'PD-L1': [0, 0.2], 'S100': [0, 0.1], 'CD8': [0, 0.05] } },
    { cx: 520, cy: 300, r: 50,  cellType: 'Stromal',     markers: { 'MART1': [0, 0.1], 'PD-L1': [0, 0.2], 'S100': [0, 0.1], 'CD8': [0, 0.05] } },
  ],
});

const COLORECTAL_CELLS = generateCells({
  n: 2000,
  clusters: [
    { cx: 360, cy: 360, r: 170, cellType: 'Tumor',       markers: { 'CEA': [0.5, 0.95], 'EGFR': [0.3, 0.8], 'Ki67': [0.4, 0.9], 'CD8': [0, 0.1], 'PD-L1': [0.1, 0.6] } },
    { cx: 170, cy: 170, r: 80,  cellType: 'CD8+ T Cell', markers: { 'CEA': [0, 0.05], 'EGFR': [0, 0.05], 'Ki67': [0.2, 0.5], 'CD8': [0.75, 1], 'PD-L1': [0, 0.2] } },
    { cx: 550, cy: 170, r: 75,  cellType: 'CD4+ T Cell', markers: { 'CEA': [0, 0.05], 'EGFR': [0, 0.05], 'Ki67': [0.1, 0.4], 'CD8': [0.1, 0.4], 'PD-L1': [0, 0.15] } },
    { cx: 170, cy: 550, r: 80,  cellType: 'Macrophage',  markers: { 'CEA': [0, 0.1], 'EGFR': [0, 0.1], 'Ki67': [0, 0.2], 'CD8': [0, 0.1], 'PD-L1': [0.2, 0.75] } },
    { cx: 550, cy: 550, r: 70,  cellType: 'B Cell',      markers: { 'CEA': [0, 0.05], 'EGFR': [0, 0.05], 'Ki67': [0.1, 0.35], 'CD8': [0, 0.1], 'PD-L1': [0, 0.1] } },
    { cx: 80,  cy: 360, r: 55,  cellType: 'Stromal',     markers: { 'CEA': [0.1, 0.3], 'EGFR': [0.1, 0.3], 'Ki67': [0, 0.15], 'CD8': [0, 0.05], 'PD-L1': [0, 0.15] } },
    { cx: 640, cy: 360, r: 55,  cellType: 'Stromal',     markers: { 'CEA': [0.1, 0.3], 'EGFR': [0.1, 0.3], 'Ki67': [0, 0.15], 'CD8': [0, 0.05], 'PD-L1': [0, 0.15] } },
  ],
});

export const MOCK_DATASETS: Dataset[] = [
  {
    id: 'ds001',
    title: 'NSCLC Tumor Microenvironment – PD-L1 Spatial Atlas',
    description: 'High-resolution spatial profiling of non-small cell lung cancer tumors using mIHC. Maps the distribution of CD8+ T cells, PD-L1+ tumor cells, and macrophages across 18 patient specimens to delineate immune exclusion patterns.',
    cancerType: 'Lung (NSCLC)',
    tissue: 'Lung',
    technique: 'Multiplex IHC (mIHC)',
    markers: ['PD-L1', 'CD8', 'Ki67', 'CK'],
    cellTypes: ['Tumor', 'CD8+ T Cell', 'Macrophage', 'B Cell', 'Fibroblast'],
    contributor: 'Dr. Sarah Chen',
    contributorId: 'u001',
    institution: 'Moffitt Cancer Center',
    date: '2024-11-15',
    isPublic: true,
    status: 'published',
    tags: ['NSCLC', 'PD-L1', 'immune exclusion', 'checkpoint'],
    cellCount: 1800,
    sampleCount: 18,
    doi: '10.1038/s41587-024-00001-1',
    publication: 'Nature Biotechnology, 2024',
    viewCount: 3420,
    downloads: 284,
    region: { lat: 27.9, lng: -82.5, name: 'Tampa, FL' },
    cells: LUNG_CELLS,
    layers: LAYERS_LUNG,
    methods: 'Multiplex IHC performed on FFPE tissue sections using Opal 7-color kit (Akoya Biosciences). Automated image acquisition with PerkinElmer Vectra Polaris. Cell segmentation via HALO (Indica Labs). Spatial analysis in R using spatstat and Seurat.',
    dataSource: 'Moffitt Cancer Center Tissue Core, Tampa FL. IRB #MCC20568.',
  },
  {
    id: 'ds002',
    title: 'Breast Cancer TME: ER+/HER2− Immune Landscape',
    description: 'Spatial transcriptomics and multiplex immunofluorescence study of hormone receptor-positive breast cancer. Characterizes tumor-infiltrating lymphocyte spatial organization and its relationship to clinical outcome in 26 patients.',
    cancerType: 'Breast (ER+/HER2−)',
    tissue: 'Breast',
    technique: 'Spatial Transcriptomics (10x Visium)',
    markers: ['ER', 'PR', 'HER2', 'Ki67', 'CD8'],
    cellTypes: ['Tumor', 'CD8+ T Cell', 'CD4+ T Cell', 'Macrophage', 'NK Cell', 'Stromal'],
    contributor: 'Dr. James Oliveira',
    contributorId: 'u002',
    institution: 'MD Anderson Cancer Center',
    date: '2024-09-03',
    isPublic: true,
    status: 'published',
    tags: ['breast cancer', 'ER+', 'TILs', 'spatial transcriptomics'],
    cellCount: 2200,
    sampleCount: 26,
    doi: '10.1016/j.cell.2024.09.003',
    publication: 'Cell, 2024',
    viewCount: 5810,
    downloads: 612,
    region: { lat: 29.7, lng: -95.4, name: 'Houston, TX' },
    cells: BREAST_CELLS,
    layers: LAYERS_IMMUNE,
    methods: '10x Genomics Visium spatial transcriptomics performed on OCT-embedded sections. Library preparation with Visium FFPE kit v2. Sequencing on NovaSeq 6000 (Illumina). Downstream analysis using Seurat v4 and RCTD for cell deconvolution.',
    dataSource: 'MD Anderson Breast Cancer SPORE tissue bank. De-identified under IRB PA21-0419.',
  },
  {
    id: 'ds003',
    title: 'Melanoma Immunotherapy Response: Pre vs. Post-Treatment Spatial Analysis',
    description: 'Paired pre- and post-anti-PD1 treatment tumor sections from 14 melanoma patients. Spatial analysis reveals CD8+ T cell infiltration dynamics and PD-L1 remodeling patterns associated with complete response.',
    cancerType: 'Melanoma',
    tissue: 'Skin',
    technique: 'CODEX (CO-Detection by indEXing)',
    markers: ['MART1', 'PD-L1', 'S100', 'CD8'],
    cellTypes: ['Tumor', 'CD8+ T Cell', 'Macrophage', 'NK Cell', 'Stromal'],
    contributor: 'Dr. Aisha Patel',
    contributorId: 'u003',
    institution: 'Stanford Cancer Institute',
    date: '2024-07-22',
    isPublic: true,
    status: 'published',
    tags: ['melanoma', 'immunotherapy', 'anti-PD1', 'CODEX'],
    cellCount: 1600,
    sampleCount: 28,
    doi: '10.1126/science.abo1234',
    publication: 'Science, 2024',
    viewCount: 7230,
    downloads: 891,
    region: { lat: 37.4, lng: -122.2, name: 'Stanford, CA' },
    cells: MELANOMA_CELLS,
    layers: [
      { id: 'tumor',  name: 'Tumor Cells',     type: 'cell',       cellType: 'Tumor',        color: '#a855f7', visible: true,  opacity: 0.85 },
      { id: 'cd8',    name: 'CD8+ T Cells',    type: 'cell',       cellType: 'CD8+ T Cell',  color: '#3b82f6', visible: true,  opacity: 0.85 },
      { id: 'macro',  name: 'Macrophages',     type: 'cell',       cellType: 'Macrophage',   color: '#f59e0b', visible: false, opacity: 0.85 },
      { id: 'nk',     name: 'NK Cells',        type: 'cell',       cellType: 'NK Cell',      color: '#10b981', visible: false, opacity: 0.85 },
      { id: 'stroma', name: 'Stromal Cells',   type: 'cell',       cellType: 'Stromal',      color: '#6b7280', visible: false, opacity: 0.7 },
      { id: 'pdl1',   name: 'PD-L1 Expr.',     type: 'expression', color: '#f97316', visible: false, opacity: 0.8 },
      { id: 'mart1',  name: 'MART1 Expr.',      type: 'expression', color: '#a855f7', visible: false, opacity: 0.8 },
    ],
    methods: 'CODEX multiplexed tissue imaging using 28-marker antibody panel. Tissue sections from FFPE blocks. Image processing using CellSeg and CODEX Processor. Phenotyping via FlowSOM clustering. Spatial statistics using scimap (Python).',
    dataSource: 'Stanford Melanoma SPORE. Specimens collected under IRB-56389.',
  },
  {
    id: 'ds004',
    title: 'Colorectal Cancer Spatial Immune Atlas (MSI vs. MSS)',
    description: 'Comparative spatial analysis of microsatellite-instable (MSI) vs. microsatellite-stable (MSS) colorectal tumors. Characterizes how mismatch repair status shapes immune cell infiltration topology.',
    cancerType: 'Colorectal',
    tissue: 'Colon',
    technique: 'Multiplex IF (Opal)',
    markers: ['CEA', 'EGFR', 'Ki67', 'CD8', 'PD-L1'],
    cellTypes: ['Tumor', 'CD8+ T Cell', 'CD4+ T Cell', 'Macrophage', 'B Cell', 'Stromal'],
    contributor: 'Dr. Marcus Webb',
    contributorId: 'u004',
    institution: 'Johns Hopkins Oncology',
    date: '2025-01-10',
    isPublic: true,
    status: 'published',
    tags: ['colorectal', 'MSI', 'MSS', 'immune atlas'],
    cellCount: 2000,
    sampleCount: 32,
    doi: '10.1038/s41591-025-00100-3',
    publication: 'Nature Medicine, 2025',
    viewCount: 4105,
    downloads: 438,
    region: { lat: 39.3, lng: -76.6, name: 'Baltimore, MD' },
    cells: COLORECTAL_CELLS,
    layers: [
      { id: 'tumor',  name: 'Tumor Cells',     type: 'cell',       cellType: 'Tumor',        color: '#f43f5e', visible: true,  opacity: 0.85 },
      { id: 'cd8',    name: 'CD8+ T Cells',    type: 'cell',       cellType: 'CD8+ T Cell',  color: '#3b82f6', visible: true,  opacity: 0.85 },
      { id: 'cd4',    name: 'CD4+ T Cells',    type: 'cell',       cellType: 'CD4+ T Cell',  color: '#8b5cf6', visible: false, opacity: 0.85 },
      { id: 'macro',  name: 'Macrophages',     type: 'cell',       cellType: 'Macrophage',   color: '#f59e0b', visible: false, opacity: 0.85 },
      { id: 'b_cell', name: 'B Cells',         type: 'cell',       cellType: 'B Cell',       color: '#06b6d4', visible: false, opacity: 0.85 },
      { id: 'stroma', name: 'Stromal Cells',   type: 'cell',       cellType: 'Stromal',      color: '#6b7280', visible: false, opacity: 0.7 },
      { id: 'egfr',   name: 'EGFR Expression', type: 'expression', color: '#84cc16', visible: false, opacity: 0.8 },
    ],
    methods: 'Opal multiplex IF using 6-plex panel on 4μm FFPE sections. Slide scanning at 20x on Vectra Polaris. Cell segmentation and phenotyping using HALO v3.4. MSI/MSS status confirmed by PCR fragment analysis.',
    dataSource: 'Johns Hopkins Colorectal Cancer Biobank. Study approved under IRB NA_00098734.',
  },
  {
    id: 'ds005',
    title: 'Pancreatic Ductal Adenocarcinoma: Stromal-Immune Interface',
    description: 'Dense stromal microenvironment spatial mapping in PDAC. Quantifies the physical barriers posed by CAF networks to T cell infiltration, and identifies spatial niches enriched for immunosuppressive macrophages.',
    cancerType: 'Pancreatic (PDAC)',
    tissue: 'Pancreas',
    technique: 'MERFISH',
    markers: ['FAP', 'αSMA', 'CD3', 'CD68', 'PD-L1'],
    cellTypes: ['Tumor', 'CAF', 'CD8+ T Cell', 'Macrophage', 'Stromal'],
    contributor: 'Dr. Elena Novak',
    contributorId: 'u005',
    institution: 'Memorial Sloan Kettering',
    date: '2025-02-28',
    isPublic: true,
    status: 'published',
    tags: ['PDAC', 'stroma', 'CAF', 'immune exclusion', 'MERFISH'],
    cellCount: 1400,
    sampleCount: 22,
    doi: '10.1016/j.ccell.2025.02.004',
    publication: 'Cancer Cell, 2025',
    viewCount: 2890,
    downloads: 312,
    region: { lat: 40.7, lng: -73.9, name: 'New York, NY' },
    cells: generateCells({
      n: 1400,
      clusters: [
        { cx: 320, cy: 320, r: 130, cellType: 'Tumor',       markers: { 'FAP': [0, 0.2], 'αSMA': [0, 0.2], 'CD3': [0, 0.1], 'CD68': [0, 0.1], 'PD-L1': [0.2, 0.8] } },
        { cx: 320, cy: 320, r: 200, cellType: 'CAF',         markers: { 'FAP': [0.6, 1], 'αSMA': [0.5, 0.95], 'CD3': [0, 0.1], 'CD68': [0, 0.1], 'PD-L1': [0, 0.3] } },
        { cx: 120, cy: 120, r: 60,  cellType: 'CD8+ T Cell', markers: { 'FAP': [0, 0.1], 'αSMA': [0, 0.1], 'CD3': [0.7, 1], 'CD68': [0, 0.05], 'PD-L1': [0, 0.2] } },
        { cx: 520, cy: 120, r: 55,  cellType: 'CD8+ T Cell', markers: { 'FAP': [0, 0.1], 'αSMA': [0, 0.1], 'CD3': [0.75, 1], 'CD68': [0, 0.05], 'PD-L1': [0, 0.2] } },
        { cx: 120, cy: 520, r: 65,  cellType: 'Macrophage',  markers: { 'FAP': [0, 0.15], 'αSMA': [0, 0.15], 'CD3': [0, 0.1], 'CD68': [0.6, 1], 'PD-L1': [0.3, 0.85] } },
        { cx: 520, cy: 520, r: 60,  cellType: 'Macrophage',  markers: { 'FAP': [0, 0.15], 'αSMA': [0, 0.15], 'CD3': [0, 0.1], 'CD68': [0.55, 0.95], 'PD-L1': [0.25, 0.8] } },
      ],
    }),
    layers: [
      { id: 'tumor',  name: 'Tumor Cells',     type: 'cell',       cellType: 'Tumor',        color: '#ef4444', visible: true,  opacity: 0.85 },
      { id: 'caf',    name: 'CAFs',            type: 'cell',       cellType: 'CAF',          color: '#f97316', visible: true,  opacity: 0.85 },
      { id: 'cd8',    name: 'CD8+ T Cells',    type: 'cell',       cellType: 'CD8+ T Cell',  color: '#3b82f6', visible: true,  opacity: 0.85 },
      { id: 'macro',  name: 'Macrophages',     type: 'cell',       cellType: 'Macrophage',   color: '#f59e0b', visible: false, opacity: 0.85 },
      { id: 'fap',    name: 'FAP Expression',  type: 'expression', color: '#f97316', visible: false, opacity: 0.8 },
      { id: 'asma',   name: 'αSMA Expression', type: 'expression', color: '#84cc16', visible: false, opacity: 0.8 },
    ],
    methods: 'MERFISH performed using Vizgen MERSCOPE platform with custom 300-gene panel. Tissue sections at 10μm. Cell segmentation using DAPI + PolyT signals. Analysis pipeline: Baysor for segmentation, Squidpy for spatial analysis.',
    dataSource: 'MSK PDAC Tissue Bank. Specimens from resection surgeries, IRB #20-028.',
  },
];

export const MOCK_USERS: User[] = [
  { id: 'u001', name: 'Dr. Sarah Chen',    email: 's.chen@moffitt.org',    role: 'researcher', institution: 'Moffitt Cancer Center',    joinedAt: '2023-03-12' },
  { id: 'u002', name: 'Dr. James Oliveira',email: 'j.oliveira@mdacc.edu',  role: 'researcher', institution: 'MD Anderson Cancer Center', joinedAt: '2023-05-20' },
  { id: 'u003', name: 'Dr. Aisha Patel',   email: 'a.patel@stanford.edu',  role: 'researcher', institution: 'Stanford Cancer Institute', joinedAt: '2023-08-01' },
  { id: 'u004', name: 'Dr. Marcus Webb',   email: 'm.webb@jhmi.edu',       role: 'researcher', institution: 'Johns Hopkins Oncology',    joinedAt: '2024-01-15' },
  { id: 'u005', name: 'Dr. Elena Novak',   email: 'e.novak@mskcc.org',     role: 'researcher', institution: 'Memorial Sloan Kettering', joinedAt: '2024-02-10' },
  { id: 'admin', name: 'Portal Admin',      email: 'admin@spatialportal.io', role: 'admin',      institution: 'SpatialBio Portal',        joinedAt: '2022-01-01' },
];

export const MOCK_COMMENTS: Comment[] = [
  { id: 'c001', datasetId: 'ds001', userId: 'u002', userName: 'Dr. James Oliveira', text: 'Excellent spatial resolution. The immune exclusion patterns here closely mirror what we see in our breast cancer cohort. Would love to compare distance metrics.', createdAt: '2024-11-20' },
  { id: 'c002', datasetId: 'ds001', userId: 'u003', userName: 'Dr. Aisha Patel', text: 'Have you tried applying proximity scoring between PD-L1+ tumor cells and CD8+ T cells? The exclusion zones seem quantifiable from this data.', createdAt: '2024-11-22' },
  { id: 'c003', datasetId: 'ds002', userId: 'u001', userName: 'Dr. Sarah Chen', text: 'The TIL spatial organization in ER+ cases is striking. This would pair well with our NSCLC atlas for cross-cancer comparison.', createdAt: '2024-09-10' },
  { id: 'c004', datasetId: 'ds003', userId: 'u004', userName: 'Dr. Marcus Webb', text: 'The pre/post treatment comparison methodology is rigorous. We applied a similar approach to CRC and found comparable spatial remodeling patterns.', createdAt: '2024-07-30' },
];

export const CANCER_TYPES = ['All', 'Lung (NSCLC)', 'Breast (ER+/HER2−)', 'Melanoma', 'Colorectal', 'Pancreatic (PDAC)'];
export const TECHNIQUES   = ['All', 'Multiplex IHC (mIHC)', 'Spatial Transcriptomics (10x Visium)', 'CODEX (CO-Detection by indEXing)', 'Multiplex IF (Opal)', 'MERFISH'];
export const ALL_MARKERS  = ['PD-L1', 'CD8', 'Ki67', 'CK', 'ER', 'PR', 'HER2', 'MART1', 'S100', 'CEA', 'EGFR', 'FAP', 'αSMA', 'CD3', 'CD68'];
