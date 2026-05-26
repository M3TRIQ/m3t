#!/usr/bin/env node
import { Command } from 'commander';
import { setJsonMode } from './output.js';
import { getEffectiveConfig, requireApiKey } from './config.js';
import { M3triqClient, AgentsClient } from './client.js';
import { reportCliError } from './errorReporter.js';
import { registerConfigCommands } from './commands/config-cmd.js';
import { registerProjectCommands } from './commands/projects.js';
import { registerSessionCommands } from './commands/sessions.js';
import { registerJobCommands } from './commands/jobs.js';
import { registerDockingCommands } from './commands/docking.js';
import { registerPredictCommands } from './commands/predict.js';
import { registerChemblCommands } from './commands/chembl.js';
import { registerSandboxCommands } from './commands/sandbox.js';
import { registerDesignCommands } from './commands/design.js';
import { registerDataCommands } from './commands/data.js';
import { registerFoodbCommands } from './commands/foodb.js';
import { registerAdmetCommands } from './commands/admet.js';
import { registerMdCommands } from './commands/md.js';
import { registerZincCommands } from './commands/zinc.js';
import { registerCreditsCommands } from './commands/credits.js';
import { registerPricingCommands } from './commands/pricing.js';

const program = new Command();

program
  .name('m3t')
  .description('M3TRIQ — protein-ligand analysis from the terminal')
  .version('0.2.6')
  .option('--json', 'Output as JSON (machine-readable)')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.optsWithGlobals();
    if (opts.json) setJsonMode(true);
  });

registerConfigCommands(program);
registerProjectCommands(program);
registerSessionCommands(program);
registerJobCommands(program);
registerDockingCommands(program);
registerPredictCommands(program);
registerChemblCommands(program);
registerSandboxCommands(program);
registerDesignCommands(program);
registerDataCommands(program);
registerFoodbCommands(program);
registerAdmetCommands(program);
registerMdCommands(program);
registerZincCommands(program);
registerCreditsCommands(program);
registerPricingCommands(program);

// Last-line-of-defense catches: anything that escapes a command handler.
// These fire BEFORE process.exit(), so the reporter has time to flush
// (it has its own 3-second timeout to bound the wait).
process.on('uncaughtException', async (err) => {
  try { await reportCliError(err, { kind: 'uncaughtException' }); } catch {}
  process.stderr.write(`Error: ${err?.message || String(err)}\n`);
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  try { await reportCliError(reason, { kind: 'unhandledRejection' }); } catch {}
  const msg = reason instanceof Error ? reason.message : String(reason);
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
});

// Catch async errors from all command actions
program.parseAsync().catch(async (err: Error) => {
  // Don't beacon commander's own user-facing exits (--help, --version, bad args).
  const code = (err as Error & { code?: string }).code;
  const isCommanderExit = typeof code === 'string' && code.startsWith('commander.');
  if (!isCommanderExit) {
    try { await reportCliError(err, { kind: 'command' }); } catch {}
  }

  const message = err.message || String(err);
  if (message.includes('API error') || message.includes('MCP')) {
    process.stderr.write(`Error: ${message}\n`);
  } else if (message.includes('fetch failed') || message.includes('ECONNREFUSED')) {
    process.stderr.write(`Error: Could not reach M3TRIQ API. Check your connection and config.\n`);
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
  process.exit(1);
});

/** Create an API client from current config. Call lazily in command handlers. */
export function createClient(): M3triqClient {
  const config = getEffectiveConfig();
  const apiKey = requireApiKey();
  return new M3triqClient(apiKey, config.api_url!);
}

export function getConsoleUrl(): string {
  const config = getEffectiveConfig();
  return config.console_url!;
}

/** Create an agents client for MCP tool calls. */
export function createAgentsClient(): AgentsClient {
  const config = getEffectiveConfig();
  return new AgentsClient(config.agents_url!);
}
