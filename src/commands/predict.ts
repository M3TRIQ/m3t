import fs from 'node:fs';
import type { Command } from 'commander';
import { createAgentsClient, createClient, getConsoleUrl } from '../cli.js';
import { requireProject } from '../config.js';
import { output } from '../output.js';
import { jobUrl, maybeOpenBrowser } from '../url.js';
import { buildGlycanViaMcp } from './glycan.js';
import type { Boltz2Ligand, Boltz2McpResult, Boltz2Polymer, GlycanBuildResult, Openfold3McpResult, Openfold3Molecule } from '../types.js';

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

  // m3t predict alphafold2 — AF2 (ptm) monomer via the self-hosted ColabFold service
  // (the alphafold2-nim VM was retired; same AF2 weights, deep MSA from m3t_msa_server).
  predict.command('alphafold2')
    .argument('<sequence>', 'Amino acid sequence (single letter codes, max 2048aa)')
    .option('--name <name>', 'Name for the prediction')
    .description('AlphaFold2 (ptm) monomer prediction — deep MSA + ColabFold (~5-15 min, +cold start)')
    .action(async (sequence: string, opts) => {
      await runPredict(sequence, 'alphafold2', opts.name);
    });

  // m3t predict esmfold2 — monomer OR multi-chain (antibody-antigen, PPI)
  predict.command('esmfold2')
    .description('ESMFold2-Fast: monomer or multi-chain complex prediction (self-hosted A100). Beats AlphaFold3 on antibody-antigen DockQ from single sequence.')
    .option('--chain <id:seq>', 'Chain in the form "id:sequence" or "id:@path". Repeatable for multi-chain complexes. Example: --chain A:MQIF... --chain B:DIQM...', collectArg, [])
    .option('--sequence <seq>', 'Single-chain shortcut (auto-assigned chain id "A"). Use --chain for multi-chain.')
    .option('--loops <n>', 'ESMFold2 recurrent loops, 1-64 (default 10)', (v: string) => parseInt(v, 10), 10)
    .option('--steps <n>', 'Diffusion sampling steps, 1-200 (default 50)', (v: string) => parseInt(v, 10), 50)
    .option('--samples <n>', 'Diffusion samples per fold, 1-25 (default 1). >1 = best-by-ipTM/pTM.', (v: string) => parseInt(v, 10), 1)
    .option('--name <name>', 'Custom job title')
    .action(async (opts) => {
      await runEsmfold2(opts);
    });

  // m3t predict esmfold2-batch — fold a list of complexes from a JSON file
  predict.command('esmfold2-batch')
    .argument('<inputs.json>', 'Path to JSON file with an array of {label, chains: [{id, sequence}], optional num_loops/num_sampling_steps/num_diffusion_samples/seed}')
    .option('--loops <n>', 'Default recurrent loops, 1-64 (per-input overrides)', (v: string) => parseInt(v, 10), 10)
    .option('--steps <n>', 'Default diffusion sampling steps, 1-200', (v: string) => parseInt(v, 10), 50)
    .option('--samples <n>', 'Default diffusion samples per fold, 1-25', (v: string) => parseInt(v, 10), 1)
    .option('--name <name>', 'Custom job title')
    .description('Batch primitive: fold N complexes in one job (results in input order — no sorting)')
    .action(async (inputsPath: string, opts) => {
      await runEsmfold2Batch(inputsPath, opts);
    });

  // m3t embed esmc — protein-language-model embeddings + pseudo-perplexity
  const embed = program.command('embed').description('Compute protein-language-model embeddings');
  embed.command('esmc')
    .description('ESMC-6B per-residue embeddings + pseudo-perplexity (lower = more "natural" sequence)')
    .option('--sequence <seq>', 'Single sequence (or @path to file). Repeatable.', collectArg, [])
    .option('--layer <n>', 'Hidden layer to return: "last" (default) or an integer index', 'last')
    .option('--name <name>', 'Custom job title')
    .action(async (opts) => {
      await runEsmcEmbed(opts);
    });

  // m3t predict boltz2
  predict.command('boltz2')
    .description('Predict biomolecular complex (protein + DNA/RNA + ligand) with binding affinity (Boltz-2 / NVIDIA NIM, ~1-5 min)')
    .option('--protein <seq>', 'Protein sequence (or @path to file). Repeatable for multi-chain complexes.', collectArg, [])
    .option('--dna <seq>', 'DNA sequence (or @path to file). Repeatable.', collectArg, [])
    .option('--rna <seq>', 'RNA sequence (or @path to file). Repeatable.', collectArg, [])
    .option('--ligand <smiles_or_ccd>', 'Ligand as SMILES or CCD code (e.g. ATP). Repeatable.', collectArg, [])
    .option('--glycan <iupac>', 'Carbohydrate in IUPAC-condensed notation (e.g. "Gal(b1-4)GlcNAc"); built to a SMILES ligand. Repeatable.', collectArg, [])
    .option('--depth <tier>', 'Attach real per-chain MSAs: none (default, NIM-internal) | standard | exhaustive | custom', 'none')
    .option('--samples <n>', 'Number of structure samples (1-25, default: 1)', (v: string) => parseInt(v, 10), 1)
    .option('--recycling <n>', 'Recycling steps (1-10, default: 3)', (v: string) => parseInt(v, 10), 3)
    .option('--sampling <n>', 'Diffusion sampling steps (10-1000, default: 50)', (v: string) => parseInt(v, 10), 50)
    .option('--name <name>', 'Custom job title')
    .action(async (opts) => {
      await runBoltz2(opts);
    });

  // m3t predict af2multimer — fold a protein complex (homo-/hetero-oligomer) with AF2-Multimer
  predict.command('af2multimer')
    .description('Fold a protein complex (homo-/hetero-oligomer) with AF2-Multimer — deep MSA + PDB templates (self-hosted A100). Use --copies for an oligomer (e.g. a homotrimer).')
    .option('--protein <seq>', 'Protein chain sequence (or @path to file). Repeatable for hetero-complexes (distinct chains).', collectArg, [])
    .option('--copies <csv>', 'Copies per --protein: a single number applies to all (homomer), or a CSV paired by order (e.g. "2,1"). Default 1.', '1')
    .option('--no-save-structure', 'Do not save the predicted structure to the project')
    .option('--name <name>', 'Custom job title')
    .action(async (opts) => {
      await runAf2Multimer(opts);
    });

  // m3t predict openfold3
  predict.command('openfold3')
    .description('Predict biomolecular complex (protein + DNA/RNA + ligand) with OpenFold3 / AlphaFold3-class (NVIDIA NIM). Real MSAs + optional PDB templates.')
    .option('--protein <seq>', 'Protein sequence (or @path to file). Repeatable for multi-chain complexes.', collectArg, [])
    .option('--dna <seq>', 'DNA sequence (or @path to file). Repeatable.', collectArg, [])
    .option('--rna <seq>', 'RNA sequence (or @path to file). Repeatable.', collectArg, [])
    .option('--ligand <smiles_or_ccd>', 'Ligand as SMILES or CCD code (e.g. ATP). Repeatable.', collectArg, [])
    .option('--glycan <iupac>', 'Carbohydrate in IUPAC-condensed notation (e.g. "Gal(b1-4)GlcNAc"). Co-folded as one connected SMILES ligand (default — the hosted OpenFold3 NIM does NOT honor inter-residue bonds, so a CCD chain comes out disconnected). Repeatable.', collectArg, [])
    .option('--glycan-ccd', 'EXPERIMENTAL: co-fold the glycan as per-residue CCD codes + glycosidic bondedAtomPairs (the AF3-recommended form). Verified that the hosted OpenFold3 NIM IGNORES the bonds → sugars come out ~4 A apart, disconnected; only use with a backend that honors bondedAtomPairs.')
    .option('--depth <tier>', 'MSA depth for protein chains: standard (UniRef30, default) | exhaustive (+envDB, best for orphan/phage) | custom | none. (fast→standard, deep→exhaustive accepted)', 'standard')
    .option('--templates', 'Seed the fold with PDB structural templates per protein chain (OpenFold3 self-aligns).')
    .option('--samples <n>', 'Number of diffusion samples (1-25, default: 1)', (v: string) => parseInt(v, 10), 1)
    .option('--name <name>', 'Custom job title')
    .action(async (opts) => {
      await runOpenfold3(opts);
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

  const timeEst = method === 'alphafold2' ? '~5-15 minutes (deep MSA + ColabFold; +cold start)' : '~10 seconds';
  const data = { job_id: result.job_id, method, sequence_length: sequence.length, url };
  output(data, `${method} prediction created\nJob ID: ${result.job_id.substring(0, 8)}\nLength: ${sequence.length} residues\nEstimated: ${timeEst}`);
}

interface Boltz2Opts {
  protein: string[];
  dna: string[];
  rna: string[];
  ligand: string[];
  glycan: string[];
  depth: string;
  samples: number;
  recycling: number;
  sampling: number;
  name?: string;
}

async function runBoltz2(opts: Boltz2Opts): Promise<void> {
  const depth = normalizeMsaDepth(opts.depth || 'none');
  if (!['none', 'standard', 'exhaustive', 'custom'].includes(depth)) {
    process.stderr.write(`Error: --depth must be none | standard | exhaustive | custom, got "${opts.depth}".\n`);
    process.exit(1);
  }

  const polymers: Boltz2Polymer[] = [];
  for (const seq of opts.protein) polymers.push({ molecule_type: 'protein', sequence: resolveSequence(seq) });
  for (const seq of opts.dna) polymers.push({ molecule_type: 'dna', sequence: resolveSequence(seq) });
  for (const seq of opts.rna) polymers.push({ molecule_type: 'rna', sequence: resolveSequence(seq) });

  if (polymers.length === 0) {
    process.stderr.write('Error: At least one --protein, --dna, or --rna is required.\n');
    process.exit(1);
  }

  const ligands: Boltz2Ligand[] = opts.ligand.map(parseLigand);

  // Glycans → SMILES ligands (Boltz-2 has no inter-entity bond field, so a glycan
  // rides in as one SMILES molecule).
  for (const g of opts.glycan) {
    const built = await buildGlycanViaMcp(g, false);
    if (!built.smiles) {
      process.stderr.write(`Error: could not build glycan "${g}".\n`);
      process.exit(1);
    }
    process.stderr.write(`Glycan "${g}" → SMILES ligand (${built.formula ?? '?'})\n`);
    ligands.push({ smiles: built.smiles });
  }

  const project = requireProject();
  const client = createClient();
  const agents = createAgentsClient();
  const consoleUrl = getConsoleUrl();

  const summary = describeComplex(polymers, ligands);
  process.stderr.write(`Boltz-2: ${summary}${depth !== 'none' ? ` (MSA depth=${depth})` : ''}\n`);
  process.stderr.write('Running prediction (NVIDIA NIM, ~1-5 min)...');

  const startTime = Date.now();
  const mcpData = await agents.callMcpTool('bionemo', 'predict_structure_boltz2', {
    polymers,
    ligands: ligands.length > 0 ? ligands : undefined,
    diffusion_samples: opts.samples,
    recycling_steps: opts.recycling,
    sampling_steps: opts.sampling,
    msa_depth: depth,
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
      msa_depth: depth,
      model: 'boltz2',
    },
    prediction_inputs: {
      model: 'boltz2',
      msa_depth: depth,
      n_protein: opts.protein.length,
      n_dna: opts.dna.length,
      n_rna: opts.rna.length,
      ligands: ligands.length,
      glycans: opts.glycan,
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

interface Openfold3Opts {
  protein: string[];
  dna: string[];
  rna: string[];
  ligand: string[];
  glycan: string[];
  glycanCcd?: boolean;
  depth: string;
  templates?: boolean;
  samples: number;
  name?: string;
}

interface Of3Bond {
  atom1: [string, number, string];
  atom2: [string, number, string];
}

async function runOpenfold3(opts: Openfold3Opts): Promise<void> {
  const depth = normalizeMsaDepth(opts.depth || 'standard');
  const OF3_DEPTHS = ['standard', 'exhaustive', 'custom', 'none'];
  if (!OF3_DEPTHS.includes(depth)) {
    process.stderr.write(`Error: --depth must be one of ${OF3_DEPTHS.join(' | ')} (fast/deep accepted as aliases), got "${opts.depth}".\n`);
    process.exit(1);
  }

  // Build the OpenFold3 molecules array (proteins get chain ids A, B, ...).
  const molecules: Openfold3Molecule[] = [];
  const chainIds = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let ci = 0;
  for (const seq of opts.protein) molecules.push({ type: 'protein', sequence: resolveSequence(seq), id: chainIds[ci++] });
  for (const seq of opts.dna) molecules.push({ type: 'dna', sequence: resolveSequence(seq), id: chainIds[ci++] });
  for (const seq of opts.rna) molecules.push({ type: 'rna', sequence: resolveSequence(seq), id: chainIds[ci++] });
  for (const lig of opts.ligand) {
    const parsed = parseLigand(lig);
    molecules.push({ type: 'ligand', id: chainIds[ci++], ...('ccd_code' in parsed ? { ccd_codes: [parsed.ccd_code!] } : { smiles: parsed.smiles }) });
  }

  // Glycans: default to ONE connected SMILES ligand. The AF3 literature recommends
  // per-residue CCD + bondedAtomPairs, but that assumes the model honors the bonds —
  // and the hosted OpenFold3 NIM does NOT (verified: a 2-residue CCD glycan comes out
  // with the sugars ~4 A apart, disconnected). SMILES is one bonded molecule, so it
  // stays connected. --glycan-ccd opts into the CCD path for AF3-proper backends.
  const bonds: Of3Bond[] = [];
  for (const g of opts.glycan) {
    const built: GlycanBuildResult = await buildGlycanViaMcp(g, false);
    const useCcd = !!opts.glycanCcd && built.ccd_supported && !!built.residues && built.residues.length > 0;
    if (useCcd) {
      const idxToChain: Record<number, string> = {};
      for (const res of built.residues!) {
        const id = chainIds[ci++];
        idxToChain[res.index] = id;
        molecules.push({ type: 'ligand', id, ccd_codes: [res.ccd] });
      }
      for (const b of built.bonds ?? []) {
        bonds.push({
          atom1: [idxToChain[b.child_idx], 1, b.child_atom],
          atom2: [idxToChain[b.parent_idx], 1, b.parent_atom],
        });
      }
      process.stderr.write(`Glycan "${g}" → ${built.residues!.length} sugar residues + ${built.bonds?.length ?? 0} glycosidic bonds (CCD + bondedAtomPairs) — NOTE: the hosted NIM may not honor the bonds (sugars can come out disconnected); validate with the geometry checker.\n`);
    } else {
      if (opts.glycanCcd && !built.ccd_supported) {
        process.stderr.write(`Glycan "${g}": CCD decomposition unavailable (${built.ccd_note ?? 'unsupported monosaccharide/topology'}); using a single SMILES ligand.\n`);
      }
      if (!built.smiles) {
        process.stderr.write(`Error: could not build glycan "${g}".\n`);
        process.exit(1);
      }
      molecules.push({ type: 'ligand', id: chainIds[ci++], smiles: built.smiles });
      process.stderr.write(`Glycan "${g}" → SMILES ligand (${built.formula ?? '?'})\n`);
    }
  }

  if (molecules.length === 0) {
    process.stderr.write('Error: at least one --protein, --dna, --rna, --ligand, or --glycan is required.\n');
    process.exit(1);
  }

  const project = requireProject();
  const client = createClient();
  const agents = createAgentsClient();
  const consoleUrl = getConsoleUrl();

  const summary = molecules.map(m => `${m.type}(${m.id})`).join(' + ');
  process.stderr.write(`OpenFold3: ${summary} (depth=${depth}${opts.templates ? ', +templates' : ''}${bonds.length ? `, ${bonds.length} bonds` : ''})\n`);
  process.stderr.write('Running prediction (NVIDIA NIM; real MSA may cold-start the engine, up to a few min)...');

  const startTime = Date.now();
  const mcpData = await agents.callMcpTool('bionemo', 'predict_complex_structure_openfold3', {
    molecules,
    msa_depth: depth,
    templates: !!opts.templates,
    diffusion_samples: opts.samples,
    output_format: 'pdb',
    ...(bonds.length > 0 ? { bonds } : {}),
  });

  const result = mcpData as unknown as Openfold3McpResult;
  if (result.error || !result.success) {
    const msg = result.error ?? result.message ?? 'Unknown error';
    process.stderr.write(`\nFailed: ${msg}\n`);
    process.exit(1);
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  process.stderr.write(` done (${elapsed}s).\n`);

  const conf = result.confidence ?? {};
  const title = opts.name ?? `OpenFold3: ${result.complex || summary}`;
  const job = await client.createOpenfold3Job({
    project_id: project.id,
    title,
    description: `OpenFold3 complex prediction. ${result.quality ?? ''}`.trim(),
    result_data: {
      complex: result.complex,
      structure_data: result.structure_data,
      output_format: result.output_format,
      confidence: result.confidence,
      quality: result.quality,
      num_structures_returned: result.num_structures_returned,
      diffusion_samples: result.diffusion_samples,
      inference_time_seconds: result.inference_time_seconds,
      msa_depth: depth,
      templates_requested: !!opts.templates,
      templates_applied: !!result.templates_applied,
      model: 'openfold3',
    },
    prediction_inputs: {
      model: 'openfold3',
      msa_depth: depth,
      templates: !!opts.templates,
      n_protein: opts.protein.length,
      n_dna: opts.dna.length,
      n_rna: opts.rna.length,
      ligands: opts.ligand.length,
      glycans: opts.glycan,
      glycan_repr: opts.glycanCcd ? 'ccd+bonds' : 'smiles',
      n_bonds: bonds.length,
    },
  });

  const url = jobUrl(consoleUrl, project.id, job.job_id);
  maybeOpenBrowser(url);

  const lines = [
    `OpenFold3 prediction complete in ${elapsed}s`,
    `Job ID: ${job.job_id.substring(0, 8)}`,
    `Complex: ${result.complex}`,
    `Quality: ${result.quality ?? 'unknown'}`,
  ];
  if (conf.iptm !== null && conf.iptm !== undefined) lines.push(`ipTM: ${conf.iptm.toFixed(3)}`);
  if (conf.ptm !== null && conf.ptm !== undefined) lines.push(`pTM: ${conf.ptm.toFixed(3)}`);
  if (conf.plddt !== null && conf.plddt !== undefined) lines.push(`pLDDT: ${conf.plddt}`);
  if (opts.templates) lines.push(`Templates: ${result.templates_applied ? 'applied' : 'requested but not applied (NIM dropped them)'}`);
  if (opts.glycan.length > 0) lines.push('Note: validate the glycan geometry (ring pucker / glycosidic torsions) — pLDDT is unreliable for carbohydrates.');
  lines.push(`View: ${url}`);

  output(
    { job_id: job.job_id, elapsed_seconds: elapsed, complex: result.complex, quality: result.quality, confidence: result.confidence, msa_depth: depth, templates_requested: !!opts.templates, templates_applied: !!result.templates_applied, url },
    lines.join('\n'),
  );
}

interface Af2MultimerOpts {
  protein: string[];
  copies: string;
  saveStructure?: boolean;
  name?: string;
}

async function runAf2Multimer(opts: Af2MultimerOpts): Promise<void> {
  const proteins = opts.protein.map(resolveSequence);
  if (proteins.length === 0) {
    process.stderr.write('Error: at least one --protein is required.\n');
    process.exit(1);
  }
  // Parse --copies: a single value applies to every chain (homomer); a CSV pairs by order.
  const copyTokens = (opts.copies || '1').split(',').map(s => parseInt(s.trim(), 10));
  if (copyTokens.some(n => !Number.isFinite(n) || n < 1)) {
    process.stderr.write(`Error: --copies must be positive integers, got "${opts.copies}".\n`);
    process.exit(1);
  }
  const chains = proteins.map((sequence, i) => ({
    sequence,
    count: copyTokens.length === 1 ? copyTokens[0] : (copyTokens[i] ?? 1),
  }));
  const totalChains = chains.reduce((s, c) => s + c.count, 0);
  if (totalChains > 12) {
    process.stderr.write(`Error: total chains (with copies) is ${totalChains}; max 12.\n`);
    process.exit(1);
  }

  const project = requireProject();
  const client = createClient();
  const consoleUrl = getConsoleUrl();

  const summary = chains.map(c => `${c.sequence.length}aa×${c.count}`).join(' + ');
  const result = await client.createAf2MultimerComplexJob({
    project_id: project.id,
    chains,
    title: opts.name,
    save_structure: opts.saveStructure !== false,
  });

  const url = jobUrl(consoleUrl, project.id, result.job_id);
  maybeOpenBrowser(url);

  const lines = [
    `AF2-Multimer complex queued (${totalChains} chains: ${summary})`,
    `Job ID: ${result.job_id.substring(0, 8)}`,
    `Deep MSA + PDB templates; ~30-60s warm, ~5-8 min cold A100 start`,
    `View: ${url}`,
  ];
  output({ job_id: result.job_id, n_chains: totalChains, chains, url }, lines.join('\n'));
}

function collectArg(value: string, prev: string[]): string[] {
  return [...prev, value];
}

// MSA depth vocabulary aligns with the MSA service (standard|exhaustive|custom|none).
// fast/deep are accepted as legacy aliases (fast→standard, deep→exhaustive).
function normalizeMsaDepth(d: string): string {
  const v = (d || '').toLowerCase();
  if (v === 'fast') return 'standard';
  if (v === 'deep') return 'exhaustive';
  return v;
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

// ─── ESMFold2 ──────────────────────────────────────────────────────────────

interface Esmfold2Opts {
  chain: string[];
  sequence?: string;
  loops: number;
  steps: number;
  samples: number;
  name?: string;
}

async function runEsmfold2(opts: Esmfold2Opts): Promise<void> {
  const chains: { id: string; sequence: string }[] = [];
  for (const raw of opts.chain) {
    const colon = raw.indexOf(':');
    if (colon <= 0) {
      process.stderr.write(`Error: --chain must be "id:sequence" or "id:@path", got "${raw}".\n`);
      process.exit(1);
    }
    const id = raw.slice(0, colon).trim();
    const seq = resolveSequence(raw.slice(colon + 1));
    if (!id) {
      process.stderr.write('Error: --chain id cannot be empty.\n');
      process.exit(1);
    }
    chains.push({ id, sequence: seq });
  }
  if (chains.length === 0 && opts.sequence) {
    chains.push({ id: 'A', sequence: resolveSequence(opts.sequence) });
  }
  if (chains.length === 0) {
    process.stderr.write('Error: provide at least one --chain "id:seq" or --sequence "<seq>".\n');
    process.exit(1);
  }
  const totalAa = chains.reduce((s, c) => s + c.sequence.length, 0);
  if (totalAa > 2048) {
    process.stderr.write(`Error: total residues ${totalAa} > 2048 (ESMFold2-Fast cap on single GPU).\n`);
    process.exit(1);
  }

  const project = requireProject();
  const client = createClient();
  const consoleUrl = getConsoleUrl();

  const result = await client.createEsmfold2Job({
    project_id: project.id,
    chains,
    title: opts.name,
    num_loops: opts.loops,
    num_sampling_steps: opts.steps,
    num_diffusion_samples: opts.samples,
  });

  const url = jobUrl(consoleUrl, project.id, result.job_id);
  maybeOpenBrowser(url);

  const isComplex = chains.length > 1;
  const lines = [
    `ESMFold2 ${isComplex ? `complex (${chains.length} chains)` : 'monomer'} queued`,
    `Job ID: ${result.job_id.substring(0, 8)}`,
    `Total residues: ${totalAa}`,
    `Estimated: ~30-60s warm, ~5-7 min cold start`,
    `View: ${url}`,
  ];
  output(
    { job_id: result.job_id, n_chains: chains.length, total_residues: totalAa, url },
    lines.join('\n'),
  );
}

// ─── ESMFold2 batch ────────────────────────────────────────────────────────

interface Esmfold2BatchOpts {
  loops: number;
  steps: number;
  samples: number;
  name?: string;
}

async function runEsmfold2Batch(inputsPath: string, opts: Esmfold2BatchOpts): Promise<void> {
  if (!fs.existsSync(inputsPath)) {
    process.stderr.write(`Error: inputs file not found: ${inputsPath}\n`);
    process.exit(1);
  }
  let inputs: any;
  try {
    inputs = JSON.parse(fs.readFileSync(inputsPath, 'utf-8'));
  } catch (e: any) {
    process.stderr.write(`Error: ${inputsPath} is not valid JSON (${e.message}).\n`);
    process.exit(1);
  }
  if (!Array.isArray(inputs) || inputs.length === 0) {
    process.stderr.write('Error: inputs file must contain a non-empty array of {label, chains, ...}.\n');
    process.exit(1);
  }
  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i];
    if (!inp || !Array.isArray(inp.chains) || inp.chains.length === 0) {
      process.stderr.write(`Error: input #${i} missing required "chains" array.\n`);
      process.exit(1);
    }
  }

  const project = requireProject();
  const client = createClient();
  const consoleUrl = getConsoleUrl();

  const result = await client.createEsmfold2BatchJob({
    project_id: project.id,
    inputs,
    title: opts.name,
    default_num_loops: opts.loops,
    default_num_sampling_steps: opts.steps,
    default_num_diffusion_samples: opts.samples,
  });

  const url = jobUrl(consoleUrl, project.id, result.job_id);
  maybeOpenBrowser(url);

  const lines = [
    `ESMFold2 batch queued (${inputs.length} inputs)`,
    `Job ID: ${result.job_id.substring(0, 8)}`,
    `Defaults: loops=${opts.loops}, steps=${opts.steps}, samples=${opts.samples}`,
    `Results returned in input order — no sorting applied.`,
    `View: ${url}`,
  ];
  output({ job_id: result.job_id, n_inputs: inputs.length, url }, lines.join('\n'));
}

// ─── ESMC embed ────────────────────────────────────────────────────────────

interface EsmcEmbedOpts {
  sequence: string[];
  layer: string;
  name?: string;
}

async function runEsmcEmbed(opts: EsmcEmbedOpts): Promise<void> {
  if (opts.sequence.length === 0) {
    process.stderr.write('Error: at least one --sequence is required.\n');
    process.exit(1);
  }
  const sequences = opts.sequence.map(resolveSequence);
  const project = requireProject();
  const client = createClient();
  const consoleUrl = getConsoleUrl();

  const result = await client.createEsmcEmbedJob({
    project_id: project.id,
    sequences,
    return_layer: opts.layer,
    title: opts.name,
  });

  const url = jobUrl(consoleUrl, project.id, result.job_id);
  maybeOpenBrowser(url);

  const lines = [
    `ESMC embedding job queued (${sequences.length} sequence${sequences.length > 1 ? 's' : ''})`,
    `Job ID: ${result.job_id.substring(0, 8)}`,
    `Layer: ${opts.layer}`,
    `View: ${url}`,
  ];
  output({ job_id: result.job_id, n_sequences: sequences.length, url }, lines.join('\n'));
}

function describeComplex(polymers: Boltz2Polymer[], ligands: Boltz2Ligand[]): string {
  const parts = polymers.map(p => `${p.molecule_type}(${p.sequence.length})`);
  if (ligands.length > 0) {
    parts.push(`ligand×${ligands.length}`);
  }
  return parts.join(' + ');
}
