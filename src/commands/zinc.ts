import type { Command } from 'commander';
import { output, formatTable } from '../output.js';
import { createAgentsClient } from '../cli.js';
import { requireApiKey } from '../config.js';

export function registerZincCommands(program: Command): void {
  const zinc = program
    .command('zinc')
    .description('Query ZINC purchasable compounds (self-hosted, 14M drug-like)')
    .hook('preAction', () => { requireApiKey(); });

  // ── m3t zinc search ───────────────���───────────────────────────
  zinc
    .command('search')
    .option('--mw-min <n>', 'Min molecular weight')
    .option('--mw-max <n>', 'Max molecular weight')
    .option('--logp-min <n>', 'Min LogP')
    .option('--logp-max <n>', 'Max LogP')
    .option('--subset <s>', 'Subset: drug-like, lead-like, fragment-like, fda, in-stock')
    .option('--limit <n>', 'Max results', '20')
    .description('Search purchasable compounds by properties')
    .action(async (opts) => {
      const agents = createAgentsClient();
      const params: Record<string, unknown> = {
        limit: parseInt(opts.limit),
      };
      if (opts.mwMin) params.mw_min = parseFloat(opts.mwMin);
      if (opts.mwMax) params.mw_max = parseFloat(opts.mwMax);
      if (opts.logpMin) params.logp_min = parseFloat(opts.logpMin);
      if (opts.logpMax) params.logp_max = parseFloat(opts.logpMax);
      if (opts.subset) params.subset = opts.subset;

      const data = await agents.callMcpTool('zinc', 'search_purchasable', params);

      if (typeof data.result === 'string') {
        output(data, data.result);
        return;
      }

      const compounds = extractArray(data, ['compounds', 'results', 'data']);
      if (compounds.length === 0) {
        output([], 'No compounds found.');
        return;
      }

      const rows = compounds.map(c => [
        str(c.zinc_id),
        str(c.smiles || c.canonical_smiles, 45),
        str(c.mw || c.molecular_weight),
        str(c.logp),
        str(c.subset || c.sub_set),
      ]);
      output(compounds, formatTable(['ZINC ID', 'SMILES', 'MW', 'LogP', 'Subset'], rows));
    });

  // ── m3t zinc info <zinc_id> ───────────────────────────────────
  zinc
    .command('info')
    .argument('<id>', 'ZINC compound ID (e.g., ZINC000000000001)')
    .description('Get details for a ZINC compound')
    .action(async (id: string) => {
      const agents = createAgentsClient();
      const data = await agents.callMcpTool('zinc', 'get_compound', { zinc_id: id });

      if (typeof data.result === 'string') {
        output(data, data.result);
      } else {
        output(data, JSON.stringify(data, null, 2));
      }
    });

  // ── m3t zinc random ───────��──────────────────────────────���────
  zinc
    .command('random')
    .option('--count <n>', 'Number of compounds', '20')
    .option('--subset <s>', 'Subset: drug-like, lead-like, fragment-like')
    .description('Get random purchasable compounds')
    .action(async (opts) => {
      const agents = createAgentsClient();
      const params: Record<string, unknown> = {
        count: parseInt(opts.count),
      };
      if (opts.subset) params.subset = opts.subset;

      const data = await agents.callMcpTool('zinc', 'get_random_compounds', params);

      if (typeof data.result === 'string') {
        output(data, data.result);
        return;
      }

      const compounds = extractArray(data, ['compounds', 'results', 'data']);
      if (compounds.length === 0) {
        output([], 'No compounds found.');
        return;
      }

      const rows = compounds.map(c => [
        str(c.zinc_id),
        str(c.smiles || c.canonical_smiles, 45),
        str(c.mw || c.molecular_weight),
        str(c.logp),
      ]);
      output(compounds, formatTable(['ZINC ID', 'SMILES', 'MW', 'LogP'], rows));
    });
}

// ── Helpers ────���──────────────────────��───────────────────────────

function str(val: unknown, maxLen?: number): string {
  const s = val != null ? String(val) : '-';
  return maxLen ? s.substring(0, maxLen) : s;
}

function extractArray(data: Record<string, unknown>, keys: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    if (Array.isArray(data[key])) return data[key] as Array<Record<string, unknown>>;
  }
  if (typeof data.result === 'string') {
    try { return extractArray(JSON.parse(data.result), keys); } catch { /* not JSON */ }
  }
  if (typeof data.result === 'object' && data.result !== null) {
    return extractArray(data.result as Record<string, unknown>, keys);
  }
  return [];
}
