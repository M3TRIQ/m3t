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

/**
 * Resolve PDB argument to file content.
 * - existing file path → read it
 * - 4-letter PDB ID (e.g. "3HTB") → fetch from RCSB
 * - anything else (assume raw PDB text already) → return as-is
 */
async function resolvePdb(pdb: string): Promise<{ content: string; label: string }> {
  if (fs.existsSync(pdb)) {
    return { content: fs.readFileSync(pdb, 'utf-8'), label: pdb.split('/').pop() || pdb };
  }
  if (/^[0-9A-Za-z]{4}$/.test(pdb)) {
    const id = pdb.toUpperCase();
    const res = await fetch(`https://files.rcsb.org/download/${id}.pdb`);
    if (!res.ok) {
      throw new Error(
        `PDB '${id}' not found at RCSB (HTTP ${res.status}). ` +
        `Check the ID at https://rcsb.org/structure/${id} or pass a local .pdb file.`,
      );
    }
    return { content: await res.text(), label: id };
  }
  return { content: pdb, label: pdb };
}

// HETATM residues that are not real ligands — waters, ions, common cryoprotectants
// and buffer components. Excluded from auto binding-site detection.
const FILLER_HETATMS = new Set([
  'HOH','WAT','DOD','D2O',
  'NA','CL','K','BR','I','F','MG','CA','ZN','FE','MN','CU','NI','CO','CD','HG','PB','BA','CS','SR',
  'SO4','PO4','BO3','NO3','CO3','HCO3','OH','OXY','PER','SUL','MOO',
  'GOL','EDO','PEG','PG4','PE4','PGE','MPD','BME','DTT','MRD','BU3','P6G','BTB','EPE','HEPES',
  'TRS','TRIS','ACT','ACE','FMT','EOH','IPA','DMS','DMF','MES','BES','GLY','CIT','MLT','TLA',
  'NH4','PYR','HED','BNG','LMT','OLA','OLB','OLC',
]);

interface DetectedSite {
  resname: string; chain: string; resnum: number;
  center: { x: number; y: number; z: number };
  atomCount: number;
}

/** Find the largest non-filler HETATM residue and return its centroid. Returns null if none. */
function autoDetectSite(pdbContent: string): DetectedSite | null {
  const groups = new Map<string, { resname: string; chain: string; resnum: number; xs: number[]; ys: number[]; zs: number[] }>();
  for (const line of pdbContent.split('\n')) {
    if (!line.startsWith('HETATM')) continue;
    const resname = line.slice(17, 20).trim();
    if (FILLER_HETATMS.has(resname.toUpperCase())) continue;
    const chain = line.slice(21, 22).trim() || ' ';
    const resnum = parseInt(line.slice(22, 26).trim(), 10);
    const x = parseFloat(line.slice(30, 38));
    const y = parseFloat(line.slice(38, 46));
    const z = parseFloat(line.slice(46, 54));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const key = `${resname}|${chain}|${resnum}`;
    let g = groups.get(key);
    if (!g) { g = { resname, chain, resnum, xs: [], ys: [], zs: [] }; groups.set(key, g); }
    g.xs.push(x); g.ys.push(y); g.zs.push(z);
  }
  let best: { resname: string; chain: string; resnum: number; xs: number[]; ys: number[]; zs: number[] } | null = null;
  for (const g of groups.values()) {
    if (!best || g.xs.length > best.xs.length) best = g;
  }
  // A real ligand has ≥5 heavy atoms; anything smaller is likely a stray modification.
  if (!best || best.xs.length < 5) return null;
  const n = best.xs.length;
  const mean = (a: number[]) => Math.round((a.reduce((s, v) => s + v, 0) / n) * 1000) / 1000;
  return {
    resname: best.resname, chain: best.chain, resnum: best.resnum,
    center: { x: mean(best.xs), y: mean(best.ys), z: mean(best.zs) },
    atomCount: n,
  };
}

