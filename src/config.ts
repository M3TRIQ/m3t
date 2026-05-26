import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface M3triqConfig {
  api_key?: string;
  api_url?: string;
  agents_url?: string;
  console_url?: string;
  active_project?: string;
  active_project_name?: string;
  error_reporting_disabled?: boolean;
}

interface LocalProjectConfig {
  project_id: string;
  project_name?: string;
}

const LOCAL_CONFIG_FILE = '.m3triq';

// ── Global config (~/.m3triq/config.json) ───────────────────────

function configDir(): string {
  const dir = path.join(os.homedir(), '.m3triq');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function configPath(): string {
  return path.join(configDir(), 'config.json');
}

export function loadConfig(): M3triqConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    return JSON.parse(raw) as M3triqConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: M3triqConfig): void {
  const json = JSON.stringify(config, null, 2) + '\n';
  fs.writeFileSync(configPath(), json, { mode: 0o600 });
}

// ── Local project config (.m3triq in cwd or parent) ─────────────

/** Walk up from cwd to find a .m3triq file, like how git finds .git */
function findLocalConfig(): string | null {
  let dir = process.cwd();
  const root = path.parse(dir).root;

  while (true) {
    const candidate = path.join(dir, LOCAL_CONFIG_FILE);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir || parent === root) return null;
    dir = parent;
  }
}

export function loadLocalProject(): LocalProjectConfig | null {
  const configFile = findLocalConfig();
  if (!configFile) return null;
  try {
    const raw = fs.readFileSync(configFile, 'utf-8');
    return JSON.parse(raw) as LocalProjectConfig;
  } catch {
    return null;
  }
}

/** Save .m3triq in the current working directory */
export function saveLocalProject(projectId: string, projectName?: string): void {
  const config: LocalProjectConfig = { project_id: projectId };
  if (projectName) config.project_name = projectName;
  const filePath = path.join(process.cwd(), LOCAL_CONFIG_FILE);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
}

// ── Effective config (local > global > env) ─────────────────────

/**
 * Resolution order for project:
 *   1. Local .m3triq (cwd or parent)
 *   2. Global ~/.m3triq/config.json
 *
 * Resolution order for api_key/urls:
 *   1. Environment variables
 *   2. Global config
 *   3. Defaults
 */
export function getEffectiveConfig(): M3triqConfig {
  const file = loadConfig();
  const local = loadLocalProject();

  return {
    api_key: process.env.M3TRIQ_API_KEY || file.api_key,
    api_url: process.env.M3TRIQ_API_URL || file.api_url || 'https://server.m3triq.com',
    agents_url: process.env.M3TRIQ_AGENTS_URL || file.agents_url || 'https://agents.m3triq.com',
    console_url: process.env.M3TRIQ_CONSOLE_URL || file.console_url || 'https://console.m3triq.com',
    // Local project takes precedence over global
    active_project: local?.project_id || file.active_project,
    active_project_name: local?.project_name || file.active_project_name,
  };
}

export function requireApiKey(): string {
  const config = getEffectiveConfig();
  if (!config.api_key) {
    process.stderr.write('Error: No API key configured. Run: m3t config --key <your-key>\n');
    process.exit(1);
  }
  return config.api_key;
}

export function requireProject(): { id: string; name?: string } {
  const config = getEffectiveConfig();
  if (!config.active_project) {
    process.stderr.write('Error: No active project.\n  Run: m3t use <id>        (sets .m3triq in current directory)\n  Or:  m3t use --global <id>  (sets globally in ~/.m3triq/config.json)\n');
    process.exit(1);
  }
  return { id: config.active_project, name: config.active_project_name };
}
