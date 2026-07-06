import fs from 'node:fs';
import type { Command } from 'commander';
import { output } from '../output.js';
import { createAgentsClient } from '../cli.js';
import { requireApiKey, requireProject } from '../config.js';

export function registerMdCommands(program: Command): void {
  const md = program
    .command('md')
    .description('Run molecular dynamics simulations (GPU-accelerated, OpenMM)')
    .hook('preAction', () => { requireApiKey(); });

  // ── m3t md run ────────────────────────────────────────────────
  md
    .command('run')
    .option('--protein <pdb>', 'Protein PDB ID or path to .pdb file')
    .option('--ligand-sdf <sdf>', 'Ligand SDF content or path to .sdf file (omit for apo simulation)')
    .option('--ligand-smiles <smiles>', 'Ligand SMILES (omit for apo simulation)')
    .option('--diffdock-job <id>', 'DiffDock job ID (auto-fetches protein + ligand)')
    .option('--mode <mode>', 'Simulation mode: quick (10ns ~1hr) or standard (50ns ~5hrs)', 'quick')
    .option('--ns <n>', 'Override simulation duration in nanoseconds (1-100)')
    .option('--temperature <K>', 'Temperature in Kelvin', '300')
    .option('--membrane', 'Cell-membrane MD: embed the protein in a POPC lipid bilayer (CHARMM36) instead of a water box. For membrane proteins (GPCRs, transporters, channels). Provide a membrane-oriented structure (TM axis along Z, e.g. from OPM); larger system so it runs slower than a soluble-protein MD of the same length.')
    .description('Submit a molecular dynamics simulation job')
    .action(async (opts) => {
      const project = requireProject();
      const agents = createAgentsClient();

      const params: Record<string, unknown> = {
        mode: opts.mode,
        temperature_k: parseFloat(opts.temperature),
        project_id: project.id,
      };

      if (opts.membrane) params.membrane = true;

      // Input source: DiffDock job OR protein + ligand
      if (opts.diffdockJob) {
        params.diffdock_job_id = opts.diffdockJob;
      } else {
        if (!opts.protein) {
          process.stderr.write('Error: Provide --protein <pdb> or --diffdock-job <id>\n');
          process.exit(1);
        }
        // Resolve protein: file path or PDB ID
        if (fs.existsSync(opts.protein)) {
          params.protein_pdb = fs.readFileSync(opts.protein, 'utf-8');
        } else {
          params.protein_pdb = opts.protein;
        }
        // Resolve ligand (optional — omit for apo / protein-only MD)
        if (opts.ligandSdf) {
          if (fs.existsSync(opts.ligandSdf)) {
            params.ligand_sdf = fs.readFileSync(opts.ligandSdf, 'utf-8');
          } else {
            params.ligand_sdf = opts.ligandSdf;
          }
        } else if (opts.ligandSmiles) {
          params.ligand_smiles = opts.ligandSmiles;
        } else {
          process.stderr.write('Running protein-only (apo) MD — no ligand specified.\n');
        }
      }

      if (opts.ns) params.simulation_ns = parseFloat(opts.ns);

      process.stderr.write(`Submitting MD simulation (${opts.mode} mode)...\n`);
      const data = await agents.callMcpTool('md', 'run_md_simulation', params);

      // Extract job ID from response
      const jobId = extractJobId(data);
      if (jobId) {
        output({ job_id: jobId, mode: opts.mode }, `MD simulation submitted\nJob ID: ${jobId.substring(0, 8)}\nMode: ${opts.mode}\nCheck status: m3t job ${jobId.substring(0, 8)}`);
      } else if (typeof data.result === 'string') {
        output(data, data.result);
      } else {
        output(data, JSON.stringify(data, null, 2));
      }
    });

  // ── m3t md results <job_id> ───────────────────────────────────
  md
    .command('results')
    .argument('<job_id>', 'MD simulation job ID')
    .description('Get results from a completed MD simulation')
    .action(async (jobId: string) => {
      const agents = createAgentsClient();
      const data = await agents.callMcpTool('md', 'get_md_results', { job_id: jobId });

      if (typeof data.result === 'string') {
        output(data, data.result);
      } else {
        output(data, JSON.stringify(data, null, 2));
      }
    });
}

function extractJobId(data: Record<string, unknown>): string | null {
  if (typeof data.job_id === 'string') return data.job_id;
  if (typeof data.id === 'string') return data.id;
  if (typeof data.result === 'object' && data.result !== null) {
    const r = data.result as Record<string, unknown>;
    if (typeof r.job_id === 'string') return r.job_id;
    if (typeof r.id === 'string') return r.id;
  }
  return null;
}
