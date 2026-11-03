// PreToolUse hook: blocks `git commit` when `npm run check` fails in app/.
// Exit code 2 tells Claude Code to block the tool call and show stderr to Claude.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

const command = JSON.parse(raw)?.tool_input?.command ?? '';
// Only real invocations: at the start or after a separator (;, &&, ||, |, newline).
if (!/(^|[;&|\n])\s*git\s+((-[cC]\s+\S+|-\S+)\s+)*commit\b/.test(command)) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const result = spawnSync('npm run check', {
  cwd: join(projectDir, 'app'),
  shell: true,
  encoding: 'utf8',
});

if (result.status !== 0) {
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-40).join('\n');
  process.stderr.write(`Commit bloqueado: \`npm run check\` falló en app/.\n\n${output}\n`);
  process.exit(2);
}
