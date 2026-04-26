import type { Command } from 'commander';
import { loadConfig, saveConfig, getEffectiveConfig, loadLocalProject } from '../config.js';
import { output } from '../output.js';

export function registerConfigCommands(program: Command): void {
  program
    .command('config')
    .description('Show or update CLI configuration')
    .option('--key <api-key>', 'Set API key')
    .option('--url <api-url>', 'Set API URL')
    .option('--console <console-url>', 'Set console URL')
    .action((opts) => {
      const config = loadConfig();

      // Update fields if provided
      let updated = false;
      if (opts.key) { config.api_key = opts.key; updated = true; }
      if (opts.url) { config.api_url = opts.url; updated = true; }
      if (opts.console) { config.console_url = opts.console; updated = true; }

      if (updated) {
        saveConfig(config);
        process.stderr.write('Config saved.\n');
      }

      // Display current config
      const effective = getEffectiveConfig();
      const maskedKey = effective.api_key
        ? `***${effective.api_key.slice(-8)}`
        : '(not set)';

      const data = {
        api_key: maskedKey,
        api_url: effective.api_url,
        console_url: effective.console_url,
        active_project: effective.active_project || null,
        active_project_name: effective.active_project_name || null,
      };

      const local = loadLocalProject();
      const projectSource = local ? 'local .m3triq' : effective.active_project ? 'global' : '';

      const human = [
        `API Key:     ${maskedKey}`,
        `API URL:     ${effective.api_url}`,
        `Console URL: ${effective.console_url}`,
        `Project:     ${effective.active_project_name || '(none)'} ${effective.active_project ? `(${effective.active_project.substring(0, 8)})` : ''} ${projectSource ? `[${projectSource}]` : ''}`,
      ].join('\n');

      output(data, human);
    });
}
