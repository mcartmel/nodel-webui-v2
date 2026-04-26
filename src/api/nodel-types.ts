export interface NodelLocalNodeEntry {
  name: string;
  node?: string;
  address?: string;
  desc?: string;
  [key: string]: unknown;
}

export interface NodelNodeUrlEntry {
  address: string;
  name?: string;
  node?: string;
  host?: string;
  [key: string]: unknown;
}

export interface NodelLocalRestResponse {
  nodes?: Record<string, NodelLocalNodeEntry>;
  [key: string]: unknown;
}

export interface NodelDiagnosticsResponse {
  hostname?: string;
  httpAddresses?: string[];
  uptime?: number;
  startTime?: string;
  hostPath?: string;
  nodesRoot?: string;
  hostingRule?: string;
  agent?: string;
  availableProcessors?: number;
  freeMemory?: number;
  maxMemory?: number;
  totalMemory?: number;
  systemProperties?: Record<string, unknown>;
  vmArgs?: string[];
  [key: string]: unknown;
}

export interface NodelBuildInfo {
  project?: string;
  origin?: string;
  branch?: string;
  version?: string;
  id?: string;
  rev?: string;
  host?: string;
  date?: string;
  [key: string]: unknown;
}

export interface NodelRecipeEntry {
  path: string;
  [key: string]: unknown;
}
