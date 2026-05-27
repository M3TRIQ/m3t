import fs from 'node:fs';
import https from 'node:https';
import type { Command } from 'commander';
import { createClient, getConsoleUrl } from '../cli.js';
import { requireProject, getEffectiveConfig } from '../config.js';
import { output } from '../output.js';
import { jobUrl, maybeOpenBrowser } from '../url.js';

const RFANTIBODY_URL = 'https://rfantibody-app.calmwater-f667a14d.southeastasia.azurecontainerapps.io';

/** Long-running HTTPS POST that bypasses Node's default 300s headers timeout */
function longPost(url: string, body: string): Promise<{ ok: boolean; status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 1800_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          resolve({ ok: res.statusCode! >= 200 && res.statusCode! < 300, status: res.statusCode!, data: text });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout (30 min)')); });
    req.write(body);
    req.end();
  });
}

async function fetchPdb(pdbId: string): Promise<string> {
  const url = `https://files.rcsb.org/download/${pdbId.toUpperCase()}.pdb`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch PDB ${pdbId}: ${res.status}`);
  return res.text();
}


async function waitForWarmup(baseUrl: string): Promise<void> {
  const maxWait = 300_000; // 5 min
  const start = Date.now();
  process.stderr.write('Warming up RFAntibody (Azure scale-to-zero)...');

  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`${baseUrl}/v1/health/ready`, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        process.stderr.write(' ready.\n');
        return;
      }
    } catch {
      // still starting
    }
    process.stderr.write('.');
    await new Promise(r => setTimeout(r, 5_000));
  }
  throw new Error('RFAntibody service did not become ready within 5 minutes');
}

export function registerDesignCommands(program: Command): void {
  const design = program.command('design').description('AI-powered protein design');

  // m3t design rfantibody
  design.command('rfantibody')
    .argument('<target>', 'Target PDB ID (e.g., 6VXX) or path to .pdb file')
    .requiredOption('--hotspots <residues>', 'Binding hotspot residues (e.g., A100,A105,A110)')
    .option('--type <type>', 'Antibody type: nanobody or scfv', 'nanobody')
    .option('--designs <n>', 'Number of designs (1-10)', (v: string) => parseInt(v, 10), 3)
    .option('--seqs <n>', 'Sequences per backbone (1-8)', (v: string) => parseInt(v, 10), 1)
    .option('--cdr <loops>', 'CDR loop specs (e.g., H1:7,H2:6,H3:5-13)')
    .description('Design de novo antibodies with RFAntibody (Azure T4 GPU, ~3-5 min)')
    .action(async (target: string, opts) => {
      const project = requireProject();
      const client = createClient();
      const config = getEffectiveConfig();
      const consoleUrl = getConsoleUrl();

      // Resolve target PDB
      process.stderr.write(`Resolving target: ${target}\n`);
      let rawPdb: string;
      if (fs.existsSync(target)) {
        rawPdb = fs.readFileSync(target, 'utf-8');
      } else {
        rawPdb = await fetchPdb(target);
      }

      const pdbContent = rawPdb;
      const hotspots = opts.hotspots;

      const framework = opts.type === 'scfv' ? 'human_scfv' : 'nanobody_vhh';
      const title = `RFAntibody ${opts.type} → ${target} (${hotspots})`;

      // Create Django job for tracking
      const jobResult = await client.createRFAntibodyJob({
        project_id: project.id,
        title,
        job_type: 'rfantibody_design',
        antibody_type: opts.type,
      });
      const jobId = jobResult.job_id;
      process.stderr.write(`Job created: ${jobId.substring(0, 8)}\n`);

      const url = jobUrl(consoleUrl, project.id, jobId);
      maybeOpenBrowser(url);

      // Warm up Azure service
      await waitForWarmup(RFANTIBODY_URL);

      // Call RFAntibody API
      process.stderr.write(`Running RFAntibody pipeline (${opts.designs} designs)...\n`);
      const startTime = Date.now();

      try {
        // Submit async job
        const submitRes = await longPost(`${RFANTIBODY_URL}/v1/design-antibody/async`, JSON.stringify({
          target_pdb: pdbContent,
          hotspots,
          antibody_type: opts.type,
          framework,
          num_designs: opts.designs,
          seqs_per_struct: opts.seqs,
          cdr_loops: opts.cdr,
        }));

        if (!submitRes.ok) {
          throw new Error(`RFAntibody API error ${submitRes.status}: ${submitRes.data.substring(0, 300)}`);
        }

        const { task_id } = JSON.parse(submitRes.data) as { task_id: string };
        process.stderr.write(`Task submitted: ${task_id.substring(0, 8)}\n`);

        // Poll for completion (max 20 min)
        type DesignResult = { success: boolean; designs: Array<{ sequence: string; rf2_pae?: number; rf2_plddt?: number; rf2_i_pae?: number }>; error?: string };
        let result: DesignResult | null = null;
        const maxPollTime = 1200_000; // 20 min
        const pollStart = Date.now();
        let pollErrors = 0;

        while (Date.now() - pollStart < maxPollTime) {
          await new Promise(r => setTimeout(r, 15_000)); // 15s between polls
          process.stderr.write('.');

          try {
            const pollRes = await fetch(`${RFANTIBODY_URL}/v1/task/${task_id}`, { signal: AbortSignal.timeout(10_000) });
            if (pollRes.status === 404) {
              // Task file not found — container may have recycled
              pollErrors++;
              if (pollErrors >= 5) throw new Error('Task lost — Azure container may have recycled. Try again.');
              continue; // retry: file might not be written yet
            }
            if (!pollRes.ok) {
              // 500s are expected when GPU is busy — keep retrying
              pollErrors++;
              if (pollErrors >= 10) throw new Error(`Poll failed ${pollErrors} times (last: HTTP ${pollRes.status})`);
              continue;
            }
            pollErrors = 0;

            const task = await pollRes.json() as { status: string; result: typeof result; error: string | null };
            if (task.status === 'completed') {
              result = task.result;
              process.stderr.write(' done.\n');
              break;
            } else if (task.status === 'failed') {
              throw new Error(task.error || 'Pipeline failed');
            }
          } catch (e) {
            if ((e as Error).message.includes('Task lost') || (e as Error).message.includes('Poll failed') || (e as Error).message.includes('Pipeline failed')) throw e;
            // Network errors during GPU compute are expected
            pollErrors++;
            if (pollErrors >= 10) throw e;
          }
        }

        if (!result) throw new Error('Pipeline timed out after 20 minutes');

        if (!result) throw new Error('No result returned');
        const r = result as DesignResult;

        const elapsed = Math.round((Date.now() - startTime) / 1000);

        if (!r.success || !r.designs?.length) {
          // Update job as failed
          await client.callbackJob(jobId, {
            status: 'failed',
            percentage: 0,
            message: (r.error || 'No designs generated').substring(0, 190),
            result: { error: r.error || 'No designs generated' },
          });
          process.stderr.write(`Failed: ${r.error || 'No designs generated'}\n`);
          process.exit(1);
        }

        // Update job as completed
        await client.callbackJob(jobId, {
          status: 'completed',
          percentage: 100,
          message: `${r.designs.length} designs generated`,
          result: { ...r, num_designs: r.designs.length },
        });

        // Format output
        const designs = r.designs.map((d: DesignResult['designs'][0], i: number) => ({
          rank: i + 1,
          sequence: d.sequence,
          rf2_plddt: d.rf2_plddt,
          rf2_i_pae: d.rf2_i_pae,
          rf2_pae: d.rf2_pae,
        }));

        const humanLines = [
          `RFAntibody completed in ${elapsed}s — ${r.designs.length} designs`,
          `Job ID: ${jobId.substring(0, 8)}`,
          '',
          ...designs.map(d =>
            `#${d.rank}  pLDDT: ${d.rf2_plddt?.toFixed(1) ?? '-'}  iPAE: ${d.rf2_i_pae?.toFixed(1) ?? '-'}  ${d.sequence.substring(0, 60)}...`
          ),
          '',
          `View: ${url}`,
        ];

        output({ job_id: jobId, elapsed_seconds: elapsed, designs, url }, humanLines.join('\n'));
      } catch (err) {
        await client.callbackJob(jobId, {
          status: 'failed',
          percentage: 0,
          message: String(err).substring(0, 190),
          result: { error: String(err) },
        }).catch(() => {});
        throw err;
      }
    });
}