/**
 * Resolve the binding site for a docking job.
 * Throws on explicit (0,0,0) (a known agent placeholder). When any coord is
 * missing, runs autoDetectSite() on the PDB content; logs what was picked to
 * stderr so the agent sees the decision.
 */
function resolveSite(
  pdbContent: string, pdbLabel: string,
  cx?: number, cy?: number, cz?: number,
): { x: number; y: number; z: number } {
  const allSet = [cx, cy, cz].every(v => typeof v === 'number' && !Number.isNaN(v));
  const allZero = allSet && cx === 0 && cy === 0 && cz === 0;
  if (allZero) {
    throw new Error(
      `Binding site (0,0,0) is not a valid center. To find real coordinates, ` +
      `check the co-crystallized ligand at https://rcsb.org/structure/${pdbLabel}/ligands, ` +
      `or omit --cx/--cy/--cz to auto-detect from the PDB.`,
    );
  }
  if (allSet) return { x: cx as number, y: cy as number, z: cz as number };

  const site = autoDetectSite(pdbContent);
  if (!site) {
    throw new Error(
      `Could not auto-detect a binding site in ${pdbLabel} (no co-crystallized ligand ` +
      `with ≥5 heavy atoms). Specify --cx/--cy/--cz manually — check ligands at ` +
      `https://rcsb.org/structure/${pdbLabel}/ligands.`,
    );
  }
  process.stderr.write(
    `Auto-detected binding site at HETATM ${site.resname} ${site.chain}${site.resnum} ` +
    `(${site.atomCount} atoms): center=(${site.center.x}, ${site.center.y}, ${site.center.z})\n`,
  );
  return site.center;
}

/** Shared binding site options for site-directed docking (Vina/GNINA).
 *  Coords are OPTIONAL — if omitted, the CLI auto-detects from the PDB. */
function addSiteOptions(cmd: ReturnType<Command['command']>) {
  return cmd
    .option('--cx <x>', 'Binding site center X (omit to auto-detect)', parseFloat)
    .option('--cy <y>', 'Binding site center Y (omit to auto-detect)', parseFloat)
    .option('--cz <z>', 'Binding site center Z (omit to auto-detect)', parseFloat)
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

      const { content: pdbContent } = await resolvePdb(pdb);
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
  opts: { cx?: number; cy?: number; cz?: number; sx?: number; sy?: number; sz?: number; exhaustiveness?: number },
): Promise<void> {
  const project = requireProject();
  const client = createClient();
  const consoleUrl = getConsoleUrl();

  const { content: pdbContent, label: pdbLabel } = await resolvePdb(pdb);
  const site = resolveSite(pdbContent, pdbLabel, opts.cx, opts.cy, opts.cz);
  const title = `Dock ${smiles.substring(0, 30)} → ${pdbLabel}`;
  const result = await client.createDockingJob({
    project_id: project.id,
    title,
    protein_pdb: pdbContent,
    ligand_smiles: smiles,
    scoring_function: method,
    exhaustiveness: opts.exhaustiveness,
    center_x: site.x,
    center_y: site.y,
    center_z: site.z,
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
  opts: { cx?: number; cy?: number; cz?: number; sx?: number; sy?: number; sz?: number },
): Promise<void> {
  const project = requireProject();
  const client = createClient();
  const consoleUrl = getConsoleUrl();

  const compounds = parseCompoundsFile(file);
  const { content: pdbContent, label: pdbLabel } = await resolvePdb(pdb);
  const site = resolveSite(pdbContent, pdbLabel, opts.cx, opts.cy, opts.cz);
  const title = `Batch ${method.toUpperCase()} ${compounds.length} compounds → ${pdbLabel}`;

  const result = await client.createBatchDockingJob({
    project_id: project.id,
    title,
    protein_pdb: pdbContent,
    ligand_smiles_list: compounds.map(c => c.smiles),
    scoring_function: method,
    center_x: site.x,
    center_y: site.y,
    center_z: site.z,
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
