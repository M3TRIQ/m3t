import type { Command } from 'commander';
import { createClient, getConsoleUrl } from '../cli.js';
import { requireProject } from '../config.js';
import { output } from '../output.js';
import { jobUrl, maybeOpenBrowser } from '../url.js';

export function registerPredictCommands(program: Command): void {
  const predict = program.command('predict').description('Predict 3D protein structure from sequence');

  // m3t predict esmfold
  predict.command('esmfold')
    .argument('<sequence>', 'Amino acid sequence (single letter codes, max 1024aa)')
    .option('--name <name>', 'Name for the prediction')
    .description('Fast structure prediction with ESMFold (~10 seconds)')
    .action(async (sequence: string, opts) => {
      await runPredict(sequence, 'esmfold', opts.name);
    });

  // m3t predict alphafold2
  predict.command('alphafold2')
    .argument('<sequence>', 'Amino acid sequence (single letter codes, max 2048aa)')
    .option('--name <name>', 'Name for the prediction')
    .description('High-accuracy prediction with AlphaFold2 (~5 minutes, scale-to-zero VM)')
    .action(async (sequence: string, opts) => {
      await runPredict(sequence, 'alphafold2', opts.name);
    });
}

async function runPredict(sequence: string, method: 'esmfold' | 'alphafold2', name?: string): Promise<void> {
  const project = requireProject();
  const client = createClient();
  const consoleUrl = getConsoleUrl();

  const result = await client.createStructurePrediction({
    project_id: project.id,
    sequence,
    method,
    name,
  });

  const url = jobUrl(consoleUrl, project.id, result.job_id);
  maybeOpenBrowser(url);

  const timeEst = method === 'alphafold2' ? '~5 minutes' : '~10 seconds';
  const data = { job_id: result.job_id, method, sequence_length: sequence.length, url };
  output(data, `${method} prediction created\nJob ID: ${result.job_id.substring(0, 8)}\nLength: ${sequence.length} residues\nEstimated: ${timeEst}`);
}
