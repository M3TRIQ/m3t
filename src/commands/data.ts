import type { Command } from 'commander';
import { createClient, getConsoleUrl } from '../cli.js';
import { requireProject } from '../config.js';
import { output, formatTable } from '../output.js';

export function registerDataCommands(program: Command): void {
  program
    .command('data')
    .description('List project data (datasets, structures, files)')
    .option('--type <type>', 'Filter by type: dataset, structure, file, folder')
    .option('--limit <n>', 'Max items', '20')
    .action(async (opts) => {
      const project = requireProject();
      const client = createClient();
      const items = await client.listProjectData(project.id);

      let filtered = items;
      if (opts.type) {
        filtered = items.filter((d: Record<string, unknown>) =>
          String(d.data_type).includes(opts.type)
        );
      }
      filtered = filtered.slice(0, parseInt(opts.limit));

      const data = filtered.map((d: Record<string, unknown>) => ({
        id: d.id,
        type: d.data_type,
        name: d.name,
        created_at: d.created_at,
      }));

      const rows = filtered.map((d: Record<string, unknown>) => [
        String(d.id).substring(0, 8),
        String(d.data_type),
        String(d.name).substring(0, 50),
      ]);

      output(data, formatTable(['ID', 'Type', 'Name'], rows));
    });

  program
    .command('dataset')
    .argument('<id>', 'Dataset ID (full or short 8-char)')
    .option('--limit <n>', 'Max rows to show', '20')
    .option('--columns <cols>', 'Comma-separated columns to show')
    .description('View dataset rows')
    .action(async (id: string, opts) => {
      const project = requireProject();
      const client = createClient();

      // Resolve short ID
      let fullId = id;
      if (!id.includes('-')) {
        const items = await client.listProjectData(project.id);
        const match = items.find((d: Record<string, unknown>) => String(d.id).startsWith(id));
        if (!match) {
          process.stderr.write(`Error: No data found matching "${id}"\n`);
          process.exit(1);
        }
        fullId = String(match.id);
      }

      const item = await client.getProjectData(project.id, fullId);
      const jsonData = item.json_data as Record<string, unknown> | Array<Record<string, unknown>> | null;

      if (!jsonData) {
        // Not a dataset — show metadata
        output(item, `${item.name}\nType: ${item.data_type}\nNo tabular data.`);
        return;
      }

      // Handle both formats: list of objects or {columns, rows}
      let allRows: Record<string, unknown>[];
      if (Array.isArray(jsonData)) {
        allRows = jsonData;
      } else if ('rows' in jsonData && Array.isArray((jsonData as Record<string, unknown>).rows)) {
        allRows = (jsonData as Record<string, unknown>).rows as Record<string, unknown>[];
      } else {
        output(jsonData, JSON.stringify(jsonData, null, 2).substring(0, 2000));
        return;
      }

      const limit = parseInt(opts.limit);
      const displayRows = allRows.slice(0, limit);

      if (displayRows.length === 0) {
        output({ name: item.name, rows: 0 }, `${item.name}: empty dataset`);
        return;
      }

      // Determine columns
      let columns: string[];
      if (opts.columns) {
        columns = opts.columns.split(',').map((c: string) => c.trim());
      } else {
        columns = Object.keys(displayRows[0]);
      }

      const tableRows = displayRows.map((r: Record<string, unknown>) =>
        columns.map(c => {
          const val = r[c];
          if (val === null || val === undefined) return '-';
          const s = String(val);
          return s.length > 40 ? s.substring(0, 37) + '...' : s;
        })
      );

      const fullData = { name: item.name, total_rows: allRows.length, columns, rows: displayRows };
      const header = `${item.name} (${allRows.length} rows)`;
      output(fullData, `${header}\n\n${formatTable(columns, tableRows)}`);
    });
}
