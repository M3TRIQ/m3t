import type { Command } from 'commander';
import { output, formatTable } from '../output.js';
import { createAgentsClient } from '../cli.js';
import { requireApiKey, requireProject } from '../config.js';

export function registerChemblCommands(program: Command): void {
  const chembl = program
    .command('chembl')
    .description('Query the M3TRIQ ChEMBL database (self-hosted, 2.4M compounds)')
    .hook('preAction', () => { requireApiKey(); });

  // ── m3t chembl search <query> ─────────────────────────────────
  chembl
    .command('search')
    .argument('<query>', 'Compound name, SMILES, InChI, or ChEMBL ID')
    .option('--type <type>', 'Search type: name, smiles, inchi, chembl_id, similarity', 'name')
    .option('--limit <n>', 'Max results', '10')
    .option('--save <name>', 'Save results as project dataset')
    .description('Search ChEMBL compounds')
    .action(async (query: string, opts) => {
      const agents = createAgentsClient();
      const params: Record<string, unknown> = {
        query,
        search_type: opts.type,
        limit: parseInt(opts.limit),
        return_format: 'json',
        export_to_project: false,
      };

      if (opts.save) {
        const project = requireProject();
        params.export_to_project = true;
        params.project_id = project.id;
        params.dataset_name = opts.save;
      }

      const data = await agents.callMcpTool('chembl', 'search_compounds', params);
      const compounds = extractCompounds(data);

      if (compounds.length === 0) {
        output([], 'No compounds found.');
        return;
      }

      const rows = compounds.map(c => [
        str(c.chembl_id),
        str(c.name || c.pref_name, 30),
        str(c.molecular_weight || c.mw),
        str(c.alogp),
        str(c.canonical_smiles, 50),
      ]);

      output(compounds, formatTable(['ID', 'Name', 'MW', 'LogP', 'SMILES'], rows));
      if (opts.save) process.stderr.write(`Saved as dataset: ${opts.save}\n`);
    });

  // ── m3t chembl info <chembl_id> ───────────────────────────────
  chembl
    .command('info')
    .argument('<id>', 'ChEMBL compound ID (e.g., CHEMBL25)')
    .description('Get detailed compound information')
    .action(async (id: string) => {
      const agents = createAgentsClient();
      const data = await agents.callMcpTool('chembl', 'get_compound_info', {
        chembl_id: normalizeChemblId(id),
        return_format: 'json',
      });

      output(data, formatCompoundInfo(data));
    });

  // ── m3t chembl targets <query> ────────────────────────────────
  chembl
    .command('targets')
    .argument('<query>', 'Target name or gene symbol (e.g., EGFR, PDE3B)')
    .option('--type <type>', 'Target type: PROTEIN, ORGANISM, TISSUE, CELL-LINE')
    .option('--organism <org>', 'Filter by organism (e.g., "Homo sapiens")')
    .option('--limit <n>', 'Max results', '10')
    .description('Search protein targets')
    .action(async (query: string, opts) => {
      const agents = createAgentsClient();
      const params: Record<string, unknown> = {
        query,
        limit: parseInt(opts.limit),
        return_format: 'json',
      };
      if (opts.type) params.target_type = opts.type;
      if (opts.organism) params.organism = opts.organism;

      const data = await agents.callMcpTool('chembl', 'search_targets', params);
      const targets = extractTargets(data);

      if (targets.length === 0) {
        output([], 'No targets found.');
        return;
      }

      const rows = targets.map(t => [
        str(t.chembl_id || t.target_chembl_id),
        str(t.name || t.pref_name, 40),
        str(t.organism),
        str(t.target_type),
      ]);

      output(targets, formatTable(['ID', 'Name', 'Organism', 'Type'], rows));
    });

  // ── m3t chembl binders <target> ───────────────────────────────
  chembl
    .command('binders')
    .argument('<target>', 'Target name or gene symbol (e.g., PDE3B, EGFR)')
    .option('--activity <types>', 'Activity types, comma-separated (default: IC50,EC50,Ki,Kd)', 'IC50,EC50,Ki,Kd')
    .option('--max-value <nM>', 'Max activity value in nM (default: 10000)', '10000')
    .option('--limit <n>', 'Max results', '100')
    .option('--save <name>', 'Save results as project dataset')
    .description('Get all compounds binding to a target (with bioactivity data)')
    .action(async (target: string, opts) => {
      const agents = createAgentsClient();
      const params: Record<string, unknown> = {
        target_name: target,
        activity_types: opts.activity.split(','),
        max_value: parseFloat(opts.maxValue),
        limit: parseInt(opts.limit),
        return_format: 'json',
        export_to_project: false,
      };

      if (opts.save) {
        const project = requireProject();
        params.export_to_project = true;
        params.project_id = project.id;
        params.dataset_name = opts.save;
      }

      process.stderr.write(`Querying binders for ${target}...\n`);
      const data = await agents.callMcpTool('chembl', 'get_target_binders', params);
      const compounds = extractCompounds(data);

      if (compounds.length === 0) {
        output([], 'No binders found.');
        return;
      }

      const rows = compounds.map(c => [
        str(c.chembl_id),
        str(c.name || c.pref_name, 25),
        str(c.activity_type),
        str(c.activity_value),
        str(c.canonical_smiles, 40),
      ]);

      output(compounds, formatTable(['ID', 'Name', 'Type', 'Value (nM)', 'SMILES'], rows));
      process.stderr.write(`${compounds.length} binders found.\n`);
      if (opts.save) process.stderr.write(`Saved as dataset: ${opts.save}\n`);
    });

  // ── m3t chembl activities <chembl_id> ─────────────────────────
  chembl
    .command('activities')
    .argument('<id>', 'ChEMBL compound ID (e.g., CHEMBL25)')
    .option('--type <type>', 'Activity type: IC50, EC50, Ki, Kd, ED50, LD50, MIC')
    .option('--target <id>', 'Filter by target ChEMBL ID')
    .option('--limit <n>', 'Max results', '50')
    .description('Get bioactivity data for a compound')
    .action(async (id: string, opts) => {
      const agents = createAgentsClient();
      const params: Record<string, unknown> = {
        chembl_id: normalizeChemblId(id),
        limit: parseInt(opts.limit),
      };
      if (opts.type) params.activity_type = opts.type;
      if (opts.target) params.target_chembl_id = opts.target;

      const data = await agents.callMcpTool('chembl', 'get_compound_activities', params);

      // Activities endpoint returns text format — pass through
      if (typeof data.result === 'string') {
        output(data, data.result);
        return;
      }

      const activities = extractActivities(data);
      if (activities.length === 0) {
        output([], 'No activities found.');
        return;
      }

      const rows = activities.map(a => [
        str(a.activity_type || a.standard_type),
        str(a.value || a.standard_value),
        str(a.units || a.standard_units),
        str(a.target_name, 35),
        str(a.target_chembl_id),
      ]);

      output(activities, formatTable(['Type', 'Value', 'Units', 'Target', 'Target ID'], rows));
    });

  // ── m3t chembl similar <smiles> ───────────────────────────────
  chembl
    .command('similar')
    .argument('<smiles>', 'SMILES string of query compound')
    .option('--threshold <t>', 'Min Tanimoto similarity (0-1)', '0.7')
    .option('--limit <n>', 'Max results', '20')
    .description('Find structurally similar compounds')
    .action(async (smiles: string, opts) => {
      const agents = createAgentsClient();
      const data = await agents.callMcpTool('chembl', 'search_similar_compounds', {
        smiles,
        similarity_threshold: parseFloat(opts.threshold),
        limit: parseInt(opts.limit),
      });
      const compounds = extractCompounds(data);

      if (compounds.length === 0) {
        output([], 'No similar compounds found.');
        return;
      }

      const rows = compounds.map(c => [
        str(c.chembl_id),
        str(c.name || c.pref_name, 25),
        str(c.similarity),
        str(c.molecular_weight || c.mw),
        str(c.canonical_smiles, 40),
      ]);

      output(compounds, formatTable(['ID', 'Name', 'Similarity', 'MW', 'SMILES'], rows));
    });

  // ── m3t chembl sql <query> ────────────────────────────────────
  chembl
    .command('sql')
    .argument('<query>', 'SQL SELECT query')
    .option('--limit <n>', 'Max results', '100')
    .description('Execute read-only SQL against ChEMBL database')
    .action(async (query: string, opts) => {
      const agents = createAgentsClient();
      const data = await agents.callMcpTool('chembl', 'execute_custom_query', {
        query,
        limit: parseInt(opts.limit),
      });

      // Raw SQL results — output as-is
      output(data, JSON.stringify(data, null, 2));
    });
}

