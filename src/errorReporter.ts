// Beacon CLI errors to Django POST /api/errors/.
// Best-effort: never throws, never blocks the exit beyond ~3 seconds.

import os from 'node:os';
import { getEffectiveConfig } from './config.js';

const REPORT_TIMEOUT_MS = 3000;

export interface ReportContext {
  kind?: string;          // 'uncaught' | 'unhandledRejection' | 'command'
  argv?: string[];        // process.argv at the time of error
}

export async function reportCliError(err: unknown, context: ReportContext = {}): Promise<void> {
  let config;
  try {
    config = getEffectiveConfig();
  } catch {
    return;
  }

  // Opt-out gate. Either the config flag or env var disables reporting.
  if (config.error_reporting_disabled === true) return;
  if (process.env.M3TRIQ_NO_ERROR_REPORTING === '1') return;

  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? (err.stack || '') : '';

  const argv = (context.argv || process.argv).slice(1);
  // Replace any token-like value (long hex/base64 strings) with a placeholder.
  const sanitizedArgv = argv.map(a => /^[A-Za-z0-9_\-+/=]{32,}$/.test(a) ? '<redacted>' : a);
  const url_or_cmd = sanitizedArgv.join(' ').slice(0, 500);

  const cliVersion = await readCliVersion();

  const payload = {
    source: 'cli',
    session_id: '',
    url_or_cmd,
    message: message.slice(0, 5000),
    stack: stack.slice(0, 10000),
    metadata: {
      kind: context.kind || 'command',
      cli_version: cliVersion,
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      os_release: os.release(),
    },
  };

  const url = `${config.api_url || 'https://server.m3triq.com'}/api/errors/`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REPORT_TIMEOUT_MS);

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch {
    // Best-effort: swallow network errors, timeouts, anything.
  } finally {
    clearTimeout(timer);
  }
}

let _cachedVersion: string | null = null;
async function readCliVersion(): Promise<string> {
  if (_cachedVersion) return _cachedVersion;
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const pkgPath = path.join(here, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    _cachedVersion = pkg.version || 'unknown';
    return _cachedVersion!;
  } catch {
    _cachedVersion = 'unknown';
    return _cachedVersion;
  }
}
