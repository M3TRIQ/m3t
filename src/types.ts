export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

export interface Job {
  id: string;
  job_type: string;
  title: string;
  status: string;
  progress_percentage: number;
  current_step: string;
  result_data: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
}

export interface DockingParams {
  project_id: string;
  title: string;
  protein_pdb: string;
  ligand_smiles: string;
  scoring_function?: 'vina' | 'gnina';
  exhaustiveness?: number;
  center_x: number;
  center_y: number;
  center_z: number;
  size_x?: number;
  size_y?: number;
  size_z?: number;
  num_modes?: number;
}

export interface BatchDockingParams {
  project_id: string;
  title: string;
  protein_pdb: string;
  ligand_smiles_list: string[];
  scoring_function?: 'vina' | 'gnina';
  center_x: number;
  center_y: number;
  center_z: number;
  size_x?: number;
  size_y?: number;
  size_z?: number;
}

export interface StructurePredictionParams {
  project_id: string;
  sequence: string;
  method?: 'esmfold' | 'alphafold2';
  name?: string;
}

export interface DiffDockParams {
  project_id: string;
  ligand_smiles: string;
  protein_pdb: string;
  num_samples?: number;
}

export interface SandboxParams {
  project_id: string;
  script: string;
  script_name?: string;
  packages?: string[];
  timeout?: number;
  save_to_dataset?: boolean;
  dataset_name?: string;
}

export interface McpCallResult {
  error?: string;
  result?: unknown;
  [key: string]: unknown;
}
