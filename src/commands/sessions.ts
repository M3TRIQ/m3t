import type { Command } from 'commander';
import { createClient, getConsoleUrl } from '../cli.js';
import { requireProject } from '../config.js';
import { output, formatTable } from '../output.js';

async function resolveSessionId(
  client: import('../client.js').M3triqClient,
  projectId: string,
  input: string,
): Promise<string> {
  if (input.includes('-')) return input;
  const sessions = await client.listSessions(projectId, 200);
  const match = sessions.find(s => s.id.startsWith(input));
  if (!match) {
    process.stderr.write(`Error: No session found matching "${input}" in the 200 most recent sessions.\nTry using the full UUID instead.\n`);
    process.exit(1);
  }
  return match.id;
}

export function registerSessionCommands(program: Command): void {
  program
    .command('sessions')
    .description('List past chat sessions in the active project')
    .option('--limit <n>', 'Max sessions to return', '20')
    .option('--search <query>', 'Case-insensitive substring filter on title')
    .option('--with-notes', 'Only sessions that have context notes')
    .action(async (opts) => {
      const project = requireProject();
      const client = createClient();
      const limit = parseInt(opts.limit);
      let sessions = await client.listSessions(project.id, limit);

      if (opts.search) {
        const needle = String(opts.search).toLowerCase();
        sessions = sessions.filter(s => (s.title || '').toLowerCase().includes(needle));
      }
      if (opts.withNotes) {
        sessions = sessions.filter(s => s.has_notes);
      }

      const data = sessions.map(s => ({
        id: s.id,
        title: s.title,
        message_count: s.message_count,
        has_notes: s.has_notes,
        updated_at: s.updated_at,
      }));

      const rows = sessions.map(s => [
        s.id.substring(0, 8),
        (s.title || 'Untitled').substring(0, 50),
        String(s.message_count ?? ''),
        s.has_notes ? '📝' : '',
        (s.updated_at || s.created_at).substring(0, 19).replace('T', ' '),
      ]);

      output(data, formatTable(['ID', 'Title', 'Msgs', 'Notes', 'Updated'], rows));
    });

  program
    .command('session')
    .argument('<id>', 'Session ID (full or short 8-char)')
    .option('--full', 'Include full message contents (long output)')
    .description('Show details for a specific chat session')
    .action(async (id: string, opts) => {
      const project = requireProject();
      const client = createClient();
      const fullId = await resolveSessionId(client, project.id, id);
      const session = await client.getSession(fullId);

      const consoleUrl = getConsoleUrl();
      const url = `${consoleUrl}/?project=${project.id.substring(0, 8)}&session=${session.id.substring(0, 8)}`;

      const lines = [
        `Session:    ${session.title || 'Untitled'}`,
        `ID:         ${session.id}`,
        `Project:    ${session.project_name || project.name}`,
      ];
      if (session.user_name) lines.push(`User:       ${session.user_name}`);
      if (session.model) lines.push(`Model:      ${session.model}`);
      if (session.created_at) lines.push(`Created:    ${session.created_at}`);
      if (session.updated_at) lines.push(`Updated:    ${session.updated_at}`);
      const msgCount = session.messages?.length ?? session.message_count ?? 0;
      lines.push(`Messages:   ${msgCount}`);
      if (session.context_notes) {
        lines.push('');
        lines.push('Context notes:');
        const notes = session.context_notes.length > 600
          ? session.context_notes.substring(0, 600) + '\n…(truncated)'
          : session.context_notes;
        lines.push(notes);
      }
      lines.push(`View:       ${url}`);

      if (opts.full && session.messages?.length) {
        lines.push('');
        lines.push('— Conversation —');
        for (const m of session.messages) {
          const ts = (m.created_at || '').substring(11, 19);
          lines.push('');
          lines.push(`[${m.order}] ${m.role.toUpperCase()} ${ts}`);
          lines.push(m.content);
        }
      }

      output(session, lines.join('\n'));
    });
}
