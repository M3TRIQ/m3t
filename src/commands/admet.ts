import type { Command } from 'commander';
import { output, formatTable } from '../output.js';
import { createAgentsClient } from '../cli.js';
import { requireApiKey } from '../config.js';

export function registerAdmetCommands(program: Command): void {
  const admet = program
    .command('admet')
    .description('Predict ADMET properties (self-hosted ADMET-AI, 41 properties)')
    .hook('preAction', () => { requireApiKey(); });

  // ── m3t admet predict <smiles> ────────────────────────────────
  admet
    .command('predict')
    .argument('<smiles>', 'SMILES string of compound')
    .description('Predict ADMET properties for a single compound')
    .action(async (smiles: string) => {
      const agents = createAgentsClient();
      process.stderr.write('Predicting ADMET properties...\n');
      const data = await agents.callMcpTool('admet', 'predict_admet', { smiles });

      if (typeof data.result === 'string') {
        output(data, data.result);
        return;
      }

      // Try to format structured ADMET results
      const props = extractProperties(data);
      if (props) {
        output(data, formatAdmetResult(smiles, props));
      } else {
        output(data, JSON.stringify(data, null, 2));
      }
    });

  // ── m3t admet batch <smiles...> ───────────────────────────────
  admet
    .command('batch')
    .argument('<smiles...>', 'SMILES strings (space-separated, max 100)')
    .description('Predict ADMET for multiple compounds')
    .action(async (smilesList: string[]) => {
      if (smilesList.length > 100) {
        process.stderr.write('Error: Maximum 100 compounds per batch.\n');
        process.exit(1);
      }
      const agents = createAgentsClient();
      process.stderr.write(`Predicting ADMET for ${smilesList.length} compounds...\n`);
      const data = await agents.callMcpTool('admet', 'predict_admet_batch', {
        smiles_list: smilesList,
      });

      if (typeof data.result === 'string') {
        output(data, data.result);
      } else {
        output(data, JSON.stringify(data, null, 2));
      }
    });

  // ── m3t admet compare <smiles1> <smiles2> ─────────────────────
  admet
    .command('compare')
    .argument('<smiles1>', 'SMILES of first compound')
    .argument('<smiles2>', 'SMILES of second compound')
    .option('--name1 <n>', 'Name for compound 1', 'Compound 1')
    .option('--name2 <n>', 'Name for compound 2', 'Compound 2')
    .description('Compare ADMET profiles of two compounds side-by-side')
    .action(async (smiles1: string, smiles2: string, opts) => {
      const agents = createAgentsClient();
      process.stderr.write(`Comparing ${opts.name1} vs ${opts.name2}...\n`);
      const data = await agents.callMcpTool('admet', 'compare_admet', {
        smiles1,
        smiles2,
        name1: opts.name1,
        name2: opts.name2,
      });

      if (typeof data.result === 'string') {
        output(data, data.result);
      } else {
        output(data, JSON.stringify(data, null, 2));
      }
    });
}

// ── Helpers ───────────────────────────────────────────────────────

function extractProperties(data: Record<string, unknown>): Record<string, unknown> | null {
  if (data.predictions) return data.predictions as Record<string, unknown>;
  if (data.properties) return data.properties as Record<string, unknown>;
  if (data.admet) return data.admet as Record<string, unknown>;
  if (typeof data.result === 'object' && data.result !== null) {
    return extractProperties(data.result as Record<string, unknown>);
  }
  return null;
}

function formatAdmetResult(smiles: string, props: Record<string, unknown>): string {
  const lines: string[] = [`ADMET Prediction: ${smiles}`, ''];

  // Group properties by category if they follow ADMET naming
  const categories: Record<string, Array<[string, string]>> = {};
  for (const [key, value] of Object.entries(props)) {
    const category = categorize(key);
    if (!categories[category]) categories[category] = [];
    categories[category].push([key, formatValue(value)]);
  }

  for (const [category, entries] of Object.entries(categories)) {
    lines.push(`── ${category} ──`);
    for (const [key, val] of entries) {
      lines.push(`  ${key.padEnd(35)} ${val}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function categorize(key: string): string {
  const k = key.toLowerCase();
  if (k.includes('caco') || k.includes('pampa') || k.includes('hia') || k.includes('pgp') || k.includes('bioavail') || k.includes('solub') || k.includes('logd') || k.includes('hydra')) return 'Absorption';
  if (k.includes('bbb') || k.includes('ppb') || k.includes('vd') || k.includes('distribution')) return 'Distribution';
  if (k.includes('cyp') || k.includes('metabol')) return 'Metabolism';
  if (k.includes('half_life') || k.includes('clearance') || k.includes('excret')) return 'Excretion';
  if (k.includes('herg') || k.includes('ames') || k.includes('dili') || k.includes('ld50') || k.includes('toxic') || k.includes('carcin') || k.includes('skin') || k.includes('nr_')) return 'Toxicity';
  if (k.includes('mw') || k.includes('logp') || k.includes('hba') || k.includes('hbd') || k.includes('tpsa') || k.includes('lipinski') || k.includes('qed')) return 'Physicochemical';
  return 'Other';
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '-';
  if (typeof val === 'number') return val.toFixed(4);
  if (typeof val === 'boolean') return val ? 'PASS' : 'FAIL';
  return String(val);
}
