import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12))
  throw Error('ADMIN_PASSWORD must be at least 12 characters in production');
const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
const tokenSecret = crypto.createHash('sha256').update(`perlis-session-v1:${process.env.SESSION_SECRET || adminPassword}`).digest();
const tokenLifetimeMs = 12 * 60 * 60 * 1000;
const failedLogins = new Map();
const database = new pg.Pool({
  ...(process.env.DATABASE_URL ? { connectionString:process.env.DATABASE_URL } : {
    host:process.env.PGHOST, port:Number(process.env.PGPORT || 5432),
    user:process.env.PGUSER, password:process.env.PGPASSWORD, database:process.env.PGDATABASE,
  }),
  max:10,
});
database.on('error', err => console.error(`PostgreSQL connection lost: ${err.message}`));
let activeDbClient = null;
let transactionOpen = false;
async function initializeDatabase() {
  if (!process.env.DATABASE_URL && !process.env.PGHOST) throw Error('Set DATABASE_URL or PGHOST to a PostgreSQL server');
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    // CREATE TABLE IF NOT EXISTS can still race on PostgreSQL's catalog when
    // two app instances start against a fresh database at the same time.
    await client.query('SELECT pg_advisory_xact_lock(20261003, 1)');
    await client.query(`CREATE TABLE IF NOT EXISTS competition_state (
      id integer PRIMARY KEY CHECK (id = 1),
      version integer NOT NULL,
      state jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query(fs.readFileSync(path.join(root, 'seed', 'initial-state.sql'), 'utf8'));
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function parseCsv(text) {
  const lines = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted && ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(Boolean)) lines.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); lines.push(row); }
  const [header, ...data] = lines;
  return data.map(cells => Object.fromEntries(header.map((key, i) => [key.replace(/^\uFEFF/, ''), cells[i] || ''])));
}

export function buildCompetition(rows) {
  const athletes = [], map = new Map();
  for (const row of rows) {
    const id = `${row.day}:${row.event}:${row.competitor_no}`;
    if (map.has(id)) throw Error(`Duplicate competitor ${id}`);
    const route = [];
    for (let i = 1; i <= 5; i++) {
      const code = i === 1 ? row.first_bout : row[`bout_${i}`];
      const corner = i === 1 ? row.first_corner : row[`corner_${i}`];
      if (code) route.push({ code, corner, stage: i - 1 });
    }
    const athlete = { id, day: Number(row.day), event: row.event, number: row.competitor_no, name: row.name,
      truncated: row.name_truncated_in_pdf === 'yes', team: row.team, category: row.category, route };
    athletes.push(athlete); map.set(id, athlete);
  }
  const bouts = new Map();
  for (const athlete of athletes) {
    athlete.route.forEach((step, index) => {
      const id = `${athlete.day}:${athlete.event}:${step.code}`;
      if (!bouts.has(id)) bouts.set(id, { id, day: athlete.day, event: athlete.event, code: step.code,
        category: athlete.category, stage: step.stage, entrants: [], childIds: [], directIds: [], corners: {} });
      const bout = bouts.get(id);
      if (bout.category !== athlete.category || bout.stage !== step.stage) throw Error(`Conflicting bout ${id}`);
      if (!bout.entrants.includes(athlete.id)) bout.entrants.push(athlete.id);
      if (index === athlete.route.length - 1) {
        bout.directIds.push(athlete.id);
        bout.corners[athlete.id] = step.corner;
      }
      else {
        const childId = `${athlete.day}:${athlete.event}:${athlete.route[index + 1].code}`;
        if (!bout.childIds.includes(childId)) bout.childIds.push(childId);
        if (bout.corners[childId] && bout.corners[childId] !== step.corner) throw Error(`Conflicting corner in ${id}`);
        bout.corners[childId] = step.corner;
      }
    });
  }
  for (const bout of bouts.values()) {
    if (bout.childIds.length + bout.directIds.length > 2) throw Error(`More than two inputs in ${bout.id}`);
    if (bout.entrants.length > 2 && bout.stage === 4) throw Error(`Invalid first round ${bout.id}`);
    if (bout.childIds.length + bout.directIds.length === 2 &&
        new Set([...bout.childIds, ...bout.directIds].map(id => bout.corners[id])).size !== 2) throw Error(`Invalid corners in ${bout.id}`);
  }
  return { athletes, bouts: [...bouts.values()] };
}

const rows = parseCsv(fs.readFileSync(path.join(root, 'csv', 'perlis_day_1.csv'), 'utf8'));
const poomsaeRows = parseCsv(fs.readFileSync(path.join(root, 'csv', 'perlis_poomsae_pro.csv'), 'utf8'));
const defaultEvent = { name:'Perlis Open Taekwondo Championship 2026', shortName:'PERLIS 2026', dates:['31 October 2026'] };
const allPoomsaeRows = () => (results.roster?.poomsae || poomsaeRows).concat(results.extraPoomsaeEntries || []);
let competition = buildCompetition(rows);
let athletesById, boutsById;
let results = { version: 1, bouts: {}, audit: [], manualBouts:[], extraBouts:[], extraAthletes:[], extraPoomsaeEntries:[], schedule:{}, pins:{}, awards:{}, poomsae:{} };
function loadResults(state) {
  results = state;
  results.manualBouts ||= [];
  results.extraBouts ||= [];
  results.extraAthletes ||= [];
  results.extraPoomsaeEntries ||= [];
  results.schedule ||= {};
  results.pins ||= {};
  results.awards ||= {};
  results.poomsae ||= {};
  results.poomsaeSchedule ||= {};
  results.event ||= { ...defaultEvent };
  competition = buildCompetition(results.roster?.bouts || rows);
  rebuildMaps(activeCompetition());
}
function activeCompetition() { return withAddedBouts(competition, results); }
export function withAddedBouts(competition, state) {
  const bouts = competition.bouts.concat(state.manualBouts || []).map(b => ({ ...b, directIds: [...b.directIds], childIds: [...b.childIds], corners: { ...b.corners } }));
  for (const extra of state.extraBouts || []) {
    const target = bouts.find(b => b.id === extra.targetBoutId);
    if (!target) continue;
    const source = extra.sourceId;
    target.directIds = target.directIds.filter(id => id !== source);
    target.childIds = target.childIds.filter(id => id !== source);
    target.childIds.push(extra.id);
    target.corners[extra.id] = target.corners[source];
    delete target.corners[source];
    bouts.push({ id: extra.id, day: target.day, event: target.event, code: extra.code, category: target.category,
      stage: target.stage + 1, entrants: [], directIds: extra.sourceType === 'direct' ? [source, extra.challengerId] : [extra.challengerId],
      childIds: extra.sourceType === 'child' ? [source] : [], corners: { [source]: extra.sourceCorner, [extra.challengerId]: extra.challengerCorner }, extra: true });
  }
  return { athletes: [...competition.athletes, ...(state.extraAthletes || [])], bouts };
}
// Empty finals reserve both corners until players are added explicitly.
export function addEmptyCategories(state, comp, input) {
  const ring = String(input.ring || '').toUpperCase();
  if (!/^[A-G]$/.test(ring)) throw Object.assign(Error('Choose Kyorugi ring A–E or Poomsae knockout ring F–G'), {status:400});
  const event = 'FG'.includes(ring) ? 'POOMSAE PK' : 'KYORUGI';
  if (!Array.isArray(input.names) || !input.names.length || input.names.length > 30)
    throw Object.assign(Error('Enter 1 to 30 category names'), {status:400});
  const names = input.names.map(value => String(value || '').trim());
  if (names.some(name => !name || name.length > 120)) throw Object.assign(Error('Each category name must be 1–120 characters'), {status:400});
  const created = [], existing = [], seen = [...comp.bouts];
  let next = Math.max(0, ...seen.filter(b => b.day === 1 && b.code[0] === ring).map(b => Number(b.code.match(/^[A-Z](\d+)/)?.[1] || 0)));
  for (const category of names) {
    const match = seen.find(b => b.day === 1 && b.event === event && b.code[0] === ring && b.category.toLowerCase() === category.toLowerCase());
    if (match) { existing.push(match); continue; }
    const code = `${ring}${String(++next).padStart(3,'0')}`;
    const bout = {id:`1:${event}:${code}`, day:1, event, code, category, stage:0, entrants:[], directIds:[], childIds:[], corners:{}, manual:true};
    created.push(bout); seen.push(bout);
  }
  if (created.length) {
    (state.manualBouts ||= []).push(...created);
    (state.audit ||= []).push({action:'EMPTY_CATEGORIES_ADDED', categories:created.map(b => ({id:b.id, code:b.code, category:b.category})), recordedAt:new Date().toISOString()});
  }
  return {created, existing};
}
export function addCategoryPlayer(state, comp, input) {
  const target = comp.bouts.find(b => b.id === input.boutId);
  const saved = state.manualBouts?.find(b => b.id === input.boutId);
  if (!target || !saved) throw Object.assign(Error('Choose an added category'), {status:400});
  if (state.bouts[target.id]) throw Object.assign(Error('This category already has a result'), {status:409});
  const corner = String(input.corner || '');
  if (!['B','R'].includes(corner)) throw Object.assign(Error('Choose Chung or Hong'), {status:400});
  if (target.directIds.length + target.childIds.length >= 2 || Object.values(target.corners).includes(corner))
    throw Object.assign(Error('This corner is already occupied. Refresh and choose an empty corner.'), {status:409});
  const name = String(input.name || '').trim(), team = String(input.team || '').trim();
  if (!name || !team || name.length > 120 || team.length > 120) throw Object.assign(Error('Enter an athlete name and school, up to 120 characters each'), {status:400});
  if (comp.athletes.some(a => a.day === target.day && a.event === target.event && a.category === target.category && a.name.toLowerCase() === name.toLowerCase() && a.team.toLowerCase() === team.toLowerCase()))
    throw Object.assign(Error('This athlete is already in the category'), {status:409});
  const athlete = {id:`extra:${crypto.randomUUID()}`, day:target.day, event:target.event, number:'EXTRA', name, team, category:target.category, route:[]};
  (state.extraAthletes ||= []).push(athlete);
  saved.directIds.push(athlete.id); saved.entrants.push(athlete.id); saved.corners[athlete.id] = corner;
  (state.audit ||= []).push({action:'CATEGORY_PLAYER_ADDED', boutId:target.id, athleteId:athlete.id, corner, recordedAt:new Date().toISOString()});
  return athlete;
}
function scheduleFor(comp) {
  const groups = {};
  for (const b of comp.bouts) {
    const key = `${b.day}:${b.code[0]}`;
    (groups[key] ||= []).push(b.id);
  }
  for (const ids of Object.values(groups)) ids.sort((a,b) => comp.bouts.find(x => x.id === a).code.localeCompare(comp.bouts.find(x => x.id === b).code, undefined, { numeric: true }));
  const assigned = new Set();
  for (const [key, saved] of Object.entries(results.schedule)) {
    groups[key] ||= [];
    groups[key] = saved.filter(id => comp.bouts.some(b => b.id === id));
    groups[key].forEach(id => assigned.add(id));
  }
  for (const [key, ids] of Object.entries(groups)) groups[key] = ids.filter(id => !assigned.has(id) || results.schedule[key]?.includes(id));
  for (const b of comp.bouts) if (!Object.values(groups).some(ids => ids.includes(b.id))) (groups[`${b.day}:${b.code[0]}`] ||= []).push(b.id);
  return groups;
}
function rebuildMaps(comp) { athletesById = new Map(comp.athletes.map(a => [a.id,a])); boutsById = new Map(comp.bouts.map(b => [b.id,b])); }
rebuildMaps(activeCompetition());
async function save() {
  if (!activeDbClient || !transactionOpen) throw Error('Competition change requires a database transaction');
  await activeDbClient.query('UPDATE competition_state SET version = $1, state = $2::jsonb, updated_at = now() WHERE id = 1',
    [results.version, JSON.stringify(results)]);
  await activeDbClient.query('COMMIT');
  transactionOpen = false;
}

export function projectCompetition(competition, stored) {
  const byId = new Map(competition.bouts.map(b => [b.id, b]));
  const cache = new Map();
  function resolve(id, trail = new Set()) {
    if (cache.has(id)) return cache.get(id);
    if (trail.has(id)) throw Error(`Circular bracket ${id}`);
    trail.add(id);
    const bout = byId.get(id);
    const inputs = [...bout.directIds.map(athleteId => ({ athleteId, source: athleteId, corner: bout.corners[athleteId] })),
      ...bout.childIds.map(childId => ({ athleteId: resolve(childId, trail).winnerId, source: childId, corner: bout.corners[childId] }))];
    trail.delete(id);
    const pending = bout.childIds.some(childId => !resolve(childId).winnerId);
    const participants = inputs.map(input => input.athleteId).filter(Boolean);
    const redId = inputs.find(input => input.corner === 'R')?.athleteId || null;
    const blueId = inputs.find(input => input.corner === 'B')?.athleteId || null;
    const saved = stored.bouts[id];
    const autoBye = !bout.manual && !pending && participants.length === 1;
    const validResult = saved && !pending && participants.length === 2 && participants.includes(saved.winnerId);
    const winnerId = autoBye ? participants[0] : validResult ? saved.winnerId : null;
    const state = { ...bout, redId, blueId,
      winnerId, method: autoBye ? 'BYE' : validResult ? saved.method : null,
      status: autoBye ? 'BYE' : validResult ? 'COMPLETE' : !pending && participants.length === 2 ? 'READY' : 'WAITING',
      result: validResult ? saved : null };
    cache.set(id, state);
    return state;
  }
  const projected = competition.bouts.map(b => resolve(b.id));
  return projected.sort((a, b) => a.day - b.day || a.event.localeCompare(b.event) ||
    a.code.localeCompare(b.code, undefined, { numeric: true }));
}

export function buildAwardState(bouts, stored = {}) {
  const groups = new Map();
  for (const bout of bouts) {
    const id = JSON.stringify([bout.day,bout.event,bout.code[0],bout.category]);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(bout);
  }
  const awards = [];
  for (const [id, group] of groups) {
    const final = group.find(b => b.stage === 0);
    if (!final) continue;
    const finished = group.every(b => ['COMPLETE','BYE'].includes(b.status));
    // Every PERLIS discipline is presented and confirmed at the awards desk.
    const autoRing = false;
    const saved = stored[id] || {}, medals = [];
    if (finished && final.winnerId) {
      medals.push({ athleteId:final.winnerId, medal:'Gold' });
      const silverId = final.redId === final.winnerId ? final.blueId : final.redId;
      if (silverId) medals.push({ athleteId:silverId, medal:'Silver' });
      for (const semi of group.filter(b => b.stage === 1 && b.status === 'COMPLETE')) {
        const loserId = semi.redId === semi.winnerId ? semi.blueId : semi.redId;
        if (loserId) medals.push({ athleteId:loserId, medal:'Bronze' });
      }
    }
    const distinct = [...new Map(medals.map(m => [m.athleteId,m])).values()].map(m => ({ ...m,
      state:saved.medalists?.[m.athleteId]?.state === 'DELIVERED_IN_RING' ? 'PENDING' : saved.medalists?.[m.athleteId]?.state || 'PENDING',
      updatedAt:saved.medalists?.[m.athleteId]?.updatedAt || null }));
    const resolved = distinct.length > 0 && distinct.every(m => ['DELIVERED','ABSENT'].includes(m.state));
    const status = !finished ? 'NOT_CALLED' : resolved ? 'DELIVERED' : 'CALLED';
    const finishedAt = group.map(b => b.result?.recordedAt).filter(Boolean).sort().at(-1) || null;
    const deliveredAt = resolved ? saved.deliveredAt || distinct.map(m => m.updatedAt).filter(Boolean).sort().at(-1) || null : null;
    awards.push({ id, day:final.day, event:final.event, category:final.category,
      sourceRing:final.code[0], ring:final.assignedRing || final.code[0], finalCode:final.code,
      status, finished, autoRing, finishedAt, deliveredAt, calledAt:saved.calledAt || (finished ? finishedAt : null),
      callCount:saved.callCount || 0, medals:distinct, totalBouts:group.length });
  }
  return awards.sort((a,b) => a.day-b.day || a.ring.localeCompare(b.ring) || a.category.localeCompare(b.category));
}

export function validatePoomsaePlacements(group, placements) {
  if (!Array.isArray(placements) || placements.length !== group.entrants.length ||
      new Set(placements.map(item => item.code)).size !== group.entrants.length ||
      placements.some(item => !group.entrants.some(e => e.code === item.code)))
    throw Error('Submit a placing or blank for every entrant in the category');
  const updates = placements.map(item => {
    const value = String(item.rank ?? '').trim();
    if (value && !/^[1-4]$/.test(value)) throw Error('Placings must be 1, 2, 3 or 4');
    return [item.code, value ? Number(value) : null];
  });
  const ranks = updates.map(([,rank]) => rank).filter(rank => rank !== null);
  if (new Set(ranks).size !== ranks.length) throw Error('Each placing can be assigned to only one entry');
  if (ranks.some(rank => rank > Math.min(4, group.entrants.length))) throw Error('Placing exceeds the number of entries');
  return updates;
}
export function validatePoomsaeScores(group, scores) {
  if (!Array.isArray(scores) || scores.length !== group.entrants.length || new Set(scores.map(e => e.code)).size !== scores.length || scores.some(e => !group.entrants.some(p => p.code === e.code)))
    throw Error('Enter a score for every participant in this group');
  const values = scores.map(e => {
    if (e.score == null || String(e.score).trim() === '' || !Number.isFinite(Number(e.score)) || Number(e.score) < 0 || Number(e.score) > 10) throw Error('Enter each score from 0 to 10');
    return {code:e.code,score:Number(e.score),rank:e.rank};
  }).sort((a,b) => b.score-a.score);
  const tied = new Set(values.map(e => e.score)).size !== values.length;
  if (tied) {
    const placings = validatePoomsaePlacements(group,values);
    if (placings.some(([,rank]) => rank === null)) throw Error('Equal scores: enter the referee-confirmed placings for this group');
    values.forEach(e => {e.rank = Number(e.rank);});
    const ranked = [...values].sort((a,b) => a.rank-b.rank);
    if (ranked.some((e,i) => i && e.score > ranked[i-1].score)) throw Error('A lower score cannot rank above a higher score');
  } else values.forEach((e,i) => {e.rank = i < 4 ? i+1 : null;});
  return values;
}
export function poomsaeScheduleFor(entries, saved = {}) {
  const valid = new Set(entries.map(e => e.competitor_no)), used = new Set(), schedule = {};
  for (const ring of ['E','F','G']) schedule[ring] = (saved[ring] || []).filter(code => {
    if (!valid.has(code) || used.has(code)) return false;
    used.add(code); return true;
  });
  for (const code of [...valid].sort((a,b) => a.localeCompare(b,undefined,{numeric:true})))
    if (!used.has(code)) { (schedule[code[0]] ||= []).push(code); used.add(code); }
  return schedule;
}
export function transferPoomsae(entries, saved, input) {
  const source = String(input.sourceRing || ''), target = String(input.targetRing || ''), prefix = String(input.codePrefix || source);
  const first = Number(input.from), last = Number(input.to), day = Number(input.day || 1);
  const fail = message => { throw Object.assign(Error(message), {status:400}); };
  if (day !== 1 || !/^[EFG]$/.test(source) || !/^[EFG]$/.test(target) || !/^[EFG]$/.test(prefix) || !Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first) fail('Choose Poomsae rings E–G and a valid entry range');
  const schedule = poomsaeScheduleFor(entries,saved);
  const inRange = code => code[0] === prefix && Number(code.slice(1)) >= first && Number(code.slice(1)) <= last;
  const selected = schedule[source].filter(inRange), selectedSet = new Set(selected);
  const after = String(input.afterBoutId ?? 'END');
  // A repeated terminal command is harmless after the entire range has moved.
  if (!selected.length) {
    const expected = entries.map(e => e.competitor_no).filter(inRange);
    if (expected.length && expected.every(code => schedule[target].includes(code))) return {schedule,count:0,codes:expected,unchanged:true};
    fail('No Poomsae entries in that range on the source ring');
  }
  const categoryKey = e => JSON.stringify([e.competitor_no[0],e.category]);
  const categories = new Set(entries.filter(e => selectedSet.has(e.competitor_no)).map(categoryKey));
  const missing = entries.find(e => categories.has(categoryKey(e)) && !selectedSet.has(e.competitor_no));
  if (missing) fail(`Move the complete category together: ${missing.category}. Include ${missing.competitor_no}.`);
  const afterCode = after === 'END' ? 'END' : after.replace(/^1:POOMSAE PRO:/,'');
  if (afterCode && afterCode !== 'END' && !schedule[target].includes(afterCode)) fail('Insertion point is not on the target Poomsae ring');
  if (selectedSet.has(afterCode)) fail('Choose an insertion point outside the selected range');
  if (afterCode && afterCode !== 'END') {
    const anchor = entries.find(e => e.competitor_no === afterCode), index = schedule[target].indexOf(afterCode);
    if (entries.some(e => categoryKey(e) === categoryKey(anchor) && schedule[target].indexOf(e.competitor_no) > index)) fail('Insert after the last entry of the destination category');
  }
  schedule[source] = schedule[source].filter(code => !selectedSet.has(code));
  const list = schedule[target];
  list.splice(afterCode === 'END' ? list.length : afterCode ? list.indexOf(afterCode) + 1 : 0, 0, ...selected);
  return {schedule,count:selected.length,codes:selected};
}
export function buildPoomsaeState(entries, saved = {}, savedSchedule = {}) {
  const schedule = poomsaeScheduleFor(entries,savedSchedule);
  const positions = new Map(Object.entries(schedule).flatMap(([ring,codes]) => codes.map((code,scheduleOrder) => [code,{assignedRing:ring,scheduleOrder}])));
  const groups = new Map();
  for (const row of entries) {
    const key = JSON.stringify([row.competitor_no[0],row.category]);
    if (!groups.has(key)) groups.set(key, []);
    const result = saved[row.competitor_no];
    groups.get(key).push({
      id:`1:POOMSAE PRO:${row.competitor_no}`, code:row.competitor_no, performanceNo:row.performance_no || null, ...positions.get(row.competitor_no),
      name:row.name, team:row.team, score:result?.score ?? null, rank:result?.rank ?? null, performed:!!(result?.performed || result?.rank != null), performedAt:result?.performedAt || null,
      recordedAt:result?.recordedAt || null,
    });
  }
  return [...groups].map(([key, entrants]) => {
    const [sourceRing,category] = JSON.parse(key);
    const ring = entrants[0].assignedRing;
    const sorted = [...entrants].sort((a,b) => (a.rank ?? 99) - (b.rank ?? 99) || a.code.localeCompare(b.code, undefined, { numeric:true }));
    const finished = Array.from({length:Math.min(4,entrants.length)},(_,i) => i+1).every(rank => entrants.some(e => e.rank === rank));
    return { id:JSON.stringify([1,'POOMSAE PRO',sourceRing,category]), day:1, event:'POOMSAE PRO',
      ring, sourceRing, scheduleOrder:Math.min(...entrants.map(e => e.scheduleOrder)), category, entrants:sorted, finished,
      finishedAt:finished ? entrants.map(e => e.recordedAt).filter(Boolean).sort().at(-1) : null };
  }).sort((a,b) => a.ring.localeCompare(b.ring) || a.scheduleOrder - b.scheduleOrder);
}

export function medalResultsCsv(data) {
  const finished = data.awards.filter(award => award.finished && award.medals.length)
    .sort((a, b) => a.day - b.day || a.event.localeCompare(b.event) || a.category.localeCompare(b.category, undefined, { numeric:true }));
  const kinds = ['Gold', 'Silver', 'Bronze'];
  const counts = Object.fromEntries(kinds.map(kind => [kind, Math.max(kind === 'Bronze' ? 2 : 1,
    ...finished.map(award => award.medals.filter(medal => medal.medal === kind).length))]));
  const athleteById = new Map(data.athletes.map(athlete => [athlete.id, athlete]));
  const headings = ['Category'];
  for (const kind of kinds) for (let index = 1; index <= counts[kind]; index++) {
    const label = kind === 'Bronze' || index > 1 ? `${kind} ${index}` : `${kind} medal`;
    headings.push(`${label} name`, `${label} team`);
  }
  headings.push('Day', 'Event', 'Ring');
  const lines = [headings, ...finished.map(award => {
    const line = [award.category];
    for (const kind of kinds) {
      const medalists = award.medals.filter(medal => medal.medal === kind);
      for (let index = 0; index < counts[kind]; index++) {
        const athlete = athleteById.get(medalists[index]?.athleteId);
        line.push(athlete?.name || '', athlete?.team || '');
      }
    }
    return [...line, award.day, award.event, award.ring];
  })];
  const quote = value => {
    const text = String(value ?? '');
    const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + lines.map(line => line.map(quote).join(',')).join('\r\n');
}

export function buildPoomsaeAwards(groups, stored = {}) {
  return groups.map(group => {
    const saved = stored[group.id] || {};
    const medals = group.finished ? group.entrants.filter(e => e.rank !== null && e.rank <= 4).map(e => ({
      athleteId:e.id, medal:e.rank === 1 ? 'Gold' : e.rank === 2 ? 'Silver' : 'Bronze',
      state:saved.medalists?.[e.id]?.state || 'PENDING',
      updatedAt:saved.medalists?.[e.id]?.updatedAt || null,
    })) : [];
    const resolved = medals.length > 0 && medals.every(m => ['DELIVERED','ABSENT'].includes(m.state));
    const deliveredAt = resolved ? saved.deliveredAt || medals.map(m => m.updatedAt).filter(Boolean).sort().at(-1) || null : null;
    return { id:group.id, day:1, event:'POOMSAE PRO', category:group.category, sourceRing:group.sourceRing || group.ring, ring:group.ring,
      finalCode:group.entrants.at(-1)?.code || '', status:!group.finished ? 'NOT_CALLED' : resolved ? 'DELIVERED' : 'CALLED',
      finished:group.finished, autoRing:false, finishedAt:group.finishedAt, deliveredAt,
      calledAt:saved.calledAt || group.finishedAt, callCount:saved.callCount || 0,
      medals, totalBouts:1 };
  });
}

function json(res, status, value) { const body = JSON.stringify(value); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); }
function error(res, status, message) { json(res, status, { error: message }); }
function token(role = 'admin', ring = '') { const nonce = `${['coordinator','awards'].includes(role) ? results.pins.ALL?.hash.slice(0,12) || '' : ''}${crypto.randomBytes(20).toString('hex')}`; const payload = `${Date.now()}.${role}.${ring || '-'}.${nonce}`; return `${payload}.${crypto.createHmac('sha256', tokenSecret).update(payload).digest('hex')}`; }
function authorization(req) {
  const value = req.headers.authorization?.replace(/^Bearer /, '') || '';
  const parts = value.split('.');
  const issuedAt = Number(parts[0]);
  if (parts.length !== 5 || !Number.isSafeInteger(issuedAt) || issuedAt > Date.now() + 5 * 60 * 1000 || Date.now() - issuedAt > tokenLifetimeMs || !['admin','coordinator','awards'].includes(parts[1])) return null;
  const payload = parts.slice(0,4).join('.');
  const expected = crypto.createHmac('sha256', tokenSecret).update(payload).digest('hex');
  if (parts[4].length !== expected.length || !crypto.timingSafeEqual(Buffer.from(parts[4]), Buffer.from(expected))) return null;
  if (['coordinator','awards'].includes(parts[1]) && (!results.pins.ALL || !parts[3].startsWith(results.pins.ALL.hash.slice(0,12)))) return null;
  return { role: parts[1], ring: parts[2] === '-' ? '' : parts[2] };
}
async function readBody(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 5_000_000) throw Error('Request too large'); }
  return JSON.parse(text || '{}');
}
// Match edits depend on this bout, not activity at unrelated rings.
export function boutRevision(bout, participants = athletesById) {
  const player = id => { const a = participants.get(id); return a ? [a.id,a.name,a.team] : null; };
  return crypto.createHash('sha256').update(JSON.stringify([
    bout.id,bout.code,bout.day,bout.event,bout.category,bout.stage,bout.assignedRing,
    bout.status,bout.blueId,bout.redId,bout.result,player(bout.blueId),player(bout.redId),
  ])).digest('hex');
}
function checkBoutRevision(body, bout) {
  // Older clients retain the conservative global-version check until refreshed.
  return body.boutRevision !== undefined ? body.boutRevision === bout.revision : Number(body.version) === results.version;
}
function publicData() {
  const comp = activeCompetition();
  rebuildMaps(comp);
  const schedule = scheduleFor(comp);
  const positions = new Map(Object.entries(schedule).flatMap(([key,ids]) => ids.map((id,index) => [id,{ assignedRing:key.split(':')[1], scheduleOrder:index }])))
  const bouts = projectCompetition(comp, results).map(b => ({ ...b, ...(positions.get(b.id) || { assignedRing:b.code[0], scheduleOrder:0 }) })).map(b => ({ ...b, revision:boutRevision(b) }));
  const poomsae = buildPoomsaeState(allPoomsaeRows(), results.poomsae, results.poomsaeSchedule);
  const awards = buildAwardState(bouts, results.awards).concat(buildPoomsaeAwards(poomsae, results.awards));
  const poomsaeAthletes = poomsae.flatMap(group => group.entrants.map(e => ({
    id:e.id, day:1, event:'POOMSAE PRO', name:e.name, team:e.team, category:group.category,
  })));
  return { event: results.event, customRoster:!!results.roster,
    version: results.version, athletes:comp.athletes.concat(poomsaeAthletes), bouts, poomsae, awards,
    summary: { athletes:comp.athletes.length + poomsaeAthletes.length, bouts: bouts.length,
      ready: bouts.filter(b => b.status === 'READY').length, complete: bouts.filter(b => b.status === 'COMPLETE').length } };
}
function eventDetails(input) {
  const name = String(input.name || '').trim(), shortName = String(input.shortName || '').trim();
  const dates = Array.isArray(input.dates) ? input.dates.map(value => String(value || '').trim()) : [];
  if (!name || name.length > 120 || !shortName || shortName.length > 40 || dates.length !== 1 || dates.some(value => !value || value.length > 60))
    throw Object.assign(Error('Enter an event name, short name and the Day 1 date'), { status:400 });
  return { name, shortName, dates };
}
function importedRoster(text, kind) {
  if (typeof text !== 'string' || text.length > 3_000_000) throw Error(`Invalid ${kind} CSV`);
  const parsed = parseCsv(text);
  if (!parsed.length || parsed.length > 10000) throw Error(`${kind} CSV must contain 1–10,000 entries`);
  const required = kind === 'bouts' ? ['day','event','team','competitor_no','name','category'] : ['team','competitor_no','name','category'];
  const codes = new Set();
  for (const [index,row] of parsed.entries()) {
    for (const key of required) if (!String(row[key] || '').trim()) throw Error(`${kind} row ${index + 2}: missing ${key}`);
    if (kind === 'bouts') {
      if (Number(row.day) !== 1) throw Error(`Bout row ${index + 2}: day must be 1 for PERLIS`);
      for (let stage = 1; stage <= 5; stage++) {
        const code = stage === 1 ? row.first_bout : row[`bout_${stage}`];
        const corner = stage === 1 ? row.first_corner : row[`corner_${stage}`];
        if (code && (!/^[A-J]\d+[a-zA-Z]*$/.test(code) || !['B','R'].includes(corner)) || !code && corner)
          throw Error(`Bout row ${index + 2}: invalid bout code or corner at stage ${stage}`);
      }
    }
    if (kind === 'poomsae') {
      if (! /^[EFG]\d+[A-Z]*$/.test(row.competitor_no)) throw Error(`Poomsae row ${index + 2}: competitor_no must be an E, F or G code`);
      if (codes.has(row.competitor_no)) throw Error(`Poomsae row ${index + 2}: duplicate competitor_no`);
      codes.add(row.competitor_no);
    }
  }
  return parsed;
}
let cachedPublicVersion = null, cachedPublicBody = null, cachedPublicGzip = null;
function sendPublicState(req, res) {
  if (cachedPublicVersion !== results.version) {
    cachedPublicBody = Buffer.from(JSON.stringify(publicData()));
    cachedPublicGzip = zlib.gzipSync(cachedPublicBody);
    cachedPublicVersion = results.version;
  }
  const compressed = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = compressed ? cachedPublicGzip : cachedPublicBody;
  res.writeHead(200, {
    'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
    'Vary':'Accept-Encoding', 'Content-Length':body.length,
    ...(compressed ? { 'Content-Encoding':'gzip' } : {}),
  });
  res.end(body);
}
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png':'image/png' };
async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/healthz') {
      await database.query('SELECT 1');
      return json(res, 200, { ok:true });
    }
    if (url.pathname.startsWith('/api/')) {
      activeDbClient = await database.connect();
      if (req.method === 'POST' && url.pathname.startsWith('/api/admin/')) {
        await activeDbClient.query('BEGIN');
        transactionOpen = true;
      }
      const state = await activeDbClient.query(`SELECT state FROM competition_state WHERE id = 1${transactionOpen ? ' FOR UPDATE' : ''}`);
      if (!state.rows.length) throw Error('Competition state has not been seeded');
      loadResults(state.rows[0].state);
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return sendPublicState(req, res);
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = await readBody(req);
      const loginKey = `${req.socket.remoteAddress}:${String(body.ring || 'admin').toUpperCase()}`;
      const attempts = (failedLogins.get(loginKey) || []).filter(time => Date.now() - time < 10 * 60 * 1000);
      if (attempts.length >= 10) return error(res, 429, 'Too many attempts. Try again later.');
      const failed = () => { attempts.push(Date.now()); failedLogins.set(loginKey, attempts); return error(res, 401, 'Incorrect PIN or password'); };
      const supplied = Buffer.from(String(body.password || body.pin || ''));
      const expected = Buffer.from(adminPassword);
      if (supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)) { failedLogins.delete(loginKey); return json(res, 200, { token: token(), role: 'admin' }); }
      const ring = String(body.ring || '').toUpperCase();
      const configured = results.pins.ALL;
      if (!/^(?:[A-J]|AWARDS)$/.test(ring) || !/^\d{6}$/.test(String(body.pin || '')) || !configured) return failed();
      const hash = crypto.scryptSync(String(body.pin), configured.salt, 32);
      const saved = Buffer.from(configured.hash, 'hex');
      if (!crypto.timingSafeEqual(hash, saved)) return failed();
      failedLogins.delete(loginKey);
      const loginRole = ring === 'AWARDS' ? 'awards' : 'coordinator';
      return json(res, 200, { token: token(loginRole, ring), role: loginRole, ring });
    }
    if (url.pathname.startsWith('/api/admin/')) {
      const auth = authorization(req);
      if (!auth) return error(res, 401, 'Sign in to manage bouts');
      if (req.method === 'GET' && url.pathname === '/api/admin/session') return json(res, 200, auth);
      if (req.method === 'GET' && url.pathname === '/api/admin/audit') return json(res, 200, results.audit.slice(-100).reverse());
      if (req.method === 'GET' && url.pathname === '/api/admin/tournament-export') {
        if (auth.role !== 'admin') return error(res, 403, 'Admin access required');
        const snapshot = { format:'mtkd-tournament-v1', exportedAt:new Date().toISOString(), event:results.event,
          roster:{ bouts:results.roster?.bouts || rows, poomsae:results.roster?.poomsae || poomsaeRows },
          results:{ bouts:results.bouts, manualBouts:results.manualBouts, extraBouts:results.extraBouts, extraAthletes:results.extraAthletes,
            extraPoomsaeEntries:results.extraPoomsaeEntries, poomsaeSchedule:results.poomsaeSchedule, schedule:results.schedule, awards:results.awards,
            poomsae:results.poomsae, audit:results.audit } };
        res.writeHead(200, { 'Content-Type':'application/json; charset=utf-8', 'Content-Disposition':'attachment; filename="tournament-backup.json"', 'Cache-Control':'no-store' });
        return res.end(JSON.stringify(snapshot, null, 2));
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/tournament-settings') {
        if (auth.role !== 'admin') return error(res, 403, 'Admin access required');
        const body = await readBody(req);
        if (body.version !== results.version) return error(res, 409, 'Competition changed. Refresh and try again.');
        results.event = eventDetails(body.event || {});
        results.audit.push({ action:'EVENT_SETTINGS', recordedAt:new Date().toISOString() });
        results.version++; await save();
        return json(res, 200, { ok:true, version:results.version });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/tournament-reset') {
        if (auth.role !== 'admin') return error(res, 403, 'Admin access required');
        const body = await readBody(req);
        if (body.version !== results.version) return error(res, 409, 'Competition changed. Refresh and try again.');
        if (body.confirm !== `RESET ${results.event.shortName}`) return error(res, 400, `Type RESET ${results.event.shortName} to confirm`);
        if (!['progress','operations'].includes(body.scope)) return error(res, 400, 'Choose a reset scope');
        const previous = { results:Object.keys(results.bouts).length, marks:Object.keys(results.poomsae).length,
          awards:Object.keys(results.awards).length, qualifiers:results.extraBouts.length };
        results.bouts = {};
        results.poomsae = {};
        results.awards = {};
        if (body.scope === 'operations') {
          results.schedule = {};
          results.poomsaeSchedule = {};
          results.manualBouts = [];
          results.extraBouts = [];
          results.extraAthletes = [];
          results.extraPoomsaeEntries = [];
        }
        results.audit.push({ action:'TOURNAMENT_RESET', scope:body.scope, previous, recordedAt:new Date().toISOString() });
        results.version++;
        rebuildMaps(activeCompetition());
        await save();
        return json(res, 200, { ok:true, version:results.version, previous });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/tournament-import') {
        if (auth.role !== 'admin') return error(res, 403, 'Admin access required');
        const body = await readBody(req);
        if (body.version !== results.version) return error(res, 409, 'Competition changed. Refresh and try again.');
        if (body.confirm !== 'CREATE NEW TOURNAMENT') return error(res, 400, 'Type CREATE NEW TOURNAMENT to confirm replacement');
        const event = eventDetails(body.event || {});
        const boutRows = importedRoster(body.boutsCsv, 'bouts');
        const proRows = body.poomsaeCsv?.trim() ? importedRoster(body.poomsaeCsv, 'poomsae') : [];
        const built = buildCompetition(boutRows);
        if (!built.bouts.length && !proRows.length) return error(res, 400, 'Import has no bouts or Poomsae Pro entries');
        const existingPins = results.pins;
        results = { version:results.version + 1, event, roster:{ bouts:boutRows, poomsae:proRows }, bouts:{},
          audit:[{ action:'TOURNAMENT_CREATED', recordedAt:new Date().toISOString(), name:event.name }],
          manualBouts:[], extraBouts:[], extraAthletes:[], extraPoomsaeEntries:[], schedule:{}, pins:existingPins, awards:{}, poomsae:{} };
        competition = built;
        rebuildMaps(activeCompetition());
        await save();
        return json(res, 200, { ok:true, version:results.version, athletes:built.athletes.length, bouts:built.bouts.length });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/pin') {
        if (auth.role !== 'admin') return error(res, 403, 'Admin access required');
        const body = await readBody(req), pin = String(body.pin || '');
        if (!/^\d{6}$/.test(pin)) return error(res, 400, 'Enter a six-digit staff PIN');
        const salt = crypto.randomBytes(16).toString('hex');
        results.pins = { ALL:{ salt, hash: crypto.scryptSync(pin, salt, 32).toString('hex') } };
        results.audit.push({ action:'SHARED_PIN_SET', recordedAt:new Date().toISOString() });
        results.version++; await save();
        return json(res, 200, { ok:true, version:results.version });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/poomsae-scores') {
        if (!['admin','coordinator'].includes(auth.role)) return error(res,403,'Poomsae results access required');
        const body = await readBody(req);
        if (Number(body.version) !== results.version) return error(res,409,'Competition changed. Refresh and try again.');
        const group = buildPoomsaeState(allPoomsaeRows(),results.poomsae,results.poomsaeSchedule).find(g => g.category === body.category && g.ring === body.ring);
        if (!group) return error(res,404,'Poomsae category not found');
        if (auth.role === 'coordinator' && auth.ring !== group.ring) return error(res,403,'Access is limited to your assigned ring');
        let updates;
        try { updates = validatePoomsaeScores(group,body.scores); } catch (err) { return error(res,400,err.message); }
        const recordedAt = new Date().toISOString();
        for (const {code,score,rank} of updates) results.poomsae[code] = {...results.poomsae[code],score,rank,performed:true,performedAt:results.poomsae[code]?.performedAt || recordedAt,recordedAt};
        delete results.awards[group.id];
        results.audit.push({action:'POOMSAE_GROUP_SCORES',category:group.category,scores:updates,recordedAt});
        results.version++; await save();
        return json(res,200,{ok:true,version:results.version});
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/poomsae-placements') {
        if (!['admin','coordinator'].includes(auth.role)) return error(res, 403, 'Poomsae results access required');
        const body = await readBody(req);
        if (Number(body.version) !== results.version) return error(res, 409, 'Competition changed. Refresh and try again.');
        const group = buildPoomsaeState(allPoomsaeRows(), results.poomsae, results.poomsaeSchedule).find(g => g.category === body.category && (!body.ring || g.ring === body.ring));
        if (!group) return error(res, 404, 'Poomsae category not found');
        if (auth.role === 'coordinator' && auth.ring !== group.ring) return error(res, 403, 'Access is limited to your assigned ring');
        let updates;
        try { updates = validatePoomsaePlacements(group, body.placements); }
        catch (err) { return error(res, 400, err.message); }
        if (updates.every(([code,rank]) => (results.poomsae[code]?.rank ?? null) === rank))
          return json(res, 200, { ok:true, unchanged:true, version:results.version });
        const recordedAt = new Date().toISOString();
        for (const [code,rank] of updates) {
          const previous = results.poomsae[code] || {};
          results.poomsae[code] = { ...previous, rank, performed:rank !== null || !!previous.performed, performedAt:previous.performedAt || (rank !== null ? recordedAt : null), recordedAt };
        }
        delete results.awards[group.id];
        results.audit.push({ action:'POOMSAE_PLACEMENTS', category:group.category, placements:updates, recordedAt });
        results.version++; await save();
        return json(res, 200, { ok:true, version:results.version });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/poomsae-performed') {
        if (!['admin','coordinator'].includes(auth.role)) return error(res, 403, 'Poomsae access required');
        const body = await readBody(req), code = String(body.code || '');
        if (Number(body.version) !== results.version) return error(res, 409, 'Competition changed. Refresh and try again.');
        if (typeof body.performed !== 'boolean') return error(res, 400, 'Choose performed or waiting');
        const group = buildPoomsaeState(allPoomsaeRows(), results.poomsae, results.poomsaeSchedule).find(g => g.entrants.some(e => e.code === code));
        if (!group) return error(res, 404, 'Poomsae entry not found');
        if (auth.role === 'coordinator' && auth.ring !== group.ring) return error(res, 403, 'Access is limited to your assigned ring');
        const previous = results.poomsae[code] || {};
        if (!body.performed && previous.rank != null) return error(res, 409, 'Clear the placing before returning this entry to waiting');
        const recordedAt = new Date().toISOString();
        results.poomsae[code] = { ...previous, performed:body.performed, performedAt:body.performed ? recordedAt : null };
        results.audit.push({ action:'POOMSAE_PERFORMED', code, performed:body.performed, recordedAt });
        results.version++; await save();
        return json(res, 200, { ok:true, version:results.version });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/poomsae-undo') {
        if (!['admin','coordinator'].includes(auth.role)) return error(res, 403, 'Poomsae results access required');
        const body = await readBody(req), code = String(body.code || '');
        if (Number(body.version) !== results.version) return error(res, 409, 'Competition changed. Refresh and try again.');
        const group = buildPoomsaeState(allPoomsaeRows(), results.poomsae, results.poomsaeSchedule).find(g => g.entrants.some(e => e.code === code));
        if (!group) return error(res, 404, 'Poomsae entry not found');
        if (auth.role === 'coordinator' && auth.ring !== group.ring) return error(res, 403, 'Access is limited to your assigned ring');
        if (group.entrants.find(e => e.code === code).rank === null) return error(res, 409, 'This placing has already been cleared');
        const previous = results.poomsae[code];
        results.poomsae[code] = { ...previous, rank:null };
        delete results.awards[group.id];
        const recordedAt = new Date().toISOString();
        results.audit.push({ action:'POOMSAE_PLACING_CLEARED', code, category:group.category, previous, recordedAt });
        results.version++; await save();
        return json(res, 200, { ok:true, code, version:results.version });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/poomsae-entries') {
        if (auth.role !== 'admin') return error(res, 403, 'Lead admin access required');
        const body = await readBody(req);
        if (Number(body.version) !== results.version) return error(res, 409, 'Competition changed. Refresh and try again.');
        if (!Array.isArray(body.entries) || body.entries.length < 1 || body.entries.length > 30)
          return error(res, 400, 'Stage 1 to 30 Poomsae Pro entries');
        const existing = allPoomsaeRows(), seen = new Set(existing.map(e => `${e.category.toLowerCase()}|${e.name.toLowerCase()}|${e.team.toLowerCase()}`));
        const staged = [];
        for (const item of body.entries) {
          const category = String(item.category || '').trim(), name = String(item.name || '').trim(), team = String(item.team || '').trim();
          if (!category || !name || !team || category.length > 120 || name.length > 120 || team.length > 120)
            return error(res, 400, 'Enter a category, athlete name and club for every entry');
          const key = `${category.toLowerCase()}|${name.toLowerCase()}|${team.toLowerCase()}`;
          if (seen.has(key)) return error(res, 409, `Duplicate Poomsae Pro entry: ${name}`);
          seen.add(key);
          const existingGroup = buildPoomsaeState(existing, results.poomsae, results.poomsaeSchedule).find(g => g.category === category);
          const assignedRing = existingGroup?.ring || String(item.ring || body.ring || '');
          if (!'EFG'.includes(assignedRing) || assignedRing.length !== 1) return error(res, 400, 'Choose Poomsae ring E, F or G');
          staged.push({ category, name, team, ring:assignedRing, sourceRing:existingGroup?.sourceRing || assignedRing });
        }
        const numbers = Object.fromEntries('EFG'.split('').map(ring => [ring,Math.max(0,...existing.filter(e => e.competitor_no[0] === ring).map(e => Number(e.competitor_no.slice(1))))]));
        const recordedAt = new Date().toISOString(), codes = [];
        results.poomsaeSchedule = poomsaeScheduleFor(existing, results.poomsaeSchedule);
        for (const item of staged) {
          const code = `${item.sourceRing}${String(++numbers[item.sourceRing]).padStart(3,'0')}`;
          codes.push(code);
          results.poomsaeSchedule[item.ring].push(code);
          results.extraPoomsaeEntries.push({ day:'1', event:'POOMSAE PRO', source_pdf:'', source_page:'', team:item.team,
            competitor_no:code, name:item.name, name_truncated_in_pdf:'no', category:item.category });
          delete results.awards[JSON.stringify([1,'POOMSAE PRO',item.sourceRing,item.category])];
        }
        results.audit.push({ action:'POOMSAE_ENTRIES_ADDED', codes, entries:staged, recordedAt });
        results.version++; await save();
        return json(res, 200, { ok:true, count:staged.length, codes, version:results.version });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/award/call') {
        if (!['admin','awards'].includes(auth.role)) return error(res, 403, 'Awards access required');
        const body = await readBody(req);
        const award = publicData().awards.find(a => a.id === body.awardId);
        if (!award) return error(res, 404, 'Category not found');
        if (!award.finished || award.autoRing) return error(res, 409, 'This category is not handled at the podium');
        const record = results.awards[award.id] ||= { medalists:{} };
        record.calledAt = new Date().toISOString();
        record.callCount = (record.callCount || 0) + 1;
        results.audit.push({ action:'AWARD_CALL', awardId:award.id, calledAt:record.calledAt, recordedAt:record.calledAt });
        results.version++; await save();
        return json(res, 200, { ok:true, version:results.version });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/award/medal') {
        if (!['admin','awards'].includes(auth.role)) return error(res, 403, 'Awards access required');
        const body = await readBody(req);
        const award = publicData().awards.find(a => a.id === body.awardId);
        if (!award) return error(res, 404, 'Category not found');
        if (!award.finished || award.autoRing) return error(res, 409, 'This category is not handled at the podium');
        if (!award.medals.some(m => m.athleteId === body.athleteId)) return error(res, 400, 'Athlete is not a medalist in this category');
        const state = String(body.state || '').toUpperCase();
        if (!['PENDING','DELIVERED','ABSENT'].includes(state)) return error(res, 400, 'Invalid medal status');
        const record = results.awards[award.id] ||= { medalists:{} };
        record.medalists ||= {};
        const updatedAt = new Date().toISOString();
        record.medalists[body.athleteId] = { state, updatedAt, note:String(body.note || '').slice(0,200) };
        const everyResolved = award.medals.every(m => ['DELIVERED','ABSENT'].includes(record.medalists[m.athleteId]?.state));
        if (everyResolved && !record.deliveredAt) record.deliveredAt = updatedAt;
        if (!everyResolved) delete record.deliveredAt;
        results.audit.push({ action:'AWARD_MEDAL', awardId:award.id, athleteId:body.athleteId, state, updatedAt, recordedAt:updatedAt });
        results.version++; await save();
        return json(res, 200, { ok:true, version:results.version });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/transfer') {
        if (auth.role !== 'admin') return error(res, 403, 'Admin access required');
        const body = await readBody(req);
        if (Number(body.version) !== results.version) return error(res, 409, 'Schedule changed. Refresh and try again.');
        const day = Number(body.day), source = String(body.sourceRing || '').toUpperCase(), target = String(body.targetRing || '').toUpperCase(), prefix = String(body.codePrefix || source).toUpperCase();
        const first = Number(body.from), last = Number(body.to);
        if (day !== 1 || !/^[A-J]$/.test(source) || !/^[A-J]$/.test(target) || !/^[A-J]$/.test(prefix) || !Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first) return error(res, 400, 'Invalid transfer range');
        if (body.mode === 'scored') {
          const moved = transferPoomsae(allPoomsaeRows(), results.poomsaeSchedule, body);
          if (moved.count) {
            results.poomsaeSchedule = moved.schedule;
            results.audit.push({action:'POOMSAE_TRANSFER', source, target, prefix, from:first, to:last, afterBoutId:body.afterBoutId || 'END', codes:moved.codes, recordedAt:new Date().toISOString()});
            results.version++; await save();
          }
          return json(res, 200, {ok:true,count:moved.count,version:results.version});
        }
        const comp = activeCompetition(), schedule = scheduleFor(comp), sourceKey = `${day}:${source}`, targetKey = `${day}:${target}`;
        const selected = (schedule[sourceKey] || []).filter(id => { const b = comp.bouts.find(x => x.id === id); const number = Number(b?.code.match(/^[A-Z](\d+)/)?.[1]); return b && b.code[0] === prefix && number >= first && number <= last; });
        if (!selected.length) return error(res, 400, 'No bouts in that range on the source ring');
        const afterId = String(body.afterBoutId || '');
        if (afterId && afterId !== 'END' && !(schedule[targetKey] || []).includes(afterId)) return error(res, 400, 'Insertion point is not on the target ring');
        if (selected.includes(afterId)) return error(res, 400, 'Choose an insertion point outside the selected range');
        schedule[sourceKey] = schedule[sourceKey].filter(id => !selected.includes(id));
        if (sourceKey === targetKey) schedule[targetKey] = schedule[sourceKey];
        const targetList = schedule[targetKey] ||= [];
        targetList.splice(afterId === 'END' ? targetList.length : afterId ? targetList.indexOf(afterId) + 1 : 0, 0, ...selected);
        results.schedule = schedule;
        results.audit.push({ action:'TRANSFER', day, source, target, prefix, from:first, to:last, afterBoutId:afterId, count:selected.length, recordedAt:new Date().toISOString() });
        results.version++; await save();
        return json(res, 200, { ok:true, count:selected.length, version:results.version });
      }
      if (req.method === 'POST' && ['/api/admin/categories','/api/admin/category-player'].includes(url.pathname)) {
        if (auth.role !== 'admin') return error(res, 403, 'Lead admin access required');
        const body = await readBody(req);
        if (Number(body.version) !== results.version) return error(res, 409, 'Competition changed. Refresh and try again.');
        const comp = activeCompetition();
        if (url.pathname.endsWith('/categories')) {
          const {created, existing} = addEmptyCategories(results, comp, body);
          if (created.length) { results.version++; await save(); rebuildMaps(activeCompetition()); }
          return json(res, 200, {ok:true, count:created.length, codes:created.map(b => b.code), existing:existing.map(b => b.code), version:results.version});
        }
        const athlete = addCategoryPlayer(results, comp, body);
        results.version++; await save(); rebuildMaps(activeCompetition());
        return json(res, 200, {ok:true, athleteId:athlete.id, version:results.version});
      }
      if (req.method === 'POST' && ['/api/admin/extra-bout','/api/admin/extra-bouts'].includes(url.pathname)) {
        if (auth.role !== 'admin') return error(res, 403, 'Admin access required');
        const body = await readBody(req);
        if (Number(body.version) !== results.version) return error(res, 409, 'Competition changed. Refresh and try again.');
        const entries = url.pathname.endsWith('/extra-bouts') ? body.entries : [body];
        if (!Array.isArray(entries) || !entries.length || entries.length > 30) return error(res, 400, 'Stage 1 to 30 qualifying bouts');
        const comp = activeCompetition(), schedule = scheduleFor(comp), newBouts = [], newAthletes = [], newAudit = [], usedSlots = new Set();
        const usedCodes = new Set(comp.bouts.map(b => `${b.day}:${b.event}:${b.code}`));
        const tailByAnchor = new Map();
        for (const entry of entries) {
          const target = comp.bouts.find(b => b.id === entry.targetBoutId);
          if (!target || !target.directIds.includes(entry.sourceAthleteId)) return error(res, 400, 'Choose an existing athlete slot in each destination bout');
          if (target.manual && target.directIds.length + target.childIds.length < 2) return error(res, 409, 'Fill both category corners before adding qualifiers');
          if (usedSlots.has(`${target.id}:${entry.sourceAthleteId}`)) return error(res, 400, 'The same athlete slot cannot be qualified twice');
          if (results.bouts[target.id]) return error(res, 409, 'Undo the destination result before adding a qualifying bout');
          const name = String(entry.name || '').trim(), team = String(entry.team || '').trim();
          if (!name || !team || name.length > 120 || team.length > 120) return error(res, 400, 'Enter each new athlete and club');
          const ring = String(entry.assignedRing || target.code[0]).toUpperCase(), key = `${target.day}:${ring}`;
          if (!/^[A-J]$/.test(ring)) return error(res, 400, 'Choose a valid assigned ring');
          const afterId = String(entry.afterBoutId || ''), list = schedule[key] ||= [];
          if (afterId && !list.includes(afterId)) return error(res, 400, 'Insertion point is not on the assigned ring');
          const targetPosition = list.indexOf(target.id);
          if (targetPosition >= 0 && afterId && list.indexOf(afterId) >= targetPosition) return error(res, 400, 'Insert each qualifier before its destination match');
          const anchor = comp.bouts.find(b => b.id === afterId) || newBouts.find(b => b.id === afterId) || target;
          const base = `${ring}${String(Number(anchor.code.match(/^[A-Z](\d+)/)?.[1] || 0)).padStart(3,'0')}`;
          let suffixIndex = 0, code;
          do {
            let n = suffixIndex++, suffix = '';
            do { suffix = String.fromCharCode(65 + n % 26) + suffix; n = Math.floor(n / 26) - 1; } while (n >= 0);
            code = base + suffix;
          } while (usedCodes.has(`${target.day}:${target.event}:${code}`));
          usedCodes.add(`${target.day}:${target.event}:${code}`);
          const uuid = crypto.randomUUID(), challengerId = `extra:${uuid}`, id = `${target.day}:${target.event}:extra:${uuid}`;
          const sourceCorner = entry.sourceCorner === 'R' ? 'R' : 'B';
          newAthletes.push({ id:challengerId, day:target.day, event:target.event, number:'EXTRA', name, team, category:target.category, route:[] });
          newBouts.push({ id, code, targetBoutId:target.id, sourceId:entry.sourceAthleteId, sourceType:'direct', sourceCorner, challengerCorner:sourceCorner === 'B' ? 'R' : 'B', challengerId });
          const insertAfter = tailByAnchor.get(`${key}:${afterId}`) || afterId;
          list.splice(insertAfter ? list.indexOf(insertAfter) + 1 : 0, 0, id);
          tailByAnchor.set(`${key}:${afterId}`, id);
          usedSlots.add(`${target.id}:${entry.sourceAthleteId}`);
          newAudit.push({ action:'EXTRA_BOUT', boutId:id, code, targetBoutId:target.id, sourceAthleteId:entry.sourceAthleteId, challengerId, ring, afterBoutId:afterId, recordedAt:new Date().toISOString() });
        }
        results.extraAthletes.push(...newAthletes);
        results.extraBouts.push(...newBouts);
        results.audit.push(...newAudit);
        results.schedule = schedule;
        results.version++; await save(); rebuildMaps(activeCompetition());
        return json(res, 200, { ok:true, count:newBouts.length, codes:newBouts.map(b => b.code), version:results.version });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/result') {
        if (!['admin','coordinator'].includes(auth.role)) return error(res, 403, 'Result access required');
        const body = await readBody(req);
        const bout = boutsById.get(body.boutId);
        if (!bout) return error(res, 404, 'Bout not found');
        const snapshot = publicData();
        const projected = snapshot.bouts.find(b => b.id === bout.id);
        if (auth.role === 'coordinator' && projected.assignedRing !== auth.ring) return error(res, 403, 'This bout is assigned to another ring');
        if (!checkBoutRevision(body, projected)) return error(res, 409, 'This bout changed. Close this form and open it again.');
        if (projected.status !== 'READY') return error(res, 409, 'This bout is not ready');
        if (![projected.redId, projected.blueId].includes(body.winnerId)) return error(res, 400, 'Winner must be in this bout');
        const method = String(body.method || 'PTF').toUpperCase();
        if (!['PTF', 'PTG', 'GDP', 'RSC', 'SUP', 'WDR', 'DSQ', 'PUN', 'DQB', 'POINTS'].includes(method)) return error(res, 400, 'Invalid result method');
        const record = { winnerId: body.winnerId, method, note: String(body.note || '').slice(0, 500), recordedAt: new Date().toISOString() };
        results.bouts[bout.id] = record;
        results.audit.push({ action: 'RESULT', boutId: bout.id, ...record });
        results.version++;
        await save();
        return json(res, 200, { ok: true, version: results.version });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/undo') {
        if (!['admin','coordinator'].includes(auth.role)) return error(res, 403, 'Result access required');
        const body = await readBody(req);
        const bout = boutsById.get(body.boutId);
        if (!bout || !results.bouts[bout.id]) return error(res, 404, 'Recorded result not found');
        const snapshot = publicData();
        if (auth.role === 'coordinator' && snapshot.bouts.find(b => b.id === bout.id)?.assignedRing !== auth.ring) return error(res, 403, 'This bout is assigned to another ring');
        const projected = snapshot.bouts.find(b => b.id === bout.id);
        if (!checkBoutRevision(body, projected)) return error(res, 409, 'This bout changed. Close this form and open it again.');
        const allBouts = activeCompetition().bouts;
        const later = new Set(), pending = [bout.id];
        while (pending.length) {
          const childId = pending.pop();
          for (const item of allBouts.filter(b => b.childIds.includes(childId))) if (!later.has(item.id)) { later.add(item.id); pending.push(item.id); }
        }
        if ([...later].some(id => results.bouts[id])) return error(res, 409, 'Undo later results in this bracket first');
        delete results.bouts[bout.id];
        delete results.awards[JSON.stringify([bout.day, bout.event, bout.code[0], bout.category])];
        results.audit.push({ action: 'UNDO', boutId: bout.id, note: String(body.reason || '').slice(0, 500), recordedAt: new Date().toISOString() });
        results.version++;
        await save();
        return json(res, 200, { ok: true, version: results.version });
      }
      return error(res, 404, 'Not found');
    }
    if (req.method === 'GET' && url.pathname === '/api/export.csv') {
      const auth = authorization(req);
      if (!auth) return error(res, 401, 'Admin sign-in required');
      if (auth.role !== 'admin') return error(res, 403, 'Admin access required');
      const data = publicData();
      const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
      const lines = [['day','event','bout','assigned_ring','schedule_order','category','red','blue','winner','method','status'], ...data.bouts.map(b =>
        [b.day,b.event,b.code,b.assignedRing,b.scheduleOrder,b.category,athletesById.get(b.redId)?.name,athletesById.get(b.blueId)?.name,athletesById.get(b.winnerId)?.name,b.method,b.status])];
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="perlis-results.csv"' });
      return res.end('\uFEFF' + lines.map(line => line.map(quote).join(',')).join('\r\n'));
    }
    if (req.method === 'GET' && url.pathname === '/api/medal-results.csv') {
      const auth = authorization(req);
      if (!auth) return error(res, 401, 'Admin sign-in required');
      if (auth.role !== 'admin') return error(res, 403, 'Admin access required');
      const csv = medalResultsCsv(publicData());
      res.writeHead(200, { 'Content-Type':'text/csv; charset=utf-8',
        'Content-Disposition':'attachment; filename="perlis-medal-results.csv"', 'Cache-Control':'no-store' });
      return res.end(csv);
    }
    if (req.method !== 'GET') return error(res, 404, 'Not found');
    const publicPages = new Set(['/live','/schedule','/brackets','/teams','/results','/awards']);
    const adminPages = new Set(['/admin/bouts','/admin/awards','/admin/transfer','/admin/qualifying','/admin/staff-pins','/admin/poomsae-pro','/admin/tournament','/admin/template-guide']);
    const requested = url.pathname === '/' ? '/index.html' : url.pathname === '/awards/history' ? '/awards-history.html' : url.pathname === '/admin/awards/history' ? '/admin-awards-history.html' : publicPages.has(url.pathname) ? `${url.pathname}.html` :
      url.pathname === '/admin' ? '/admin.html' : adminPages.has(url.pathname) ? `/admin-${url.pathname.split('/').at(-1)}.html` : url.pathname;
    const file = path.resolve(root, 'public', `.${requested}`);
    if (!file.startsWith(path.join(root, 'public') + path.sep)) return error(res, 403, 'Forbidden');
    const content = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': `${mime[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-cache' });
    res.end(content);
  } catch (err) {
    error(res, err.code === 'ENOENT' ? 404 : err.status || 500, err.code === 'ENOENT' ? 'Not found' : err.message);
  } finally {
    if (transactionOpen) {
      await activeDbClient.query('ROLLBACK').catch(() => {});
      transactionOpen = false;
    }
    if (activeDbClient) {
      activeDbClient.release();
      activeDbClient = null;
    }
  }
}

// The shared state object belongs to one request at a time. PostgreSQL row locks
// serialize writes across app instances, while this queue serializes local reads.
let requestQueue = Promise.resolve();
const server = http.createServer((req, res) => {
  const current = requestQueue.then(() => handleRequest(req, res));
  requestQueue = current.catch(err => {
    if (!res.headersSent) error(res, 500, err.message);
  });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  initializeDatabase().then(() => server.listen(port, host, () =>
    console.log(`PERLIS system: http://${host}:${port} | admin password: ${process.env.ADMIN_PASSWORD ? 'set by ADMIN_PASSWORD' : adminPassword}`)
  )).catch(err => { console.error(`Database startup failed: ${err.message}`); process.exitCode = 1; database.end(); });
}
