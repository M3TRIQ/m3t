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
    .command('project')
    .argument('<id>', 'Project ID (full or short 8-char)')
    .description('Show details for a specific project')
    .action(async (id: string) => {
      const client = createClient();
      // Resolve short ID via list
      let fullId = id;
      if (!id.includes('-')) {
        const projects = await client.listProjects();
        const match = projects.find(p => p.id.startsWith(id));
        if (!match) {
          process.stderr.write(`Error: No project found matching "${id}"\n`);
          process.exit(1);
        }
        fullId = match.id;
      }
      const project = await client.getProject(fullId);
      const consoleUrl = getConsoleUrl();
      const url = `${consoleUrl}/?project=${project.id.substring(0, 8)}`;

      const lines = [
        `Project:    ${project.name}`,
        `ID:         ${project.id}`,
      ];
      if (project.description) lines.push(`Summary:    ${project.description}`);
      if (project.owner_name || project.owner_email) lines.push(`Owner:      ${project.owner_name || ''} <${project.owner_email || ''}>`);
      if (project.user_role) lines.push(`Your role:  ${project.user_role}${project.is_shared ? ' (shared)' : ''}`);
      if (project.session_count !== undefined) lines.push(`Sessions:   ${project.session_count}`);
      if (project.member_count !== undefined) lines.push(`Members:    ${project.member_count}`);
      if (project.created_at) lines.push(`Created:    ${project.created_at}`);
      if (project.last_activity_at) lines.push(`Last used:  ${project.last_activity_at}`);
      lines.push(`View:       ${url}`);
      if (project.context) {
        lines.push('');
        lines.push('Project context (knowledge base):');
        const ctx = project.context.length > 800 ? project.context.substring(0, 800) + '\n…(truncated)' : project.context;
        lines.push(ctx);
      }

      output(project, lines.join('\n'));
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
