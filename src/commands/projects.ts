import type { Command } from 'commander';
import { createClient, getConsoleUrl } from '../cli.js';
import { loadConfig, saveConfig, saveLocalProject, getEffectiveConfig, loadLocalProject } from '../config.js';
import { output, formatTable } from '../output.js';

export function registerProjectCommands(program: Command): void {
  program
    .command('projects')
    .description('List all accessible projects')
    .action(async () => {
      const client = createClient();
      const projects = await client.listProjects();
      const activeId = getEffectiveConfig().active_project;

      const data = projects.map(p => ({
        ...p,
        active: p.id === activeId,
      }));

      const rows = projects.map(p => [
        p.id.substring(0, 8),
        p.name,
        p.id === activeId ? '(active)' : '',
      ]);

      output(data, formatTable(['ID', 'Name', ''], rows));
    });

  program
    .command('use')
    .argument('<id>', 'Project ID (full or short 8-char)')
    .option('--global', 'Set globally in ~/.m3triq/config.json instead of local .m3triq')
    .description('Set the active project (writes .m3triq in current directory)')
    .action(async (id: string, opts) => {
      const client = createClient();
      const projects = await client.listProjects();
      const match = projects.find(p => p.id === id || p.id.startsWith(id));

      if (!match) {
        process.stderr.write(`Error: No project found matching "${id}"\n`);
        process.exit(1);
      }

      if (opts.global) {
        // Save to global config
        const config = loadConfig();
        config.active_project = match.id;
        config.active_project_name = match.name;
        saveConfig(config);
        process.stderr.write(`Saved to ~/.m3triq/config.json (global)\n`);
      } else {
        // Save to local .m3triq in cwd
        saveLocalProject(match.id, match.name);
        process.stderr.write(`Saved to .m3triq (${process.cwd()})\n`);
      }

      const consoleUrl = getConsoleUrl();
      const data = { id: match.id, name: match.name, url: `${consoleUrl}/?project=${match.id.substring(0, 8)}` };
      output(data, `Active project: ${match.name} (${match.id.substring(0, 8)})`);
    });
}
