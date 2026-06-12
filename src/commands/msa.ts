import fs from 'node:fs';
import type { Command } from 'commander';
import { createClient, getConsoleUrl } from '../cli.js';
import { requireProject } from '../config.js';
import { output } from '../output.js';
import { jobUrl, maybeOpenBrowser } from '../url.js';

// m3t msa — generate a multiple-sequence alignment (a3m) for one or more chains.
// fast = AlphaFold2-NIM reduced DBs; deep = self-hosted ColabFold (UniRef30 +
// species-paired) on an A100. Produces a downloadable .a3m artifact per chain.
export function registerMsaCommands(program: Command): void {
  program.command('msa')
    .description('Generate a multiple-sequence alignment (a3m) — per-chain and (for complexes) species-paired')
    .option('--chain <id:seq>', 'Chain as "id:sequence" or "id:@path". Repeatable for multi-chain (paired) MSAs.', collectArg, [])
    .option('--sequence <seq>', 'Single-chain shortcut (chain id "A"). Use --chain for multi-chain.')
    .option('--depth <tier>', 'MSA depth: "fast" (reduced DBs, ~quick) or "deep" (ColabFold UniRef30 + paired, A100)', 'fast')
    .option('--pair', 'Compute species-paired MSA across chains (complexes). Default on for ≥2 distinct chains.')
    .option('--no-pair', 'Skip paired MSA (per-chain only).')
    .option('--name <name>', 'Custom job title')
    .action(async (opts) => {
      await runMsa(opts);
    });
}

interface MsaOpts {
  chain: string[];
  sequence?: string;
  depth: string;
  pair: boolean;            // commander sets true unless --no-pair is given
  name?: string;
}

async function runMsa(opts: MsaOpts): Promise<void> {
  const depth = (opts.depth || 'fast').toLowerCase();
  if (depth !== 'fast' && depth !== 'deep') {
    process.stderr.write(`Error: --depth must be "fast" or "deep", got "${opts.depth}".\n`);
    process.exit(1);
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

  const project = requireProject();
  const client = createClient();
  const consoleUrl = getConsoleUrl();

  const result = await client.createMsaJob({
    project_id: project.id,
    chains,
    depth: depth as 'fast' | 'deep',
    pair,
    title: opts.name,
  });

  const url = jobUrl(consoleUrl, project.id, result.job_id);
  maybeOpenBrowser(url);

  const timeEst = depth === 'deep'
    ? '~3-10 min (ColabFold A100; +cold start if scaled to zero)'
    : '~2-5 min (reduced DBs; +cold start if scaled to zero)';
  const lines = [
    `MSA job queued (${chains.length} chain${chains.length > 1 ? 's' : ''}, depth=${depth}${pair ? ', paired' : ''})`,
    `Job ID: ${result.job_id.substring(0, 8)}`,
    `Estimated: ${timeEst}`,
    `Output: one .a3m artifact per chain (Files tab)`,
    `View: ${url}`,
  ];
  output(
    { job_id: result.job_id, n_chains: chains.length, depth, pair, url },
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
