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
    .action(async (id: string) => {
      const project = requireProject();
      const client = createClient();
      const fullId = await resolveJobId(client, project.id, id);
      const job = await client.getJob(fullId);

      const consoleUrl = getConsoleUrl();
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

      output(job, lines.join('\n'));
    });
}
