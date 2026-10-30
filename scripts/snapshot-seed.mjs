import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
// Refresh the first-boot seed from the current local PostgreSQL preview.
// --legacy is a one-time migration path for the old JSON state file.
const legacy = process.argv[2] === '--legacy';
const source = legacy ? path.resolve(process.argv[3] || 'data/results.json') : 'local PostgreSQL preview';
const target = path.resolve('seed/initial-state.sql');
const state = legacy ? JSON.parse(fs.readFileSync(source, 'utf8')) : JSON.parse(execFileSync('docker', [
  'compose','-f','compose.yaml','-f','compose.local.yaml','exec','-T','db',
  'psql','-U','perlis','-d','perlis','-At','-c','SELECT state::text FROM competition_state WHERE id = 1',
], { encoding:'utf8', maxBuffer:20 * 1024 * 1024 }).trim());
if (!Number.isInteger(state.version) || !state.bouts || !Array.isArray(state.audit)) throw Error('Invalid competition state');
if (process.argv[2] !== '--include-results' &&
    (Object.keys(state.bouts).length || Object.keys(state.poomsae || {}).length || Object.keys(state.awards || {}).length))
  throw Error('Preview contains recorded results, marks, or awards. Clear them before preparing a clean deployment seed.');
const payload = JSON.stringify(state);
if (payload.includes('$perlis_seed$')) throw Error('Seed delimiter occurs in the state');
const sql = `-- Initial competition state. Applied only when PostgreSQL is empty.\nINSERT INTO competition_state (id, version, state)\nVALUES (1, ${state.version}, $perlis_seed$${payload}$perlis_seed$::jsonb)\nON CONFLICT (id) DO NOTHING;\n`;
fs.mkdirSync(path.dirname(target), { recursive:true });
fs.writeFileSync(target, sql);
console.log(`Prepared PostgreSQL seed from ${source}: ${target}`);
