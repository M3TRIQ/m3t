import fs from 'node:fs';
import type { Command } from 'commander';
import { createClient, getConsoleUrl } from '../cli.js';
import { requireProject } from '../config.js';
import { output } from '../output.js';
import { jobUrl, maybeOpenBrowser } from '../url.js';

export function registerSandboxCommands(program: Command): void {
  program
    .command('run')
    .argument('<script>', 'Python script file path (- for stdin)')
    .option('--packages <list>', 'Comma-separated pip packages', (v: string) => v.split(','))
    .option('--save <name>', 'Save results as a project dataset with this name')
    .option('--timeout <seconds>', 'Timeout in seconds', parseInt)
    .option('--name <name>', 'Script name shown in UI')
    .description('Run a Python script in secure sandbox')
    .action(async (scriptPath: string, opts) => {
      const project = requireProject();
      const client = createClient();
      const consoleUrl = getConsoleUrl();

      const script = scriptPath === '-'
        ? fs.readFileSync(0, 'utf-8')
        : fs.readFileSync(scriptPath, 'utf-8');

      const scriptName = opts.name || (scriptPath === '-' ? 'CLI Script' : scriptPath.split('/').pop());

      const result = await client.createSandboxJob({
        project_id: project.id,
        script,
        script_name: scriptName,
        packages: opts.packages || [],
        timeout: opts.timeout || 600,
        save_to_dataset: !!opts.save,
        dataset_name: opts.save,
      });

      const url = jobUrl(consoleUrl, project.id, result.job_id);
      maybeOpenBrowser(url);

      const data = { job_id: result.job_id, script_name: scriptName, url };
      output(data, `Sandbox job created\nJob ID: ${result.job_id.substring(0, 8)}\nScript: ${scriptName}`);
    });
}