// ── Helpers ───────────────────────────────────────────────────────

function str(val: unknown, maxLen?: number): string {
  const s = val != null ? String(val) : '-';
  return maxLen ? s.substring(0, maxLen) : s;
}

/** Accept both "CHEMBL25" and "25" */
function normalizeChemblId(id: string): string {
  return id.startsWith('CHEMBL') ? id : `CHEMBL${id}`;
}

/**
 * Extract compound array from MCP response.
 * The response shape varies — could be { compounds: [...] }, { results: [...] },
 * or the array directly. This handles all cases.
 */
function extractCompounds(data: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.compounds)) return data.compounds;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.data)) return data.data;
  // Might be text response — try parsing
  if (typeof data.result === 'string') {
    try {
      const parsed = JSON.parse(data.result);
      return extractCompounds(parsed);
    } catch { /* not JSON */ }
  }
  if (typeof data.result === 'object' && data.result !== null) {
    return extractCompounds(data.result as Record<string, unknown>);
  }
  return [];
}

function extractTargets(data: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.targets)) return data.targets;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.data)) return data.data;
  if (typeof data.result === 'object' && data.result !== null) {
    return extractTargets(data.result as Record<string, unknown>);
  }
  return [];
}

function extractActivities(data: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.activities)) return data.activities;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.data)) return data.data;
  if (typeof data.result === 'object' && data.result !== null) {
    return extractActivities(data.result as Record<string, unknown>);
  }
  return [];
}

function formatCompoundInfo(data: Record<string, unknown>): string {
  const lines: string[] = [];
  const d = (data.result ?? data) as Record<string, unknown>;

  const fields: Array<[string, string]> = [
    ['ChEMBL ID', str(d.chembl_id || d.molecule_chembl_id)],
    ['Name', str(d.name || d.pref_name)],
    ['SMILES', str(d.canonical_smiles || d.smiles)],
    ['MW', str(d.molecular_weight || d.mw || d.full_mwt)],
    ['LogP', str(d.alogp || d.logp)],
    ['TPSA', str(d.psa || d.tpsa)],
    ['HBA', str(d.hba)],
    ['HBD', str(d.hbd)],
    ['Max Phase', str(d.max_phase)],
    ['Molecule Type', str(d.molecule_type)],
  ];

  for (const [label, value] of fields) {
    if (value !== '-') lines.push(`${label.padEnd(15)} ${value}`);
  }

  return lines.join('\n');
}
