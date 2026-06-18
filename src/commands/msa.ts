import fs from 'node:fs';
import type { Command } from 'commander';
import { createClient, getConsoleUrl } from '../cli.js';
import { requireProject } from '../config.js';
import { output } from '../output.js';
import { jobUrl, maybeOpenBrowser } from '../url.js';

// m3t msa — generate a multiple-sequence alignment (a3m) for one or more chains,
// all on the self-hosted ColabFold MSA-search engine (GPU-MMseqs2). Two independent
// knobs:
//   --depth  = COVERAGE (which databases): standard (UniRef30) | exhaustive (+envDB,
//              for remote-homology/orphan families) | custom (pick databases)
//   --pair   = species PAIRING, only meaningful for a multi-chain complex (on by
//              default; a monomer is never paired). --no-pair to force unpaired.
// --templates also searches the PDB and saves per-chain structural templates.
// Produces a downloadable .a3m artifact per chain (+ templates_<chain>.json).
// (Legacy --depth fast/deep still accepted: fast = standard+unpaired, deep = standard.)
const MSA_DEPTHS = ['standard', 'exhaustive', 'custom', 'fast', 'deep'];

export function registerMsaCommands(program: Command): void {
  program.command('msa')
    .description('Generate a multiple-sequence alignment (a3m) — per-chain and (for complexes) species-paired')
    .option('--chain <id:seq>', 'Chain as "id:sequence" or "id:@path". Repeatable for multi-chain (paired) MSAs.', collectArg, [])
    .option('--sequence <seq>', 'Single-chain shortcut (chain id "A"). Use --chain for multi-chain.')
    .option('--depth <coverage>', 'Coverage / databases: standard (UniRef30) | exhaustive (+ envDB) | custom', 'standard')
    .option('--templates', 'Also search the PDB for structural templates; saves a templates_<chain>.json per chain.')
    .option('--databases <csv>', 'For --depth custom: comma-separated database ids (e.g. "uniref30,envdb"). See get_msa_capabilities.')
    .option('--max-sequences <n>', 'For --depth custom: alignment depth/breadth cap.', (v: string) => parseInt(v, 10))
    .option('--pair', 'Species-paired MSA — only matters for a multi-chain complex (on by default; a monomer is never paired).')
    .option('--no-pair', 'Force unpaired (per-chain only), even for a complex.')
    .option('--name <name>', 'Custom job title')
    .action(async (opts) => {
      await runMsa(opts);
    });
}

interface MsaOpts {
  chain: string[];
  sequence?: string;
  depth: string;
  templates?: boolean;
  databases?: string;
  maxSequences?: number;
  pair: boolean;            // commander sets true unless --no-pair is given
  name?: string;
}

async function runMsa(opts: MsaOpts): Promise<void> {
  const depth = (opts.depth || 'standard').toLowerCase();
  if (!MSA_DEPTHS.includes(depth)) {
    process.stderr.write(`Error: --depth must be one of ${MSA_DEPTHS.join(' | ')}, got "${opts.depth}".\n`);
    process.exit(1);
  }

  // Build the custom config when depth=custom.
  let custom: { databases: string[]; max_sequences?: number; pair?: boolean } | undefined;
  if (depth === 'custom') {
    const databases = (opts.databases || '').split(',').map(s => s.trim()).filter(Boolean);
    if (databases.length === 0) {
      process.stderr.write('Error: --depth custom requires --databases (e.g. --databases "uniref30,envdb").\n');
      process.exit(1);
    }
    custom = { databases, max_sequences: opts.maxSequences, pair: opts.pair };
  }

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

  // pair only matters for ≥2 distinct chains; let the server make the final call too.
  const distinct = new Set(chains.map(c => c.sequence));
  const pair = opts.pair && chains.length >= 2 && distinct.size >= 2;
  const templates = !!opts.templates;

  const project = requireProject();
  const client = createClient();
  const consoleUrl = getConsoleUrl();

  const result = await client.createMsaJob({
    project_id: project.id,
    chains,
    depth: depth as 'standard' | 'exhaustive' | 'custom' | 'fast' | 'deep',
    pair,
    templates,
    custom,
    title: opts.name,
  });

  const url = jobUrl(consoleUrl, project.id, result.job_id);
  maybeOpenBrowser(url);

  const timeEst = depth === 'exhaustive'
    ? `~4-6 min (UniRef30 + envDB on 2 T4s${pair ? ' + paired' : ''}; +cold start if scaled to zero)`
    : `~3-5 min (UniRef30${pair ? ' + paired' : ''}; +cold start if scaled to zero)`;
  const extras = [pair ? 'paired' : 'unpaired', templates ? '+templates' : ''].filter(Boolean).join(', ');
  const lines = [
    `MSA job queued (${chains.length} chain${chains.length > 1 ? 's' : ''}, depth=${depth}${extras ? `, ${extras}` : ''})`,
    `Job ID: ${result.job_id.substring(0, 8)}`,
    `Estimated: ${timeEst}`,
    `Output: one .a3m artifact per chain${templates ? ' (+ templates_<chain>.json)' : ''} (Files tab)`,
    `View: ${url}`,
  ];
  output(
    { job_id: result.job_id, n_chains: chains.length, depth, pair, templates, url },
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
    return raw.split('\n').filter(line => !line.startsWith('>')).join('').replace(/\s+/g, '').toUpperCase();
  }
  return input.replace(/\s+/g, '').toUpperCase();
}
