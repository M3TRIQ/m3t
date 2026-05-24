import fs from 'node:fs';
import type { Command } from 'commander';
import { createAgentsClient, createClient, getConsoleUrl } from '../cli.js';
import { requireProject } from '../config.js';
import { output } from '../output.js';
import { jobUrl, maybeOpenBrowser } from '../url.js';
import type { Boltz2Ligand, Boltz2McpResult, Boltz2Polymer } from '../types.js';

export function registerPredictCommands(program: Command): void {
  const predict = program.command('predict').description('Predict 3D structure from sequence (single protein or biomolecular complex)');

  // m3t predict esmfold
  predict.command('esmfold')
    .argument('<sequence>', 'Amino acid sequence (single letter codes, max 1024aa)')
    .option('--name <name>', 'Name for the prediction')
    .description('Fast structure prediction with ESMFold (~10 seconds)')
    .action(async (sequence: string, opts) => {
      await runPredict(sequence, 'esmfold', opts.name);
    });

  // m3t predict alphafold2
  predict.command('alphafold2')
    .argument('<sequence>', 'Amino acid sequence (single letter codes, max 2048aa)')
    .option('--name <name>', 'Name for the prediction')
    .description('High-accuracy prediction with AlphaFold2 (~15-20 min, varies with length; scale-to-zero VM)')
    .action(async (sequence: string, opts) => {
      await runPredict(sequence, 'alphafold2', opts.name);
    });

  // m3t predict boltz2
  predict.command('boltz2')
    .description('Predict biomolecular complex (protein + DNA/RNA + ligand) with binding affinity (Boltz-2 / NVIDIA NIM, ~1-5 min)')
    .option('--protein <seq>', 'Protein sequence (or @path to file). Repeatable for multi-chain complexes.', collectArg, [])
    .option('--dna <seq>', 'DNA sequence (or @path to file). Repeatable.', collectArg, [])
    .option('--rna <seq>', 'RNA sequence (or @path to file). Repeatable.', collectArg, [])
    .option('--ligand <smiles_or_ccd>', 'Ligand as SMILES or CCD code (e.g. ATP). Repeatable.', collectArg, [])
    .option('--samples <n>', 'Number of structure samples (1-25, default: 1)', parseInt, 1)
    .option('--recycling <n>', 'Recycling steps (1-10, default: 3)', parseInt, 3)
    .option('--sampling <n>', 'Diffusion sampling steps (10-1000, default: 50)', parseInt, 50)
    .option('--name <name>', 'Custom job title')
    .action(async (opts) => {
      await runBoltz2(opts);
    });
}

async function runPredict(sequence: string, method: 'esmfold' | 'alphafold2', name?: string): Promise<void> {
  const project = requireProject();
  const client = createClient();
  const consoleUrl = getConsoleUrl();

  const result = await client.createStructurePrediction({
    project_id: project.id,
    sequence,
    method,
    name,
  });

  const url = jobUrl(consoleUrl, project.id, result.job_id);
  maybeOpenBrowser(url);

  const timeEst = method === 'alphafold2' ? '~15-20 minutes (varies with length)' : '~10 seconds';
  const data = { job_id: result.job_id, method, sequence_length: sequence.length, url };
  output(data, `${method} prediction created\nJob ID: ${result.job_id.substring(0, 8)}\nLength: ${sequence.length} residues\nEstimated: ${timeEst}`);
}

interface Boltz2Opts {
  protein: string[];
  dna: string[];
  rna: string[];
  ligand: string[];
  samples: number;
  recycling: number;
  sampling: number;
  name?: string;
}

