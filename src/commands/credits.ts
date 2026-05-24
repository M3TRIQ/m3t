import type { Command } from 'commander';
import { createClient } from '../cli.js';
import { output, formatTable, error } from '../output.js';

function formatPercentage(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

function progressBar(used: number, total: number, width = 30): string {
  if (total <= 0) return '';
  const ratio = Math.min(1, used / total);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

function formatCredits(n: number): string {
  return n.toLocaleString();
}

function shortJobId(jobId: string | null | undefined): string {
  if (!jobId) return '';
  return jobId.split('-')[0] || jobId.substring(0, 8);
}

export function registerCreditsCommands(program: Command): void {
  const credits = program
    .command('credits')
    .description('Show your account credit balance')
    .action(async () => {
      const client = createClient();
      let q;
      try {
        q = await client.getCredits();
      } catch (e) {
        error((e as Error).message);
        process.exit(1);
        return;
      }

      const remainingClass = q.is_quota_exceeded ? '!! EXHAUSTED' : '';
      const periodEnd = q.period_end ? new Date(q.period_end).toLocaleDateString() : '—';

      const lines = [
        `Tier:       ${q.tier}`,
        `Used:       ${formatCredits(q.credits_used)} / ${formatCredits(q.monthly_credits)}  ${progressBar(q.credits_used, q.monthly_credits)}  ${formatPercentage(q.usage_percentage || 0)}`,
        `Top-up:     ${formatCredits(q.topup_credits)}`,
        `Remaining:  ${formatCredits(q.credits_remaining)}  ${remainingClass}`.trimEnd(),
        `Resets:     ${periodEnd}`,
      ];

      output(q, lines.join('\n'));
    });

  credits
    .command('log')
    .description('Show your credit ledger (paginated)')
    .option('--event <type>', 'Filter to event type: reserve|tokens|refund|reconcile|topup|reset')
    .option('--since <date>', 'Events on or after this ISO date (yyyy-mm-dd)')
    .option('--until <date>', 'Events on or before this ISO date (yyyy-mm-dd)')
    .option('--page <n>', 'Page number (default 1)', '1')
    .option('--limit <n>', 'Results per page (default 25, max 200)', '25')
    .action(async (opts) => {
      const client = createClient();
      let response;
      try {
        response = await client.getCreditLog({
          page: parseInt(opts.page, 10),
          pageSize: parseInt(opts.limit, 10),
          event: opts.event,
          since: opts.since,
          until: opts.until,
        });
      } catch (e) {
        error((e as Error).message);
        process.exit(1);
        return;
      }

      if (response.results.length === 0) {
        output(response, 'No credit events match these filters.');
        return;
      }

      const rows = response.results.map(evt => {
        const detail = evt.note
          || (evt.metadata && (evt.metadata.job_type as string || evt.metadata.model as string))
          || '';
        const sign = evt.credits > 0 ? '-' : '+';
        const date = new Date(evt.created_at).toISOString().replace('T', ' ').substring(0, 16);
        return [
          date,
          evt.event,
          `${sign}${Math.abs(evt.credits).toLocaleString()}`,
          detail.toString().substring(0, 50),
          shortJobId(evt.job_id),
        ];
      });

      const page = parseInt(opts.page, 10);
      const limit = parseInt(opts.limit, 10);
      const totalPages = Math.max(1, Math.ceil(response.count / limit));
      const footer = `\nPage ${page} of ${totalPages}  •  ${response.count.toLocaleString()} total events`;

      output(
        response,
        formatTable(['Date (UTC)', 'Event', 'Credits', 'Detail', 'Job'], rows) + footer,
      );
    });
}
