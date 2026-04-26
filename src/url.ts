import { exec } from 'node:child_process';

export function jobUrl(consoleUrl: string, projectId: string, jobId: string): string {
  const shortProject = projectId.substring(0, 8);
  const shortJob = jobId.substring(0, 8);
  return `${consoleUrl}/?project=${shortProject}&view=jobs&job=${shortJob}`;
}

export function projectUrl(consoleUrl: string, projectId: string): string {
  const shortProject = projectId.substring(0, 8);
  return `${consoleUrl}/?project=${shortProject}`;
}

export function openInBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

/** Open browser only when stdout is a TTY (not piping) */
export function maybeOpenBrowser(url: string): void {
  if (process.stdout.isTTY) {
    openInBrowser(url);
    process.stderr.write(`Opened: ${url}\n`);
  }
}
