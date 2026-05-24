export type Role = 'admin' | 'researcher' | 'viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  institution: string;
  avatar?: string;
  joinedAt: string;
}

export interface CellPoint {
  x: number;
  y: number;
  cellType: string;
  markers: Record<string, number>;
  cluster?: number;
  region?: string;
}

export interface SpatialLayer {
  id: string;
  name: string;
  type: 'cell' | 'region' | 'expression' | 'annotation';
  cellType?: string;
  color: string;
  visible: boolean;
  opacity: number;
}

export interface Dataset {
  id: string;
  title: string;
  description: string;
  cancerType: string;
  tissue: string;
  technique: string;
  markers: string[];
  cellTypes: string[];
  contributor: string;
  contributorId: string;
  institution: string;
  date: string;
  isPublic: boolean;
  status: 'published' | 'pending' | 'draft';
  tags: string[];
  cellCount: number;
  sampleCount: number;
  doi?: string;
  publication?: string;
  thumbnail?: string;
  cells: CellPoint[];
  layers: SpatialLayer[];
  methods: string;
  dataSource: string;
  viewCount: number;
  downloads: number;
  region?: { lat: number; lng: number; name: string };
}

export interface Comment {
  id: string;
  datasetId: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: string;
}

export type FilterState = {
  search: string;
  cancerType: string;
  technique: string;
  marker: string;
  dateRange: string;
  contributor: string;
};
