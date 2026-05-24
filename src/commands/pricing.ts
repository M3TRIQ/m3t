import type { Command } from 'commander';
import { createClient } from '../cli.js';
import { output, formatTable, error } from '../output.js';

export function registerPricingCommands(program: Command): void {
  program
    .command('pricing')
    .description('Show what each operation costs in credits')
    .action(async () => {
      const client = createClient();
      let p;
      try {
        p = await client.getPricing();
      } catch (e) {
        error((e as Error).message);
        process.exit(1);
        return;
      }

      const jobRows = p.jobs.map(j => [j.label, j.credits.toLocaleString(), j.unit]);
      const mdRows = p.md_simulation.map(m => [m.label, m.credits.toLocaleString(), m.unit]);

      const lines = [
        'What things cost (credits)',
        '',
        `  ${p.note}`,
        '',
        formatTable(['Service', 'Credits', 'Metering'], jobRows),
        '',
        formatTable(['Molecular dynamics', 'Credits', 'Duration'], mdRows),
        '',
        `  ${p.sandbox.label}: ${p.sandbox.credits.toLocaleString()} cr (${p.sandbox.unit})`,
        `  ${p.ai.label}: ${p.ai.range} (${p.ai.unit})`,
        '',
        '  Runtime-metered jobs reserve an estimate up front and reconcile to actual usage.',
      ];

      output(p, lines.join('\n'));
    });
}
