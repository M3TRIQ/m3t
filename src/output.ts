let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

/** Output data. JSON mode → structured JSON. Human mode → formatted text. */
export function output(data: unknown, humanText: string): void {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    process.stdout.write(humanText + '\n');
  }
}

/** Error output. Always stderr. */
export function error(message: string): void {
  process.stderr.write(`Error: ${message}\n`);
}

/** Format aligned table from rows. */
export function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] || '').length))
  );
  const header = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
  const lines = rows.map(r =>
    r.map((c, i) => (c || '').padEnd(widths[i])).join('  ')
  );
  return [header, ...lines].join('\n');
}
