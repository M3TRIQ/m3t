import fs from 'node:fs';
import type { Command } from 'commander';
import { createClient, getConsoleUrl } from '../cli.js';
import { requireProject } from '../config.js';
import { output } from '../output.js';
import { jobUrl, maybeOpenBrowser } from '../url.js';

function parseCompoundsFile(filePath: string): Array<{ smiles: string; name?: string }> {
  const content = filePath === '-'
    ? fs.readFileSync(0, 'utf-8')
    : fs.readFileSync(filePath, 'utf-8');

  const trimmed = content.trim();

  if (trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }

  const lines = trimmed.split('\n');
  const header = lines[0].toLowerCase();
  const sep = header.includes('\t') ? '\t' : ',';
  const cols = header.split(sep).map(c => c.trim());
  const smilesIdx = cols.indexOf('smiles');
  const nameIdx = cols.indexOf('name');
  if (smilesIdx === -1) throw new Error('CSV must have a "smiles" column');

  return lines.slice(1).filter(l => l.trim()).map(l => {
    const parts = l.split(sep);
    return {
      smiles: parts[smilesIdx].trim(),
      name: nameIdx >= 0 ? parts[nameIdx]?.trim() : undefined,
    };
  });
}

/** Resolve PDB argument: if it's a file path, read content; otherwise return as-is (PDB ID). */
function resolvePdb(pdb: string): { content: string; label: string } {
  if (fs.existsSync(pdb)) {
    return { content: fs.readFileSync(pdb, 'utf-8'), label: pdb.split('/').pop() || pdb };
  }
  return { content: pdb, label: pdb };
}

/** Shared binding site options for site-directed docking (Vina/GNINA) */
function addSiteOptions(cmd: ReturnType<Command['command']>) {
  return cmd
    .requiredOption('--cx <x>', 'Binding site center X', parseFloat)
    .requiredOption('--cy <y>', 'Binding site center Y', parseFloat)
    .requiredOption('--cz <z>', 'Binding site center Z', parseFloat)
    .option('--sx <x>', 'Search box size X (default: 20)', parseFloat)
    .option('--sy <y>', 'Search box size Y (default: 20)', parseFloat)
    .option('--sz <z>', 'Search box size Z (default: 20)', parseFloat);
}

export function registerDockingCommands(program: Command): void {
  // ── m3t dock <method> ─────────────────────────────────────────
  const dock = program.command('dock').description('Dock a compound against a protein target');

  // m3t dock gnina
  addSiteOptions(
    dock.command('gnina')
      .argument('<smiles>', 'SMILES string of the ligand')
      .argument('<pdb>', 'PDB ID (e.g., 5NJ8) or path to .pdb file')
      .option('--exhaustiveness <n>', 'Search exhaustiveness', parseInt)
      .description('Dock with GNINA CNN scoring (GCP T4 GPU, ~3-4 min/job incl. GPU spin-up)')
  ).action(async (smiles: string, pdb: string, opts) => {
    await runSiteDock(smiles, pdb, 'gnina', opts);
  });

  // m3t dock vina
  addSiteOptions(
    dock.command('vina')
      .argument('<smiles>', 'SMILES string of the ligand')
      .argument('<pdb>', 'PDB ID (e.g., 5NJ8) or path to .pdb file')
      .option('--exhaustiveness <n>', 'Search exhaustiveness', parseInt)
      .description('Dock with AutoDock Vina (Cloud Run CPU, ~2-3 min/compound)')
  ).action(async (smiles: string, pdb: string, opts) => {
    await runSiteDock(smiles, pdb, 'vina', opts);
  });

  // m3t dock diffdock
  dock.command('diffdock')
    .argument('<smiles>', 'SMILES string of the ligand')
    .argument('<pdb>', 'PDB ID (e.g., 5NJ8) or path to .pdb file')
    .option('--samples <n>', 'Number of pose samples (default: 10)', parseInt)
    .description('Blind docking with DiffDock (no binding site needed, AI-predicted poses)')
    .action(async (smiles: string, pdb: string, opts) => {
      const project = requireProject();
      const client = createClient();
      const consoleUrl = getConsoleUrl();

      const { content: pdbContent } = resolvePdb(pdb);
      const result = await client.createDiffDockJob({
        project_id: project.id,
        ligand_smiles: smiles,
        protein_pdb: pdbContent,
        num_samples: opts.samples,
      });

      const url = jobUrl(consoleUrl, project.id, result.job_id);
      maybeOpenBrowser(url);

      const data = { job_id: result.job_id, method: 'diffdock', url };
      output(data, `DiffDock job created\nJob ID: ${result.job_id.substring(0, 8)}\nEstimated: ~2 minutes`);
    });

  // ── m3t batch <method> ────────────────────────────────────────
  const batch = program.command('batch').description('Batch dock multiple compounds');

  // m3t batch gnina
  addSiteOptions(
    batch.command('gnina')
      .argument('<file>', 'Compounds file (CSV/JSON, - for stdin)')
      .argument('<pdb>', 'PDB ID (e.g., 5NJ8) or path to .pdb file')
      .description('Batch dock with GNINA (GCP T4 GPU, ~3-4 min/job for small batches)')
  ).action(async (file: string, pdb: string, opts) => {
    await runBatchDock(file, pdb, 'gnina', opts);
  });

  // m3t batch vina
  addSiteOptions(
    batch.command('vina')
      .argument('<file>', 'Compounds file (CSV/JSON, - for stdin)')
      .argument('<pdb>', 'PDB ID (e.g., 5NJ8) or path to .pdb file')
      .description('Batch dock with Vina (Cloud Run CPU, ~2-3 min/compound)')
  ).action(async (file: string, pdb: string, opts) => {
    await runBatchDock(file, pdb, 'vina', opts);
  });
}