async function runBoltz2(opts: Boltz2Opts): Promise<void> {
  const polymers: Boltz2Polymer[] = [];
  for (const seq of opts.protein) polymers.push({ molecule_type: 'protein', sequence: resolveSequence(seq) });
  for (const seq of opts.dna) polymers.push({ molecule_type: 'dna', sequence: resolveSequence(seq) });
  for (const seq of opts.rna) polymers.push({ molecule_type: 'rna', sequence: resolveSequence(seq) });

  if (polymers.length === 0) {
    process.stderr.write('Error: At least one --protein, --dna, or --rna is required.\n');
    process.exit(1);
  }

  const ligands: Boltz2Ligand[] = opts.ligand.map(parseLigand);

  const project = requireProject();
  const client = createClient();
  const agents = createAgentsClient();
  const consoleUrl = getConsoleUrl();

  const summary = describeComplex(polymers, ligands);
  process.stderr.write(`Boltz-2: ${summary}\n`);
  process.stderr.write('Running prediction (NVIDIA NIM, ~1-5 min)...');

  const startTime = Date.now();
  const mcpData = await agents.callMcpTool('bionemo', 'predict_structure_boltz2', {
    polymers,
    ligands: ligands.length > 0 ? ligands : undefined,
    diffusion_samples: opts.samples,
    recycling_steps: opts.recycling,
    sampling_steps: opts.sampling,
  });

  const result = mcpData as unknown as Boltz2McpResult;
  if (result.error || !result.success) {
    const msg = result.error ?? result.message ?? 'Unknown error';
    process.stderr.write(`\nFailed: ${msg}\n`);
    process.exit(1);
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  process.stderr.write(` done (${elapsed}s).\n`);

  const title = opts.name ?? `Boltz-2: ${result.complex || summary}`;
  const job = await client.createBoltz2Job({
    project_id: project.id,
    title,
    description: `Boltz-2 biomolecular complex prediction. ${result.quality ?? ''}`.trim(),
    result_data: {
      complex: result.complex,
      structure_data: result.structure_data,
      output_format: result.output_format,
      confidence_scores: result.confidence_scores,
      best_confidence: result.best_confidence,
      affinities: result.affinities,
      metrics: result.metrics,
      quality: result.quality,
      num_structures_returned: result.num_structures_returned,
      diffusion_samples: result.diffusion_samples,
      model: 'boltz2',
    },
  });

  const url = jobUrl(consoleUrl, project.id, job.job_id);
  maybeOpenBrowser(url);

  const lines = [
    `Boltz-2 prediction complete in ${elapsed}s`,
    `Job ID: ${job.job_id.substring(0, 8)}`,
    `Complex: ${result.complex}`,
    `Quality: ${result.quality ?? 'unknown'}`,
  ];
  if (result.best_confidence !== null && result.best_confidence !== undefined) {
    lines.push(`Best confidence: ${result.best_confidence.toFixed(3)}`);
  }
  if (result.affinities && Object.keys(result.affinities).length > 0) {
    lines.push(`Affinities: ${JSON.stringify(result.affinities)}`);
  }
  lines.push(`View: ${url}`);

  output(
    {
      job_id: job.job_id,
      elapsed_seconds: elapsed,
      complex: result.complex,
      quality: result.quality,
      best_confidence: result.best_confidence,
      affinities: result.affinities,
      url,
    },
    lines.join('\n'),
  );
}

function collectArg(value: string, prev: string[]): string[] {
  return [...prev, value];
}

function resolveSequence(input: string): string {
  // @path → read file (FASTA-aware: strip header/whitespace)
  if (input.startsWith('@')) {
    const path = input.slice(1);
    if (!fs.existsSync(path)) {
      throw new Error(`Sequence file not found: ${path}`);
    }
    const raw = fs.readFileSync(path, 'utf-8');
    return raw
      .split('\n')
      .filter(line => !line.startsWith('>'))
      .join('')
      .replace(/\s+/g, '')
      .toUpperCase();
  }
  return input.replace(/\s+/g, '').toUpperCase();
}

function parseLigand(input: string): Boltz2Ligand {
  // CCD codes are 1-5 uppercase letters/digits with no SMILES-specific chars.
  // SMILES typically contain at least one of: ()=[]#+/\.@-/lowercase-atom-symbol.
  const looksLikeCcd = /^[A-Z0-9]{1,5}$/.test(input);
  const looksLikeSmiles = /[()\[\]=#@\\/.+-]/.test(input) || /[a-z]/.test(input);
  if (looksLikeCcd && !looksLikeSmiles) return { ccd_code: input };
  return { smiles: input };
}

function describeComplex(polymers: Boltz2Polymer[], ligands: Boltz2Ligand[]): string {
  const parts = polymers.map(p => `${p.molecule_type}(${p.sequence.length})`);
  if (ligands.length > 0) {
    parts.push(`ligand×${ligands.length}`);
  }
  return parts.join(' + ');
}
