export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at?: string;
  last_activity_at?: string;
  context?: string;
  session_count?: number;
  user_role?: string;
  owner_email?: string;
  owner_name?: string;
  member_count?: number;
  is_shared?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
  has_notes?: boolean;
  context_notes?: string;
  project?: string;
  project_name?: string;
  user_name?: string;
  selected_tab?: number;
  model?: string;
  messages?: ChatMessage[];
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  order: number;
  created_at: string;
  elapsed_time?: number | null;
  total_tokens?: number | null;
  thinking_steps?: unknown[];
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

export type Boltz2MoleculeType = 'protein' | 'dna' | 'rna';

export interface Boltz2Polymer {
  molecule_type: Boltz2MoleculeType;
  sequence: string;
  id?: string;
}

export interface Boltz2Ligand {
  smiles?: string;
  ccd_code?: string;
}

export interface Boltz2McpParams {
  polymers: Boltz2Polymer[];
  ligands?: Boltz2Ligand[];
  recycling_steps?: number;
  sampling_steps?: number;
  diffusion_samples?: number;
  step_scale?: number;
}

export interface Boltz2McpResult {
  success?: boolean;
  model?: string;
  complex?: string;
  output_format?: string;
  diffusion_samples?: number;
  num_structures_returned?: number;
  structure_data?: string;
  confidence_scores?: number[];
  best_confidence?: number | null;
  affinities?: Record<string, unknown> | null;
  metrics?: Record<string, unknown> | null;
  quality?: string;
  message?: string;
  // When the MCP tool errors (e.g., NVIDIA NIM 4xx/5xx), the unwrapped payload
  // is { error: "...", tool: "..." } with no success flag.
  error?: string;
}

export interface Boltz2JobParams {
  project_id: string;
  title: string;
  result_data: Record<string, unknown>;
  description?: string;
  // Structured inputs (chains/ligands/glycan/depth) persisted server-side for
  // rerun, audit, display, and depth-aware pricing.
  prediction_inputs?: Record<string, unknown>;
}

// Glycan / carbohydrate builder (rdkit MCP build_glycan).
export interface GlycanResidue {
  index: number;
  name: string;
  ccd: string;
}
export interface GlycanBond {
  child_idx: number;
  parent_idx: number;
  child_atom: string;
  parent_atom: string;
  linkage: string;
}
export interface GlycanBuildResult {
  success?: boolean;
  input?: string;
  smiles?: string;
  sdf?: string;
  formula?: string;
  molecular_weight?: number;
  n_rotatable_bonds?: number;
  n_residues?: number;
  ccd_supported?: boolean;
  residues?: GlycanResidue[];
  bonds?: GlycanBond[];
  reducing_end?: GlycanResidue;
  attachment?: Record<string, unknown>;
  ccd_note?: string;
  error?: string;
}

// OpenFold3 (AlphaFold3-class) complex prediction via the bionemo MCP.
export interface Openfold3Molecule {
  type: 'protein' | 'dna' | 'rna' | 'ligand';
  sequence?: string;
  id?: string;
  smiles?: string;
  ccd_codes?: string[];
}

export interface Openfold3McpResult {
  success?: boolean;
  model?: string;
  complex?: string;
  output_format?: string;
  diffusion_samples?: number;
  num_structures_returned?: number;
  structure_data?: string;
  confidence?: {
    plddt?: number | null;
    ptm?: number | null;
    iptm?: number | null;
    confidence_score?: number | null;
    pde?: number | null;
  } | null;
  quality?: string;
  templates_applied?: boolean;
  inference_time_seconds?: number | null;
  message?: string;
  // On MCP/NIM error the unwrapped payload is { error, tool } with no success flag.
  error?: string;
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

export interface CreditUsageLogEntry {
  event: string;
  credits: number;
  job_id?: string | null;
  note?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface CreditQuota {
  tier: string;
  monthly_credits: number;
  credits_used: number;
  topup_credits: number;
  credits_remaining: number;
  usage_percentage: number;
  period_start?: string;
  period_end?: string;
  is_quota_exceeded: boolean;
  last_used?: string | null;
  recent_events?: CreditUsageLogEntry[];
  // 30-day trial model
  trial_ends_at?: string | null;
  has_access?: boolean;
  in_trial?: boolean;
  trial_days_remaining?: number | null;
  topup_locked?: boolean;
}

export interface CreditLogResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: CreditUsageLogEntry[];
}

export interface PricingItem {
  label: string;
  unit: string;
  credits: number;
  note?: string;
}

export interface PricingCatalog {
  credit_usd: number;
  note: string;
  jobs: PricingItem[];
  md_simulation: PricingItem[];
  sandbox: PricingItem;
  ai: { label: string; unit: string; range: string };
}
