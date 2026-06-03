import type { Command } from 'commander';
import { createClient, getConsoleUrl } from '../cli.js';
import { requireProject } from '../config.js';
import { output, formatTable } from '../output.js';
import { jobUrl } from '../url.js';

async function resolveJobId(client: import('../client.js').M3triqClient, projectId: string, input: string): Promise<string> {
  // Full UUID — use directly
  if (input.includes('-')) return input;
  // Short ID — search recent jobs for a prefix match
  const jobs = await client.listJobs(projectId, 200);
  const match = jobs.find(j => j.id.startsWith(input));
  if (!match) {
    process.stderr.write(`Error: No job found matching "${input}" in the 200 most recent jobs.\nTry using the full UUID instead.\n`);
    process.exit(1);
  }
  return match.id;
}

function summarizeResults(jobType: string, results: Record<string, unknown>): string {
  if (jobType.includes('docking')) {
    const score = results.best_score ?? results.affinity ?? results.score;
    if (score !== undefined) return `Best score: ${score} kcal/mol`;
  }
  if (jobType.includes('prediction') || jobType.includes('esmfold') || jobType.includes('alphafold')) {
    const plddt = results.plddt ?? results.mean_plddt;
    if (plddt !== undefined) return `Mean pLDDT: ${plddt}`;
  }
  return '';
}

export function registerJobCommands(program: Command): void {
  program
    .command('jobs')
    .description('List recent jobs in the active project')
    .option('--status <status>', 'Filter by status (completed, failed, running, queued)')
    .option('--limit <n>', 'Max jobs to return', '20')
    .action(async (opts) => {
      const project = requireProject();
      const client = createClient();
      let jobs = await client.listJobs(project.id, parseInt(opts.limit));

      if (opts.status) {
        jobs = jobs.filter(j => j.status === opts.status);
      }

      const data = jobs.map(j => ({
        id: j.id,
        status: j.status,
        type: j.job_type,
        title: j.title,
        progress: j.progress_percentage,
        created_at: j.created_at,
      }));

      const rows = jobs.map(j => [
        j.id.substring(0, 8),
        j.status,
        j.job_type,
        j.title || '',
      ]);

      output(data, formatTable(['ID', 'Status', 'Type', 'Title'], rows));
    });

  program
    .command('job')
    .argument('<id>', 'Job ID (full or short 8-char)')
    .description('Get job status and results')
    .option('-w, --watch', 'Poll until the job completes (or fails), redrawing in place every 5s')
    .option('--interval <sec>', 'Poll interval in seconds when --watch (default 5)', (v: string) => parseInt(v, 10), 5)
    .action(async (id: string, opts: { watch?: boolean; interval: number }) => {
      const project = requireProject();
      const client = createClient();
      const fullId = await resolveJobId(client, project.id, id);
      const consoleUrl = getConsoleUrl();

      const renderJob = (job: any): string => {
        const url = jobUrl(consoleUrl, project.id, job.id);
        const lines = [
          `Job:      ${job.title || job.id}`,
          `Type:     ${job.job_type}`,
          `Status:   ${job.status}`,
          `Progress: ${job.progress_percentage}%`,
        ];
        if (job.current_step) lines.push(`Step:     ${job.current_step}`);
        if (job.completed_at) lines.push(`Done:     ${job.completed_at}`);
        if (job.result_data && job.status === 'completed') {
          const summary = summarizeResults(job.job_type, job.result_data);
          if (summary) lines.push(summary);
        }
        lines.push(`View:     ${url}`);
        return lines.join('\n');
      };

      // Single snapshot (default) — matches previous behavior
      if (!opts.watch) {
        const job = await client.getJob(fullId);
        output(job, renderJob(job));
        return;
      }

      // Watch mode: redraw in place until terminal status. Falls back to
      // append-only output when stdout isn't a TTY (e.g. piped to a file).
      const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
      const intervalMs = Math.max(2, opts.interval) * 1000;
      const isTty = !!process.stdout.isTTY;
      let lastLineCount = 0;

      // Disable JSON mode in watch — we're emitting frames, not a single result.
      while (true) {
        const job = await client.getJob(fullId);
        const frame = renderJob(job);
        if (isTty) {
          // Move cursor up + clear the previous render before printing the new one.
          if (lastLineCount > 0) {
            process.stdout.write(`\x1b[${lastLineCount}A\x1b[0J`);
          }
          process.stdout.write(frame + '\n');
          lastLineCount = frame.split('\n').length;
        } else {
          process.stdout.write(`---\n${frame}\n`);
        }
        if (terminalStatuses.has(job.status)) return;
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    });
}
