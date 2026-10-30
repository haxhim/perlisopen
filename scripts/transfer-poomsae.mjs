// Run inside the Dokploy perlis container. Credentials stay in its environment.
import pg from 'pg';
import fs from 'node:fs';
import {parseCsv,transferPoomsae} from '../server.mjs';
const [sourceRing,from,to,targetRing,afterBoutId='END']=process.argv.slice(2);
if(!sourceRing||!from||!to||!targetRing){console.error('Usage: node scripts/transfer-poomsae.mjs G 157 191 F END');process.exit(1);}
const pool=new pg.Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE});
const client=await pool.connect();
try{
 await client.query('BEGIN');
 const result=await client.query('SELECT state FROM competition_state WHERE id=1 FOR UPDATE');
 if(!result.rows.length)throw Error('Tournament database is not initialized');
 const state=result.rows[0].state;
 const entries=(state.roster?.poomsae||parseCsv(fs.readFileSync(new URL('../csv/perlis_poomsae_pro.csv',import.meta.url),'utf8'))).concat(state.extraPoomsaeEntries||[]);
 const input={day:1,sourceRing,codePrefix:sourceRing,from:Number(from),to:Number(to),targetRing,afterBoutId};
 const moved=transferPoomsae(entries,state.poomsaeSchedule,input);
 if(moved.count){
  state.poomsaeSchedule=moved.schedule;
  state.audit.push({action:'POOMSAE_TRANSFER',...input,codes:moved.codes,recordedAt:new Date().toISOString()});
  state.version++;
  await client.query('UPDATE competition_state SET version=$1,state=$2::jsonb,updated_at=now() WHERE id=1',[state.version,JSON.stringify(state)]);
 }
 await client.query('COMMIT');
 console.log(moved.count?`Transferred ${moved.count} Poomsae entries ${moved.codes[0]}–${moved.codes.at(-1)} to Ring ${targetRing}, ${afterBoutId==='END'?'at the end':`after ${afterBoutId}`}.`:'Range is already assigned to the destination; no changes made.');
 console.log(`Ring ${targetRing} last entries: ${moved.schedule[targetRing].slice(-6).join(', ')}`);
}catch(error){await client.query('ROLLBACK');console.error(error.message);process.exitCode=1;}finally{client.release();await pool.end();}