async function runSiteDock(
  smiles: string, pdb: string, method: 'vina' | 'gnina',
  opts: { cx: number; cy: number; cz: number; sx?: number; sy?: number; sz?: number; exhaustiveness?: number },
): Promise<void> {
  const project = requireProject();
  const client = createClient();
  const consoleUrl = getConsoleUrl();

  const { content: pdbContent, label: pdbLabel } = resolvePdb(pdb);
  const title = `Dock ${smiles.substring(0, 30)} → ${pdbLabel}`;
  const result = await client.createDockingJob({
    project_id: project.id,
    title,
    protein_pdb: pdbContent,
    ligand_smiles: smiles,
    scoring_function: method,
    exhaustiveness: opts.exhaustiveness,
    center_x: opts.cx,
    center_y: opts.cy,
    center_z: opts.cz,
    size_x: opts.sx,
    size_y: opts.sy,
    size_z: opts.sz,
  });

  const url = jobUrl(consoleUrl, project.id, result.job_id);
  maybeOpenBrowser(url);

  const timeEst = method === 'gnina' ? '~3-4 min (incl. GPU spin-up)' : '~2-3 min';
  const data = { job_id: result.job_id, method, url };
  output(data, `${method.toUpperCase()} docking job created\nJob ID: ${result.job_id.substring(0, 8)}\nEstimated: ${timeEst}`);
}

async function runBatchDock(
  file: string, pdb: string, method: 'vina' | 'gnina',
  opts: { cx: number; cy: number; cz: number; sx?: number; sy?: number; sz?: number },
): Promise<void> {
  const project = requireProject();
  const client = createClient();
  const consoleUrl = getConsoleUrl();

  const compounds = parseCompoundsFile(file);
  const { content: pdbContent, label: pdbLabel } = resolvePdb(pdb);
  const title = `Batch ${method.toUpperCase()} ${compounds.length} compounds → ${pdbLabel}`;

  const result = await client.createBatchDockingJob({
    project_id: project.id,
    title,
    protein_pdb: pdbContent,
    ligand_smiles_list: compounds.map(c => c.smiles),
    scoring_function: method,
    center_x: opts.cx,
    center_y: opts.cy,
    center_z: opts.cz,
    size_x: opts.sx,
    size_y: opts.sy,
    size_z: opts.sz,
  });

  const url = jobUrl(consoleUrl, project.id, result.job_id);
  maybeOpenBrowser(url);

  // GNINA is provisioning-bound (~constant per job for small batches); Vina
  // scales per compound on CPU.
  const totalMin = method === 'gnina'
    ? Math.max(4, Math.ceil(compounds.length * 0.05))
    : Math.ceil(compounds.length * 2.5);
  const data = { job_id: result.job_id, compounds: compounds.length, method, url };
  output(data, `${method.toUpperCase()} batch docking created\nJob ID: ${result.job_id.substring(0, 8)}\nCompounds: ${compounds.length}\nEstimated: ~${totalMin} minutes`);
}
