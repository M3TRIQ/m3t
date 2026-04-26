import type { Command } from 'commander';
import { output, formatTable } from '../output.js';
import { createAgentsClient } from '../cli.js';
import { requireApiKey, requireProject } from '../config.js';

export function registerFoodbCommands(program: Command): void {
  const foodb = program
    .command('foodb')
    .description('Query the M3TRIQ FooDB database (self-hosted, food compounds)')
    .hook('preAction', () => { requireApiKey(); });

  // ── m3t foodb search <food> ───────────────────────────────────
  foodb
    .command('search')
    .argument('<food>', 'Food name (e.g., "tomato", "coffee", "soybean")')
    .option('--category <cat>', 'Filter by category (e.g., flavonoid, alkaloid)')
    .option('--limit <n>', 'Max results', '20')
    .option('--save <name>', 'Save results as project dataset')
    .description('Search compounds in a specific food')
    .action(async (food: string, opts) => {
      const agents = createAgentsClient();
      const params: Record<string, unknown> = {
        food_name: food,
        limit: parseInt(opts.limit),
        auto_save: false,
      };
      if (opts.category) params.category = opts.category;
      if (opts.save) {
        const project = requireProject();
        params.auto_save = true;
        params.project_id = project.id;
      }

      const data = await agents.callMcpTool('foodb', 'search_food_compounds', params);
      const compounds = extractArray(data, ['compounds', 'results', 'data']);

      if (compounds.length === 0) {
        // Might be text response
        if (typeof data.result === 'string') {
          output(data, data.result);
        } else {
          output([], 'No compounds found.');
        }
        return;
      }

      const rows = compounds.map(c => [
        str(c.name, 30),
        str(c.smiles || c.canonical_smiles, 40),
        str(c.category, 15),
        str(c.concentration || c.content),
      ]);
      output(compounds, formatTable(['Compound', 'SMILES', 'Category', 'Content'], rows));
      if (opts.save) process.stderr.write(`Saved as dataset: ${opts.save}\n`);
    });

  // ── m3t foodb info <compound> ─────────────────────────────────
  foodb
    .command('info')
    .argument('<compound>', 'Compound name (e.g., "caffeine", "quercetin")')
    .description('Get detailed compound information')
    .action(async (compound: string) => {
      const agents = createAgentsClient();
      const data = await agents.callMcpTool('foodb', 'get_compound_info', {
        compound_name: compound,
      });

      if (typeof data.result === 'string') {
        output(data, data.result);
      } else {
        output(data, JSON.stringify(data, null, 2));
      }
    });

  // ── m3t foodb export <food> ───────────────────────────────────
  foodb
    .command('export')
    .argument('<food>', 'Food name to export compounds from')
    .option('--limit <n>', 'Max compounds to export', '50')
    .option('--name <name>', 'Dataset name')
    .description('Export food compounds to project as dataset')
    .action(async (food: string, opts) => {
      const project = requireProject();
      const agents = createAgentsClient();
      const params: Record<string, unknown> = {
        food_name: food,
        limit: parseInt(opts.limit),
        project_id: project.id,
      };
      if (opts.name) params.dataset_name = opts.name;

      process.stderr.write(`Exporting ${food} compounds to project...\n`);
      const data = await agents.callMcpTool('foodb', 'export_compounds_to_project', params);

      if (typeof data.result === 'string') {
        output(data, data.result);
      } else {
        output(data, JSON.stringify(data, null, 2));
      }
    });

  // ── m3t foodb random ──────────────────────────────────────────
  foodb
    .command('random')
    .option('--count <n>', 'Number of compounds', '20')
    .option('--group <g>', 'Food group filter (e.g., Vegetables, Fruits, "Herbs and Spices")')
    .description('Get random food compounds with SMILES')
    .action(async (opts) => {
      const agents = createAgentsClient();
      const params: Record<string, unknown> = {
        count: parseInt(opts.count),
        with_smiles_only: true,
      };
      if (opts.group) params.food_group = opts.group;

      const data = await agents.callMcpTool('foodb', 'get_random_compounds', params);
      const compounds = extractArray(data, ['compounds', 'results', 'data']);

      if (compounds.length === 0) {
        if (typeof data.result === 'string') {
          output(data, data.result);
        } else {
          output([], 'No compounds found.');
        }
        return;
      }

      const rows = compounds.map(c => [
        str(c.name, 30),
        str(c.smiles || c.canonical_smiles, 45),
        str(c.food_name || c.food, 20),
      ]);
      output(compounds, formatTable(['Compound', 'SMILES', 'Source Food'], rows));
    });
}

// ── Helpers ───────────────────────────────────────────────────────

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
