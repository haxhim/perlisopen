// Run inside the Dokploy perlis application container; uses its configured DB.
import pg from 'pg';
import fs from 'node:fs';
import {parseCsv, buildCompetition, withAddedBouts, addEmptyCategories} from '../server.mjs';
const [ring, ...names] = process.argv.slice(2);
if (!ring || !names.length) {
  console.error('Usage: node scripts/add-empty-categories.mjs A "A Friendly A1" "A Friendly A2" "A Friendly A3"');
  process.exit(1);
}
const pool = new pg.Pool(process.env.DATABASE_URL ? {connectionString:process.env.DATABASE_URL} : {
  host:process.env.PGHOST, port:Number(process.env.PGPORT || 5432), user:process.env.PGUSER,
  password:process.env.PGPASSWORD, database:process.env.PGDATABASE,
});
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const result = await client.query('SELECT state FROM competition_state WHERE id = 1 FOR UPDATE');
  if (!result.rows.length) throw Error('Tournament database is not initialized');
  const state = result.rows[0].state;
  const rows = state.roster?.bouts || parseCsv(fs.readFileSync(new URL('../csv/perlis_day_1.csv',import.meta.url),'utf8'));
  const comp = withAddedBouts(buildCompetition(rows),state);
  const {created, existing} = addEmptyCategories(state,comp,{ring,names});
  if (created.length) {
    state.version++;
    await client.query('UPDATE competition_state SET version = $1, state = $2::jsonb, updated_at = now() WHERE id = 1',[state.version,JSON.stringify(state)]);
  }
  await client.query('COMMIT');
  for (const b of created) console.log(`Created ${b.code} · ${b.category} · 0 players`);
  for (const b of existing) console.log(`Already exists: ${b.code} · ${b.category}`);
} catch (error) {
  await client.query('ROLLBACK'); console.error(error.message); process.exitCode = 1;
} finally { client.release(); await pool.end(); }
