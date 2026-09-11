/**
 * `npm start` at the repo root — launches the Socket.IO server and the Vite dev client
 * together, cross-platform, without adding a runtime dependency (e.g. `concurrently`)
 * just for this. Both processes' stdio is inherited (so you see server + client logs
 * interleaved in one terminal); Ctrl+C (or either process dying) tears both down.
 */
import { spawn } from 'node:child_process';

const children = [];
let shuttingDown = false;

function run(label, args) {
  const child = spawn('npm', args, { stdio: 'inherit', shell: true });
  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.log(`[${label}] exited (code ${code}) — stopping the other process too`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('Starting SyncCanvas (server on :4000, client on :5173)…');
run('server', ['run', 'dev', '-w', 'server']);
run('client', ['run', 'dev', '-w', 'client']);
