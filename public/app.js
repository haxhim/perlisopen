import {tallyPresets,ageGroup,trophyTitles,tallyAwardMatches,teamStandings as calculateStandings} from '/standings.js';
const root = document.querySelector('#app');
const isAdminPage = /^\/admin(?:\.html|\/(?:bouts|awards(?:\/history)?|transfer|qualifying|staff-pins|poomsae-pro|tournament|template-guide))?\/?$/.test(location.pathname);
const publicPage = { '/':'live', '/live':'live', '/live.html':'live', '/schedule':'schedule', '/schedule.html':'schedule', '/brackets':'brackets', '/brackets.html':'brackets', '/teams':'teams', '/teams.html':'teams', '/results':'results', '/results.html':'results', '/awards':'awards', '/awards.html':'awards', '/awards/history':'awardsHistory', '/awards-history.html':'awardsHistory' };
const adminRoutes = { '/admin':'dashboard', '/admin.html':'dashboard', '/admin/bouts':'bouts', '/admin/awards':'awards', '/admin/awards/history':'awardsHistory', '/admin/transfer':'transfer', '/admin/qualifying':'qualifying', '/admin/staff-pins':'coordinators', '/admin/poomsae-pro':'poomsae', '/admin/tournament':'tournament', '/admin/template-guide':'templateGuide' };
const publicHref = { live:'/live', schedule:'/schedule', brackets:'/brackets', teams:'/teams', results:'/results', awards:'/awards' };
const adminHref = section => ({ dashboard:'/admin', bouts:'/admin/bouts', awards:'/admin/awards', awardsHistory:'/admin/awards/history', transfer:'/admin/transfer', qualifying:'/admin/qualifying', coordinators:'/admin/staff-pins', poomsae:'/admin/poomsae-pro', tournament:'/admin/tournament', templateGuide:'/admin/template-guide' })[section] || '/admin';
const initialParams = new URLSearchParams(location.search);
const track = { KYORUGI:'Kyorugi', 'POOMSAE PK':'Poomsae knockout', 'POOMSAE PRO':'Poomsae scored' };
const poomsaeRing = value => ['F','G'].includes(value);
const day1Plan = 'ABCDEFG'.split('').map(ring => ({ ring, event:poomsaeRing(ring) ? 'POOMSAE PK' : 'KYORUGI', label:ring === 'G' ? 'Poomsae knockout & scored' : poomsaeRing(ring) ? 'Poomsae knockout' : 'Kyorugi' }));
const activePlan = selectedDay => {
  if (!data?.customRoster) return day1Plan;
  const groups = new Map();
  for (const bout of data.bouts.filter(item => item.day === selectedDay).sort(scheduleSort)) {
    const assigned = assignedRing(bout);
    if (!groups.has(assigned)) groups.set(assigned, { ring:assigned, event:bout.event });
  }
  if (selectedDay === 1) for (const group of data.poomsae) if (!groups.has(group.ring)) groups.set(group.ring, {ring:group.ring,event:'POOMSAE PRO'});
  return [...groups.values()].sort((a,b) => a.ring.localeCompare(b.ring));
};
let data = null, view = publicPage[location.pathname] || 'live', day = 1, event = 'KYORUGI', ring = initialParams.get('ring') || (isAdminPage ? 'ALL' : 'A'), query = '', token = sessionStorage.getItem('perlis-token') || '', role = sessionStorage.getItem('perlis-role') || '', coordinatorRing = sessionStorage.getItem('perlis-ring') || '', notice = '';
if (!isAdminPage && initialParams.has('ring')) event = day1Plan.find(item => item.ring === ring)?.event || event;
let adminStatus = initialParams.get('status') || 'ALL', targetRing = 'B', extraTargetId = '';
let adminSection = adminRoutes[location.pathname] || 'dashboard', adminPage = 0;
let transferMode = 'bouts';
let transferSourceRing = 'A', transferTargetRing = 'B', transferPrefix = 'A', transferStart = null, transferEnd = null, transferAfterId = '', transferQuery = '';
let qualifyingRing = 'ALL', qualifyingCategory = 'ALL', qualifyingQuery = '', qualifyingPage = 0, qualifyingSelectedId = '', qualifyingDraft = [];
let proEntryDraft = [];
let categoryCreateDraft = {ring:'A', names:''}, categoryPlayerDraft = {boutId:'', corner:'B', name:'', team:''};
let teamTeam = 'ALL', teamQuery = '', teamPage = 0;
const resultsDay = '1';
let tallyPreset = 'KYORUGI_SUPER_CADET', tallyGender = 'ALL';
let pdfExportPending = false, pdfExportError = '', pdfLibraryPromise;
let tallyEvent = 'ALL', tallyScope = 'ALL', tallyAge = 'ALL';
let poomsaeQuery = '', poomsaeCategory = '';
const poomsaeDraft = new Map();
const poomsaeScoreDraft = new Map();
let awardQuery = '', awardPublicStatus = 'ALL', awardPublicPage = 0, awardAdminQuery = '', awardAdminStatus = 'ALL', awardAdminRing = 'ALL', awardAdminPage = 0;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const athlete = id => data?.athletes.find(item => item.id === id);
const label = id => athlete(id)?.name || 'Awaiting winner';
const statusText = { READY: 'Ready', COMPLETE: 'Completed', WAITING: 'Waiting', BYE: 'Bye' };
const awardStatusText = { NOT_CALLED:'Not called', CALLED:'Called', DELIVERED:'Delivered', DELIVERED_IN_RING:'Delivered in Ring' };
const medalStateText = { PENDING:'Awaiting medal', DELIVERED:'Medal delivered', ABSENT:'Athlete absent', DELIVERED_IN_RING:'Delivered in Ring' };
const archivedAward = a => ['DELIVERED','DELIVERED_IN_RING'].includes(a.status);
const malaysiaTime = value => value ? new Intl.DateTimeFormat('en-MY',{ timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true }).format(new Date(value)) + ' MYT' : 'Time unavailable';
const stageText = ['Final', 'Semifinal', 'Quarterfinal', 'Round of 16', 'Round of 32'];
const roundName = stage => stageText[stage] || (Number.isInteger(stage) && stage >= 0 && stage < 10 ? `Round of ${2 ** (stage + 1)}` : 'Qualifying');
const roundLabel = bout => bout.extra ? 'Qualifying' : roundName(bout.stage);
const roundBadge = bout => `<span class="round-badge" aria-label="Competition round">${escapeHtml(roundLabel(bout))}</span>`;
const formattedEvent = name => track[name] || name;
// Keep the source class text; Perlis age divisions follow the organizer's rules.
function kyorugiCategoryDetails(b) {
  if (b.event !== 'KYORUGI') return [];
  const match = String(b.category).match(/^(\d+\s*-\s*\d+)\s+(?:JUNIOR|SENIOR)\s+([MF])(.+)$/i);
  if (!match) return [];
  const age = match[1].replace(/\s*-\s*/g,' - ');
  const division = {'9 - 11':'Super Cadet','12 - 14':'Cadet','15 - 17':'Junior'}[age];
  return [division ? `${division} · ${age}` : age,match[2] === 'M' ? 'Male' : 'Female',match[3]];
}
const categoryDetails = b => {
  const details = kyorugiCategoryDetails(b);
  return details.length ? `<div class="category-details" aria-label="Division, gender and weight">${details.map((item,index) => `<span class="category-detail${index === 2 ? ' category-weight' : ''}">${escapeHtml(item)}</span>`).join('')}</div>` : '';
};
const boutNo = code => String(code).replace(/^[A-Z]/, '');
const liveBoutNo = code => String(code).replace(/^([A-Z])(\d+)/, (_, ringLetter, number) => `${ringLetter}${number.padStart(3, '0')}`);
const escapeAttr = escapeHtml;
const boutCsvExample = `day,event,team,competitor_no,name,category,first_bout,first_corner,bout_2,corner_2
1,KYORUGI CLASS B,Team Alpha,1,Ali,9 - 11 JUNIOR MFIN,A003,B,A001,B
1,KYORUGI CLASS B,Team Beta,2,Abu,9 - 11 JUNIOR MFIN,A003,B,A001,R
1,KYORUGI CLASS B,Team Gamma,3,Jojo,9 - 11 JUNIOR MFIN,A003,R,A002,B
1,KYORUGI CLASS B,Team Delta,4,Mira,9 - 11 JUNIOR MFIN,A003,R,A002,R`;
const poomsaeCsvExample = `day,event,team,competitor_no,name,category
1,POOMSAE PRO,Team Alpha,G001,Ali,MALE / 9 - 11 / TAEGEUK 1
1,POOMSAE PRO,Team Beta,G002,Abu,MALE / 9 - 11 / TAEGEUK 1
1,POOMSAE PRO,Team Gamma,G003,Jojo,MALE / 9 - 11 / TAEGEUK 1`;
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Request failed');
  return result;
}
async function refresh(silent = false) {
  try {
    const next = await api('/api/state');
    let sessionExpired = false;
    if (isAdminPage && token) {
      try { const session = await api('/api/admin/session'); role = session.role; coordinatorRing = session.ring || ''; if (role === 'coordinator') { ring = coordinatorRing; if (!['dashboard','bouts',...(poomsaeRing(coordinatorRing) ? ['poomsae'] : [])].includes(adminSection)) adminSection = 'dashboard'; } if (role === 'awards' && !['awards','awardsHistory'].includes(adminSection)) adminSection = 'awards'; }
      catch { token = ''; role = ''; coordinatorRing = ''; ['perlis-token','perlis-role','perlis-ring'].forEach(key => sessionStorage.removeItem(key)); notice = 'Session expired. Sign in again.'; sessionExpired = true; }
    }
    if (silent && !sessionExpired && (next.version === data?.version || document.querySelector('.modal-backdrop'))) return;
    data = next;
    
    render();
  } catch (error) { if (!silent) root.innerHTML = `<div class="error-page"><h1>Could not load the competition</h1><p>${escapeHtml(error.message)}</p><button onclick="location.reload()">Retry</button></div>`; }
}
const assignedRing = b => b.assignedRing || b.code[0];
const scheduleSort = (a,b) => a.day - b.day || assignedRing(a).localeCompare(assignedRing(b)) || a.scheduleOrder - b.scheduleOrder;
const filtered = () => data.bouts.filter(b => b.day === day && (isAdminPage || event === 'ALL' || b.event === event) && (ring === 'ALL' || assignedRing(b) === ring) &&
  (!query || `${b.code} ${b.category} ${b.event} ${label(b.redId)} ${label(b.blueId)}`.toLowerCase().includes(query.toLowerCase())));
const cornerName = corner => corner === 'B' ? 'Chung' : 'Hong';
const person = (id, corner, winnerId) => `<div class="person ${winnerId === id ? 'winner' : ''}"><span class="corner ${corner.toLowerCase()}">${cornerName(corner)}</span><div><strong>${escapeHtml(label(id))}</strong><small>${id ? escapeHtml(athlete(id)?.team) : 'To be determined'}</small></div>${winnerId === id ? '<span class="winner-mark">Winner</span>' : ''}</div>`;
const upcomingRow = b => `<div class="upcoming-row"><strong>${escapeHtml(liveBoutNo(b.code))}</strong><span><i class="corner b">Chung</i><b>${escapeHtml(label(b.blueId))}</b></span><span><i class="corner r">Hong</i><b>${escapeHtml(label(b.redId))}</b></span><small>${statusText[b.status]}</small></div>`;
function card(b, actions = false, current = false, upcoming = []) {
  return `<article class="bout-card ${b.status.toLowerCase()} ${current ? 'live-current' : ''}"><header><div><span class="bout-code">${current || isAdminPage ? '' : 'Bout '}${escapeHtml(current ? liveBoutNo(b.code) : isAdminPage ? b.code : boutNo(b.code))}</span><span class="event-tag">${escapeHtml(formattedEvent(b.event))}</span></div><span class="status ${current ? 'current' : b.status.toLowerCase()}">${current ? 'Current' : statusText[b.status]}</span></header>
    <div class="bout-meta">Assigned ring ${escapeHtml(assignedRing(b))} <span>·</span> ${escapeHtml(b.category)} <span>·</span> ${roundBadge(b)}</div>${categoryDetails(b)}
    <div class="contestants">${person(b.blueId, 'B', b.winnerId)}${person(b.redId, 'R', b.winnerId)}</div>
    ${current ? `<div class="upcoming"><div class="upcoming-title">Upcoming on Ring ${escapeHtml(assignedRing(b))}</div>${upcoming.length ? upcoming.map(upcomingRow).join('') : '<div class="upcoming-empty">No further bouts scheduled</div>'}</div>` : ''}
    ${b.method ? `<div class="bout-footer">${b.method === 'BYE' ? 'Automatic advance' : `Result: ${escapeHtml(b.method)}`}</div>` : ''}
    ${actions && b.status === 'READY' ? `<button class="primary record" data-bout="${escapeAttr(b.id)}">Record winner</button>` : ''}
    ${actions && b.status === 'COMPLETE' ? `<button class="text-button undo" data-bout="${escapeAttr(b.id)}">Undo result</button>` : ''}</article>`;
}
function tabs() { return `<nav class="tabs" aria-label="Main navigation">${[['live','Live'],['schedule','Schedule'],['brackets','Brackets'],['teams','Teams'],['results','Results'],['awards','Awards']].map(([id,name]) => `<a class="tab ${view === id ? 'active' : ''}" href="${publicHref[id]}?day=${day}" ${view === id ? 'aria-current="page"' : ''}>${name}</a>`).join('')}</nav>`; }
function filters(showSearch = true) {
  return `<div class="filters"><span class="day-label">Day 1</span>
  ${showSearch ? `<label class="filter-search">Search<input id="search" placeholder="Bout, category or athlete" value="${escapeAttr(query)}"></label>` : ''}</div>`;
}
function ringPlan() {
  const plan = activePlan(day);
  return `<section class="ring-plan" aria-label="Day ${day} ring assignments"><div class="ring-plan-title"><p class="eyebrow">Day ${day} layout</p><h2>Choose a ring</h2></div><div class="ring-plan-grid">${plan.map(item => `<button class="ring-plan-item ${ring === item.ring ? 'selected' : ''}" data-plan-ring="${item.ring}" aria-pressed="${ring === item.ring}"><strong>${item.ring}</strong><span>${escapeHtml(item.label || formattedEvent(item.event))}</span>${item.note ? `<small>${escapeHtml(item.note)}</small>` : ''}</button>`).join('')}</div></section>`;
}
const emptyMessage = () => 'No bouts match this selection.';
function overview(allRings = false, currentCount = null) {
  if (!allRings && day === 1 && data.poomsae.some(g => g.ring === ring) && !data.bouts.some(b => assignedRing(b) === ring)) {
    const groups = data.poomsae.filter(g => g.ring === ring), entries = groups.flatMap(g => g.entrants);
    return `<div class="metrics"><div><span>Poomsae categories</span><strong>${groups.length}</strong></div><div><span>Entries</span><strong>${entries.length}</strong></div><div><span>Performed</span><strong>${entries.filter(e => e.performed).length}</strong></div><div><span>Categories finished</span><strong>${groups.filter(g => g.finished).length}</strong></div></div>`;
  }
  const dayBouts = data.bouts.filter(b => b.day === day && (allRings || ((event === 'ALL' || b.event === event) && (ring === 'ALL' || assignedRing(b) === ring))));
  return `<div class="metrics"><div><span>Scheduled bouts</span><strong>${dayBouts.length}</strong></div><div><span>${currentCount === null ? 'Ready now' : 'Current ring bouts'}</span><strong>${currentCount ?? dayBouts.filter(b => b.status === 'READY').length}</strong></div><div><span>Completed</span><strong>${dayBouts.filter(b => b.status === 'COMPLETE').length}</strong></div><div><span>Automatic byes</span><strong>${dayBouts.filter(b => b.status === 'BYE').length}</strong></div></div>`;
}
function live() {
  const ready = data.bouts.filter(b => b.day === day && b.status === 'READY').sort(scheduleSort);
  const byRing = new Map();
  for (const bout of ready) if (!byRing.has(assignedRing(bout))) byRing.set(assignedRing(bout), bout);
  const scoredPendingRings = new Set(data.poomsae.filter(g => g.entrants.some(e => !e.performed)).map(g => g.ring));
  const current = [...byRing.values()].filter(b => !scoredPendingRings.has(assignedRing(b))).filter(b => !query || `${b.code} ${liveBoutNo(b.code)} ${b.category} ${b.event} ${label(b.redId)} ${label(b.blueId)} ${athlete(b.redId)?.team || ''} ${athlete(b.blueId)?.team || ''}`.toLowerCase().includes(query.toLowerCase()));
  const nextThree = b => data.bouts.filter(other => other.day === day && assignedRing(other) === assignedRing(b) && other.scheduleOrder > b.scheduleOrder && !['COMPLETE', 'BYE'].includes(other.status))
    .sort(scheduleSort).slice(0, 3);
  const cards = current.map(b => ({ ring:assignedRing(b), html:card(b, false, true, nextThree(b)) }));
  for (const proRing of ['E','F','G']) {
    const entries = data.poomsae.filter(g => g.ring === proRing).flatMap(g => g.entrants.map(e => ({...e,category:g.category})));
    const performances = new Map();
    for (const entry of entries.sort((a,b) => a.scheduleOrder-b.scheduleOrder)) {
      const key = entry.performanceNo || entry.category;
      if (!performances.has(key)) performances.set(key,[]);
      performances.get(key).push(entry);
    }
    const pending = [...performances.values()].filter(group => group.some(e => !e.performed));
    const group = pending[0];
    if (!group || query && !group.some(e => `${e.performanceNo} ${e.name} ${e.team} ${e.category}`.toLowerCase().includes(query.toLowerCase()))) continue;
    const code = group[0].performanceNo || group[0].code;
    cards.push({ring:proRing,html:`<article class="bout-card live-current pro-live"><header><div><span class="bout-code">${escapeHtml(code)}</span><span class="event-tag">Poomsae · group scoring</span></div><span class="status current">Current group</span></header><div class="bout-meta">Ring ${proRing} · ${escapeHtml(group[0].category)} · Perform together</div><div class="pro-live-current">${group.map(e => `<div><strong>${escapeHtml(e.name)}</strong><small>${escapeHtml(e.team)}</small></div>`).join('')}</div><div class="upcoming"><div class="upcoming-title">Next performance groups</div>${pending.slice(1,4).map(g => `<div class="upcoming-row"><strong>${escapeHtml(g[0].performanceNo || g[0].code)}</strong><span>${escapeHtml(g[0].category)}</span></div>`).join('') || '<div class="upcoming-empty">Next: knockout bouts from G033</div>'}</div><a class="pro-live-link" href="/schedule?ring=${proRing}">View Ring ${proRing} ↗</a></article>`});
  }
  cards.sort((a,b) => a.ring.localeCompare(b.ring));
  return `${filters()}${overview(true, cards.length)}<section class="section-heading"><div><p class="eyebrow">On now</p><h2>Current bout / performance by ring</h2></div><span>${new Set(cards.map(c => c.ring)).size} rings · ${cards.length} queues shown</span></section>
    ${cards.length ? `<div class="card-grid">${cards.map(item => item.html).join('')}</div>` : `<div class="empty">No current bouts match this day and search.</div>`}`;
}
function poomsaePublicView(mode, standalone = true) {
  const groups = data.poomsae.filter(g => g.ring === ring).filter(g => !query || `${g.category} ${g.entrants.map(e => `${e.name} ${e.team}`).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const preparation = new Map();
  if (mode === 'schedule') {
    const pending = data.poomsae.filter(g => g.ring === ring && !g.finished).flatMap(g => g.entrants).filter(e => !e.performed).sort((a,b) => (a.scheduleOrder ?? 0) - (b.scheduleOrder ?? 0) || a.code.localeCompare(b.code, undefined, { numeric:true }));
    const performances = [...new Set(pending.map(e => e.performanceNo || e.code))];
    for (const entry of pending) {
      const index = performances.indexOf(entry.performanceNo || entry.code);
      if (index === 0) preparation.set(entry.code,'current');
      else if (index <= 5) preparation.set(entry.code,'prepare');
    }
  }
  return `${standalone ? ringPlan()+filters()+overview() : ''}<div class="section-heading"><div><p class="eyebrow">Ring ${escapeHtml(ring)} · G001–G032 · scored final placings</p><h2>${mode === 'results' ? 'Poomsae results' : 'Poomsae placings'}</h2></div><span>${groups.length} categories</span></div>
  <div class="pro-public-list">${groups.map(g => `<section class="pro-public-card"><header><div><small>Ring ${escapeHtml(g.ring)} · Poomsae</small><h3>${escapeHtml(g.category)}</h3></div><span class="status ${g.finished ? 'complete' : 'waiting'}">${g.finished ? 'Finished' : 'Awaiting placings'}</span></header><div class="pro-public-head"><span>Entry / athlete</span><span>Team</span><span>Score / Placing</span></div>${g.entrants.map(e => `<div class="pro-public-row"><span><b>${escapeHtml(e.performanceNo || e.code)}</b><strong>${escapeHtml(e.name)}</strong>${preparation.has(e.code) ? `<small class="pro-schedule-callout ${preparation.get(e.code)}">${preparation.get(e.code) === 'current' ? 'Current' : 'Please be prepared at your ring'}</small>` : ''}</span><span>${escapeHtml(e.team)}</span><strong>${e.score != null ? escapeHtml(e.score.toFixed(3)) + ' · ' : ''}${e.rank ?? (e.performed ? 'Performed · placing pending' : 'Waiting')}</strong></div>`).join('')}</section>`).join('') || '<div class="empty">No Poomsae categories match this search.</div>'}</div>`;
}
const schedulePlayer = (id, corner) => `<span><i class="corner ${corner.toLowerCase()}">${cornerName(corner)}</i><span class="schedule-athlete"><b>${escapeHtml(label(id))}</b><small>${escapeHtml(id ? athlete(id)?.team || 'Team not listed' : 'To be determined')}</small></span></span>`;
function preparationStatus() {
  const labels = new Map(), byRing = new Map();
  for (const bout of data.bouts.filter(b => b.day === day && !['COMPLETE','BYE'].includes(b.status))) {
    const key = assignedRing(bout);
    if (!byRing.has(key)) byRing.set(key, []);
    byRing.get(key).push(bout);
  }
  for (const bouts of byRing.values()) {
    bouts.sort(scheduleSort);
    const currentIndex = bouts.findIndex(b => b.status === 'READY');
    if (currentIndex < 0) continue;
    labels.set(bouts[currentIndex].id, 'current');
    for (const bout of bouts.slice(currentIndex + 1,currentIndex + 6)) labels.set(bout.id, 'prepare');
  }
  return labels;
}
const scheduleRow = (b, callout) => `<div class="schedule-row bout-schedule-row"><span class="list-code">${escapeHtml(liveBoutNo(b.code))}</span><div class="schedule-content"><strong>${escapeHtml(b.category)}</strong>${categoryDetails(b)}<small>Assigned ring ${escapeHtml(assignedRing(b))} · ${formattedEvent(b.event)} · ${roundBadge(b)}</small><div class="schedule-players">${schedulePlayer(b.blueId, 'B')}${schedulePlayer(b.redId, 'R')}</div></div><span class="status ${callout || b.status.toLowerCase()}">${callout === 'current' ? 'Current' : callout === 'prepare' ? 'Please be prepared at your ring' : statusText[b.status]}</span></div>`;
function schedule() {
  const selected = filtered().sort(scheduleSort);
  const labels = preparationStatus();
  return `${ringPlan()}${filters()}${data.poomsae.some(g => g.ring === ring) ? poomsaePublicView('schedule',false) : ''}${overview()}<div class="section-heading"><div><p class="eyebrow">Competition order</p><h2>Ring ${ring} bouts</h2></div><span>${selected.length} shown</span></div>
    ${selected.length ? `<div class="schedule-list">${selected.map(b => scheduleRow(b, labels.get(b.id))).join('')}</div>` : `<div class="empty">${emptyMessage()}</div>`}`;
}
function bracketDiagram(group) {
  const nodes = new Map(group.map(b => [b.id, b]));
  const roots = group.filter(b => b.stage === 0);
  const positions = new Map();
  const byeSlots = [];
  const maxStage = Math.max(...group.map(b => b.stage));
  let nextLeaf = 0;
  function place(b) {
    if (positions.has(b.id)) return positions.get(b.id);
    const children = b.childIds.map(id => nodes.get(id)).filter(Boolean).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    let y;
    if (!children.length && b.directIds.length === 2 && b.stage < maxStage) {
      const values = [...b.directIds].sort((a, c) => (b.corners[a] === 'B' ? 0 : 1) - (b.corners[c] === 'B' ? 0 : 1)).map(athleteId => {
        const leaf = nextLeaf++;
        byeSlots.push({ parent: b, athleteId, y: leaf });
        return leaf;
      });
      y = values.reduce((a, v) => a + v, 0) / values.length;
    } else if (!children.length) y = nextLeaf++;
    else {
      const values = children.map(place);
      for (const athleteId of b.directIds) {
        const leaf = nextLeaf++;
        values.push(leaf);
        if (b.stage < maxStage) byeSlots.push({ parent: b, athleteId, y: leaf });
      }
      y = values.reduce((a, v) => a + v, 0) / values.length;
    }
    positions.set(b.id, y);
    return y;
  }
  roots.forEach(place);
  group.filter(b => !positions.has(b.id)).forEach(place);
  const columnWidth = 280, gap = 40, rowHeight = 130, cardHeight = 102;
  const width = (maxStage + 1) * columnWidth + maxStage * gap;
  const height = Math.max(190, nextLeaf * rowHeight);
  const x = stage => (maxStage - stage) * (columnWidth + gap);
  const cy = b => (positions.get(b.id) + .5) * rowHeight;
  const lines = group.flatMap(b => b.childIds.map(id => {
    const child = nodes.get(id);
    if (!child) return '';
    const x1 = x(child.stage) + columnWidth - 10, x2 = x(b.stage) + 10, y1 = cy(child), y2 = cy(b), mid = (x1 + x2) / 2;
    return `<path d="M ${x1} ${y1} H ${mid} V ${y2} H ${x2}" />`;
  })).join('') + byeSlots.map(slot => {
    const x1 = x(slot.parent.stage + 1) + columnWidth - 10, x2 = x(slot.parent.stage) + 10;
    const y1 = (slot.y + .5) * rowHeight, y2 = cy(slot.parent), mid = (x1 + x2) / 2;
    return `<path d="M ${x1} ${y1} H ${mid} V ${y2} H ${x2}" />`;
  }).join('');
  const headings = Array.from({ length: maxStage + 1 }, (_, index) => {
    const stage = maxStage - index;
    return `<div class="bracket-round-heading" style="left:${x(stage)}px">${escapeHtml(group.filter(b => b.stage === stage).every(b => b.extra) ? 'Qualifying' : roundName(stage))}</div>`;
  }).join('');
  const byePerson = corner => `<div class="person bye-entrant"><span class="corner ${corner.toLowerCase()}">${cornerName(corner)}</span><div><strong>BYE</strong><small>Empty slot</small></div></div>`;
  const cards = group.map(b => `<div class="bracket-match ${b.status.toLowerCase()}" style="left:${x(b.stage)}px;top:${cy(b) - cardHeight / 2}px"><div class="bracket-match-head"><strong>${escapeHtml(b.code)}</strong>${roundBadge(b)}<small>${statusText[b.status]}</small></div><div class="bracket-match-players">${b.blueId ? person(b.blueId, 'B', b.winnerId) : b.status === 'BYE' ? byePerson('B') : person(null, 'B', b.winnerId)}${b.redId ? person(b.redId, 'R', b.winnerId) : b.status === 'BYE' ? byePerson('R') : person(null, 'R', b.winnerId)}</div></div>`).join('') + byeSlots.map(slot => {
    const corner = slot.parent.corners[slot.athleteId];
    return `<div class="bracket-match bye-slot" style="left:${x(slot.parent.stage + 1)}px;top:${(slot.y + .5) * rowHeight - cardHeight / 2}px"><div class="bracket-match-head"><strong>BYE</strong><small>Automatic advance</small></div><div class="bracket-match-players">${corner === 'B' ? person(slot.athleteId, 'B', slot.athleteId) : byePerson('B')}${corner === 'R' ? person(slot.athleteId, 'R', slot.athleteId) : byePerson('R')}</div></div>`;
  }).join('');
  return `<div class="bracket-tools"><span>Drag to explore · pinch or use controls to zoom</span><div><button type="button" data-bracket-action="out" aria-label="Zoom out bracket">−</button><button type="button" data-bracket-action="fit">Fit</button><button type="button" data-bracket-action="in" aria-label="Zoom in bracket">+</button></div></div><div class="bracket-scroll" data-bracket-viewport><div class="bracket-zoom-frame"><div class="bracket-canvas" style="width:${width}px;height:${height + 48}px">${headings}<svg class="bracket-lines" width="${width}" height="${height}" style="top:48px">${lines}</svg><div class="bracket-nodes" style="top:48px">${cards}</div></div></div></div>`;
}
function initBracketZoom() {
  document.querySelectorAll('[data-bracket-viewport]').forEach(viewport => {
    const frame = viewport.querySelector('.bracket-zoom-frame'), canvas = viewport.querySelector('.bracket-canvas');
    const tools = viewport.previousElementSibling;
    const width = parseFloat(canvas.style.width), height = parseFloat(canvas.style.height);
    let scale = 1, fitted = true, pinchDistance = 0, pinchScale = 1;
    const fitScale = () => Math.min(1, Math.max(.2, (viewport.clientWidth - 24) / width));
    const apply = (next, point) => {
      const old = scale;
      scale = Math.min(2, Math.max(.2, next));
      frame.style.width = `${width * scale}px`;
      frame.style.height = `${height * scale}px`;
      canvas.style.transform = `scale(${scale})`;
      if (point) {
        const rect = viewport.getBoundingClientRect(), x = point.x - rect.left, y = point.y - rect.top;
        viewport.scrollLeft = (viewport.scrollLeft + x) * scale / old - x;
        viewport.scrollTop = (viewport.scrollTop + y) * scale / old - y;
      }
    };
    const fit = () => { fitted = true; apply(fitScale()); viewport.scrollTo(0, 0); };
    tools.querySelectorAll('[data-bracket-action]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.bracketAction === 'fit') return fit();
      fitted = false;
      apply(scale * (button.dataset.bracketAction === 'in' ? 1.3 : 1 / 1.3), { x:viewport.getBoundingClientRect().left + viewport.clientWidth / 2, y:viewport.getBoundingClientRect().top + Math.min(viewport.clientHeight, 300) / 2 });
    }));
    const distance = touches => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    viewport.addEventListener('touchstart', e => { if (e.touches.length === 2) { pinchDistance = distance(e.touches); pinchScale = scale; } }, { passive:true });
    viewport.addEventListener('touchmove', e => { if (e.touches.length !== 2 || !pinchDistance) return; e.preventDefault(); fitted = false; apply(pinchScale * distance(e.touches) / pinchDistance, { x:(e.touches[0].clientX + e.touches[1].clientX) / 2, y:(e.touches[0].clientY + e.touches[1].clientY) / 2 }); }, { passive:false });
    viewport.addEventListener('touchend', e => { if (e.touches.length < 2) pinchDistance = 0; });
    let drag = null;
    viewport.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button === 0) { drag = { x:e.clientX, y:e.clientY, left:viewport.scrollLeft, top:viewport.scrollTop }; viewport.setPointerCapture(e.pointerId); viewport.classList.add('dragging'); } });
    viewport.addEventListener('pointermove', e => { if (drag) { viewport.scrollLeft = drag.left - (e.clientX - drag.x); viewport.scrollTop = drag.top - (e.clientY - drag.y); } });
    const endDrag = () => { drag = null; viewport.classList.remove('dragging'); };
    viewport.addEventListener('pointerup', endDrag); viewport.addEventListener('pointercancel', endDrag);
    new ResizeObserver(() => { if (fitted) fit(); }).observe(viewport);
    fit();
  });
}
function brackets() {
  const selected = filtered();
  const categories = [...new Set(selected.map(b => `${b.code[0]}|${b.event}|${b.category}`))];
  return `${ringPlan()}${filters()}${data.poomsae.some(g => g.ring === ring) ? poomsaePublicView('brackets',false) : ''}<div class="section-heading"><div><p class="eyebrow">Competition paths</p><h2>Brackets</h2></div><span>${categories.length} categories</span></div>
    ${categories.length ? `<div class="bracket-list">${categories.map(key => { const [bracketRing, evt, cat] = key.split('|'); const group = data.bouts.filter(b => b.day === day && b.event === evt && b.category === cat && b.code[0] === bracketRing); return `<section class="bracket-panel"><header><div><small>Ring ${escapeHtml(bracketRing)} · ${formattedEvent(evt)}</small><h3>${escapeHtml(cat)}</h3>${categoryDetails(group[0])}</div><span>${group.length} bouts</span></header>${bracketDiagram(group)}</section>`; }).join('')}</div>` : `<div class="empty">${emptyMessage()}</div>`}`;
}
function teams() {
  const teams = [...new Set(data.athletes.filter(a => a.day === day && a.team).map(a => a.team))].sort((a,b) => a.localeCompare(b));
  const search = teamQuery.trim().toLocaleLowerCase();
  const athleteMatches = a => (teamTeam === 'ALL' || a.team === teamTeam) && (!search || a.name.toLocaleLowerCase().includes(search));
  const selected = [];
  if (teamTeam !== 'ALL' || search) {
    const groups = new Map();
    for (const bout of data.bouts.filter(b => b.day === day)) {
      const key = `${bout.code[0]}|${bout.event}|${bout.category}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(bout);
    }
    for (const [key, bouts] of groups) {
      const entrants = [...new Set(bouts.flatMap(b => [...(b.directIds || []), b.blueId, b.redId].filter(Boolean)))].map(athlete).filter(Boolean);
      const matching = entrants.filter(athleteMatches);
      if (matching.length) selected.push({ type:'bracket', key, bouts, matching, ring:bouts[0].code[0], event:bouts[0].event, category:bouts[0].category });
    }
    if (day === 1) for (const group of data.poomsae) {
      const matching = group.entrants.filter(athleteMatches);
      if (matching.length) selected.push({ type:'poomsae', key:`${group.ring}|POOMSAE PRO|${group.category}`, group, matching, ring:group.ring, event:'POOMSAE PRO', category:group.category });
    }
    selected.sort((a,b) => a.ring.localeCompare(b.ring) || a.category.localeCompare(b.category, undefined, { numeric:true }));
  }
  const pageSize = 6, pages = Math.max(1, Math.ceil(selected.length / pageSize));
  teamPage = Math.min(teamPage, pages - 1);
  const shown = selected.slice(teamPage * pageSize, (teamPage + 1) * pageSize);
  const matchingAthletes = new Set(selected.flatMap(item => item.matching.map(a => `${a.team.toLocaleLowerCase()}|${a.name.toLocaleLowerCase()}`))).size;
  return `${filters(false)}<section class="team-finder"><div><p class="eyebrow">Team pathways</p><h2>Find your team's brackets</h2><p>Choose a team or search a player to see every category they entered.</p></div><div class="team-finder-fields"><label>Team<select id="team-team"><option value="ALL">All teams</option>${teams.map(team => `<option value="${escapeAttr(team)}" ${teamTeam === team ? 'selected' : ''}>${escapeHtml(team)}</option>`).join('')}</select></label><label>Search player by name<input id="team-player-search" type="search" placeholder="Enter player name" value="${escapeAttr(teamQuery)}" autocomplete="off"></label></div></section>
  <div class="section-heading team-results-heading"><div><p class="eyebrow">Day ${day} · team directory</p><h2>Competition paths</h2></div><span>${selected.length} ${selected.length === 1 ? 'category' : 'categories'} · ${matchingAthletes} ${matchingAthletes === 1 ? 'player' : 'players'}</span></div>
  ${shown.length ? `<div class="bracket-list team-bracket-list">${shown.map(item => `<section class="bracket-panel team-bracket-panel"><header><div><small>Ring ${escapeHtml(item.ring)} · ${escapeHtml(formattedEvent(item.event))}</small><h3>${escapeHtml(item.category)}</h3>${item.type === 'bracket' ? categoryDetails(item.bouts[0]) : ''}</div><span>${item.type === 'poomsae' ? 'Single round' : `${item.bouts.length} bouts`}</span></header><div class="team-entrants"><strong>${item.matching.length} ${item.matching.length === 1 ? 'player' : 'players'} from this search</strong><div>${item.matching.map(a => `<span>${escapeHtml(a.name)}<small>${escapeHtml(a.team)}</small></span>`).join('')}</div></div>${item.type === 'bracket' ? bracketDiagram(item.bouts) : `<div class="team-pro-table"><div class="team-pro-head"><span>Entry / player</span><span>Team</span><span>Placing</span></div>${item.group.entrants.map(e => `<div class="team-pro-row ${item.matching.some(a => a.id === e.id) ? 'team-pro-match' : ''}"><span><b>${escapeHtml(e.code)}</b>${escapeHtml(e.name)}</span><span>${escapeHtml(e.team)}</span><strong>${e.rank ?? '—'}</strong></div>`).join('')}</div>`}</section>`).join('')}</div>` : `<div class="empty">${teamTeam === 'ALL' && !search ? 'Select a team or search a player to view their brackets.' : 'No players or brackets match this search on Day ' + day + '.'}</div>`}
  ${pages > 1 ? `<div class="team-pagination"><span>Page ${teamPage + 1} of ${pages}</span><div><button data-team-page="prev" ${teamPage === 0 ? 'disabled' : ''}>Previous</button><button data-team-page="next" ${teamPage === pages - 1 ? 'disabled' : ''}>Next</button></div></div>` : ''}`;
}
function resultView() {
  return teamTallyView() + resultsBrowseFilters() + completedCategoryResults(tallyEvent);
}
const resultsDayMatches = award => award.day === 1;
const resultsEventMatches = (award, selectedEvent) => selectedEvent === 'ALL' || (selectedEvent === 'POOMSAE' ? award.event.startsWith('POOMSAE') : award.event === selectedEvent);
const resultsAgeMatches = award => view !== 'results' || tallyAge === 'ALL' || ageGroup(award.category) === tallyAge;
function teamStandings(preset,gender = tallyGender,source = data) { return calculateStandings(preset,gender,source); }
function overallReportSnapshot(source = data) {
  return {
    event:{ ...source.event, dates:[...source.event.dates] }, version:source.version,
    generatedAt:new Date().toISOString(),
    completedCategories:source.awards.filter(a => a.day === 1 && a.finished && a.medals.length).length,
    totalCategories:source.awards.filter(a => a.day === 1).length,
    groups:tallyPresets.map(preset => ({ title:preset.label,
      sections:[['ALL','Combined']].map(([gender,label]) => ({
        gender, label, rows:teamStandings(preset,gender,source).map(row => ({ ...row })),
      })),
    })),
  };
}
function loadPdfLibrary() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!pdfLibraryPromise) pdfLibraryPromise = new Promise((resolve,reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/jspdf.umd.min.js?v=4.2.1';
    script.onload = () => {
      if (window.jspdf?.jsPDF) resolve(window.jspdf.jsPDF);
      else { script.remove(); pdfLibraryPromise = null; reject(Error('PDF library could not start. Please retry.')); }
    };
    script.onerror = () => { script.remove(); pdfLibraryPromise = null; reject(Error('Could not load the PDF exporter. Please retry.')); };
    document.head.append(script);
  });
  return pdfLibraryPromise;
}
async function exportOverallPdf() {
  if (pdfExportPending) return;
  pdfExportPending = true; pdfExportError = ''; render();
  try {
    const [latest,PdfConstructor,{createOverallPdf}] = await Promise.all([
      api('/api/state'), loadPdfLibrary(), import('/overall-pdf.js?v=perlis-2026-76'),
    ]);
    const pdf = createOverallPdf(overallReportSnapshot(latest),PdfConstructor);
    await pdf.save('perlis-overall-awards.pdf',{ returnPromise:true });
  } catch (error) { pdfExportError = error.message || 'PDF export failed. Please retry.'; }
  finally { pdfExportPending = false; render(); }
}
function teamTallyView() {
  const preset = tallyPresets.find(p => p.id === tallyPreset) || tallyPresets[0];
  const standings = teamStandings(preset);
  return `<section class="tally-panel"><div class="tally-intro"><div><p class="eyebrow">Official standings · Day 1</p><h2>Overall awards</h2><p>Super Cadet: 9–11 · Cadet: 12–14 · Junior: 15–17. Champion, 1st Runner Up and 2nd Runner Up receive trophies in each group. Overall event standings include all ages.</p></div><div class="tally-export"><button id="export-overall-pdf" class="secondary-link" ${pdfExportPending ? 'disabled aria-busy="true"' : ''}>${pdfExportPending ? 'Preparing PDF...' : 'Export awards (PDF)'}</button><small>All 8 groups · Top 3 trophy positions · Combined medals</small><p class="tally-export-error" role="alert">${escapeHtml(pdfExportError)}</p></div></div>
    <div class="tally-preset-field"><label for="tally-preset">Overall award group</label><select id="tally-preset">${tallyPresets.map(p => `<option value="${p.id}" ${p.id === preset.id ? 'selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}</select></div>
    <div class="tally-preset-field"><label for="tally-gender">View medals by gender</label><select id="tally-gender">${[['ALL','Combined'],['M','Male'],['F','Female']].map(([id,name]) => `<option value="${id}" ${id === tallyGender ? 'selected' : ''}>${name}</option>`).join('')}</select></div>
    <p class="tally-note">Ranked by gold, silver, then bronze · Day 1 · ${escapeHtml(preset.label)} · ${tallyGender === 'M' ? 'Male' : tallyGender === 'F' ? 'Female' : 'Combined'}.</p>
    <div class="tally-table-wrap"><table class="tally-table"><thead><tr><th>Rank</th><th>Team</th><th>Gold</th><th>Silver</th><th>Bronze</th><th>Total</th></tr></thead><tbody>${standings.map((row,i)=>`<tr><td><span class="tally-rank">${row.rank}</span></td><th scope="row">${escapeHtml(row.team)}${tallyGender === 'ALL' && row.trophy ? `<small class="trophy-label">${row.tied ? 'Joint ' : ''}${row.trophy} · Trophy</small>` : ''}</th><td>${row.gold}</td><td>${row.silver}</td><td>${row.bronze}</td><td><strong>${row.gold+row.silver+row.bronze}</strong></td></tr>`).join('') || '<tr><td colspan="6" class="tally-empty">No completed categories in this selection yet.</td></tr>'}</tbody></table></div>
  </section>`;
}
function resultsBrowseFilters() {
  return `<section class="tally-panel results-browse-filters"><div class="tally-intro"><h2>Category results filters</h2></div>
    <div class="tally-preset-field"><label for="results-event">Event</label><select id="results-event">${[['ALL','All events'],['KYORUGI','Kyorugi'],['POOMSAE','Poomsae']].map(([id,name]) => `<option value="${id}" ${tallyEvent === id ? 'selected' : ''}>${name}</option>`).join('')}</select></div><div class="tally-scopes" role="group" aria-label="Age group">${[['ALL','All ages'],['SUPER_CADET','Super Cadet (9–11)'],['CADET','Cadet (12–14)'],['JUNIOR','Junior (15–17)']].map(([id,name]) => `<button data-tally-age="${id}" class="${tallyAge === id ? 'selected' : ''}" aria-pressed="${tallyAge === id}">${name}</button>`).join('')}</div>
  </section>`;
}
function awardMedalRow(m) {
  return `<div class="award-medalist ${m.medal.toLowerCase()}"><span class="award-medal ${m.medal.toLowerCase()}">${escapeHtml(m.medal)}</span><div><strong>${escapeHtml(label(m.athleteId))}</strong><small>${escapeHtml(athlete(m.athleteId)?.team || 'Team not listed')}</small></div><span class="award-person-state ${m.state.toLowerCase()}">${medalStateText[m.state]}</span></div>`;
}
function completedCategoryResults(selectedEvent = 'ALL') {
  const finished = data.awards.filter(a => resultsDayMatches(a) && a.finished && a.medals.length && resultsEventMatches(a,selectedEvent) && resultsAgeMatches(a));
  const selected = finished.filter(a => !awardQuery || `${a.ring} ${a.category} ${a.event} ${a.medals.map(m => `${label(m.athleteId)} ${athlete(m.athleteId)?.team || ''}`).join(' ')}`.toLowerCase().includes(awardQuery.toLowerCase()));
  const pageSize = 24, pages = Math.max(1, Math.ceil(selected.length / pageSize));
  awardPublicPage = Math.min(awardPublicPage, pages - 1);
  return `<section class="completed-results"><div class="section-heading"><div><p class="eyebrow">Day 1 · Official results</p><h2>Completed categories</h2></div><span>${selected.length} categories</span></div><div class="award-filters"><label>Search category or athlete<input id="award-search" placeholder="Category, athlete, team or ring" value="${escapeAttr(awardQuery)}"></label></div><div class="award-category-list">${selected.slice(awardPublicPage * pageSize, (awardPublicPage + 1) * pageSize).map(a => `<article class="award-category result-category"><header><h3>${escapeHtml(a.category)}</h3><small>Day ${a.day} · Ring ${escapeHtml(a.ring)} · ${escapeHtml(formattedEvent(a.event))}</small></header><div class="award-medalists">${a.medals.map(m => `<div class="award-medalist ${m.medal.toLowerCase()}"><span class="award-medal ${m.medal.toLowerCase()}">${escapeHtml(m.medal)}</span><div><strong>${escapeHtml(label(m.athleteId))}</strong><small>${escapeHtml(athlete(m.athleteId)?.team || 'Team not listed')}</small></div></div>`).join('')}</div></article>`).join('') || '<div class="empty">Results appear here as soon as a category finishes.</div>'}</div>${pages > 1 ? `<div class="award-pagination"><span>Page ${awardPublicPage + 1} of ${pages}</span><div><button data-award-page="prev" ${awardPublicPage === 0 ? 'disabled' : ''}>Previous</button><button data-award-page="next" ${awardPublicPage === pages - 1 ? 'disabled' : ''}>Next</button></div></div>` : ''}</section>`;
}
function awardsView() {
  return `${filters(false)}${completedCategoryResults()}`;
}
function awardsHistoryView() {
  const selected = data.awards.filter(a => a.day === day && a.finished && archivedAward(a) && (!awardQuery || `${a.ring} ${a.category} ${a.event} ${a.medals.map(m => `${label(m.athleteId)} ${athlete(m.athleteId)?.team || ''}`).join(' ')}`.toLowerCase().includes(awardQuery.toLowerCase())))
    .sort((a,b) => String(b.deliveredAt || '').localeCompare(String(a.deliveredAt || '')));
  const pageSize = 24, pages = Math.max(1,Math.ceil(selected.length/pageSize));
  awardPublicPage = Math.min(awardPublicPage,pages-1);
  return `<div class="awards-page">${filters(false)}<div class="section-heading"><div><p class="eyebrow">Medal presentation</p><h2>Delivered history</h2><p>Completion times are shown in Malaysia time (MYT).</p></div><a class="secondary-link" href="/awards?day=${day}">← Awards tracker</a></div><div class="award-filters"><label>Search category or athlete<input id="award-search" placeholder="Category, athlete, team or ring" value="${escapeAttr(awardQuery)}"></label></div><div class="award-category-list">${selected.slice(awardPublicPage*pageSize,(awardPublicPage+1)*pageSize).map(a => `<details class="award-category"><summary><span class="award-summary-main"><strong>${escapeHtml(a.category)}</strong><small>Ring ${escapeHtml(a.ring)} · ${escapeHtml(formattedEvent(a.event))} · ${escapeHtml(malaysiaTime(a.deliveredAt))}</small></span><span class="award-state ${a.status.toLowerCase()}">${awardStatusText[a.status]}</span><span class="award-expand">⌄</span></summary><div class="award-medalists">${a.medals.map(awardMedalRow).join('')}</div></details>`).join('') || '<div class="empty">No delivered categories match this search.</div>'}</div>${pages > 1 ? `<div class="award-pagination"><span>Page ${awardPublicPage+1} of ${pages}</span><div><button data-award-page="prev" ${awardPublicPage === 0 ? 'disabled' : ''}>Previous</button><button data-award-page="next" ${awardPublicPage === pages-1 ? 'disabled' : ''}>Next</button></div></div>` : ''}</div>`;
}
const ringLetters = 'ABCDEFG'.split('');
const ringSelectOptions = selected => ringLetters.map(value => `<option value="${value}" ${value === selected ? 'selected' : ''}>Ring ${value}</option>`).join('');
const awardPinOption = '<option value="AWARDS">Awards desk</option>';
const adminScope = () => data.bouts.filter(b => b.day === day && (role === 'admin' ? ring === 'ALL' || assignedRing(b) === ring : assignedRing(b) === coordinatorRing));
const coordinatorDay2Locked = () => false;
const adminSearchMatch = b => !query || `${b.code} ${b.category} ${b.event} ${label(b.redId)} ${label(b.blueId)} ${athlete(b.redId)?.team || ''} ${athlete(b.blueId)?.team || ''}`.toLowerCase().includes(query.toLowerCase());
function adminDashboardContent() {
  const scoped = adminScope(), complete = scoped.filter(b => b.status === 'COMPLETE').length;
  const ready = scoped.filter(b => b.status === 'READY').length, waiting = scoped.filter(b => b.status === 'WAITING').length;
  const percent = scoped.length ? Math.round(complete / scoped.length * 100) : 0;
  const rings = role === 'admin' ? ringLetters : [coordinatorRing];
  const ringRows = rings.map(letter => {
    if (day === 1 && poomsaeRing(letter) && !data.bouts.some(b => assignedRing(b) === letter)) {
      const groups = data.poomsae.filter(g => g.ring === letter);
      const done = groups.filter(g => g.finished).length, total = groups.length;
      const current = groups.find(g => !g.finished);
      return `<button class="ad-ring-row" data-open-pro="${letter}"><span class="ad-ring-letter">${letter}</span><span class="ad-ring-name"><strong>Ring ${letter}</strong><small>Poomsae</small></span><span class="ad-ring-current"><b>${escapeHtml(current?.category || 'All placed')}</b><small>Next category</small></span><span class="ad-ring-progress"><b>${done} / ${total}</b><i><em style="width:${total ? Math.round(done / total * 100) : 0}%"></em></i></span><span class="ad-ring-chevron">›</span></button>`;
    }
    const bouts = data.bouts.filter(b => b.day === day && assignedRing(b) === letter).sort(scheduleSort);
    const done = bouts.filter(b => b.status === 'COMPLETE').length;
    const current = bouts.find(b => b.status === 'READY');
    const ratio = bouts.length ? Math.round(done / bouts.length * 100) : 0;
    return `<button class="ad-ring-row" data-open-ring="${letter}"><span class="ad-ring-letter">${letter}</span><span class="ad-ring-name"><strong>Ring ${letter}</strong><small>${escapeHtml(activePlan(day).find(p => p.ring === letter)?.label || formattedEvent(activePlan(day).find(p => p.ring === letter)?.event))}</small></span><span class="ad-ring-current">${current ? `<b>${escapeHtml(current.code)}</b><small>Next ready bout</small>` : `<b>${bouts.length ? 'No ready bout' : 'No bouts loaded'}</b>`}</span><span class="ad-ring-progress"><b>${done} / ${bouts.length}</b><i><em style="width:${ratio}%"></em></i></span><span class="ad-ring-chevron">›</span></button>`;
  }).join('');
  const recent = scoped.filter(b => b.status === 'COMPLETE').sort((a,b) => String(b.result?.recordedAt || '').localeCompare(String(a.result?.recordedAt || ''))).slice(0,6);
  return `<div class="ad-page-head"><div><p class="ad-kicker">Competition overview</p><h1>${role === 'admin' ? `Day ${day} dashboard` : `Ring ${coordinatorRing} dashboard`}</h1><p>Live operations and progress for ${escapeHtml(data.event.dates[day-1])}.</p></div><button class="ad-primary" data-admin-section="bouts">Open bout queue <span>→</span></button></div>
  <section class="ad-stats" aria-label="Competition analytics"><div class="ad-stat ad-stat-primary"><span>Total bouts</span><strong>${scoped.length.toLocaleString()}</strong><small>Day ${day}${ring !== 'ALL' ? ` · Ring ${ring}` : ''}</small></div><div class="ad-stat"><span>Ready to run</span><strong>${ready.toLocaleString()}</strong><small>Awaiting result entry</small></div><div class="ad-stat"><span>Completed</span><strong>${complete.toLocaleString()}</strong><small>${percent}% of scheduled bouts</small></div><div class="ad-stat"><span>Awaiting progression</span><strong>${waiting.toLocaleString()}</strong><small>Waiting for earlier results</small></div></section>
  <section class="ad-progress-panel"><div><span>Competition progress</span><strong>${percent}% complete</strong></div><div class="ad-progress-track"><span style="width:${percent}%"></span></div><small>Based on recorded results in this view</small></section>
  <div class="ad-dashboard-grid"><section class="ad-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Ring operations</p><h2>Ring activity</h2></div><span>${rings.length} rings</span></div><div class="ad-ring-list">${ringRows}</div><button class="ad-outline" data-admin-section="poomsae">Open scored Poomsae queue</button></section><section class="ad-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Official record</p><h2>Recent results</h2></div><button class="ad-text-action" data-admin-section="bouts" data-status="COMPLETE">View all</button></div>${recent.length ? `<div class="ad-recent-list">${recent.map(b => `<div class="ad-recent-row"><span class="ad-recent-code">${escapeHtml(b.code)}</span><span><strong>${escapeHtml(label(b.winnerId))}</strong><small>Ring ${assignedRing(b)} · ${escapeHtml(b.category)}</small></span><b>${escapeHtml(b.method)}</b></div>`).join('')}</div>` : '<div class="ad-panel-empty">No results recorded for this selection yet.</div>'}</section></div>`;
}
function adminBoutCard(b) {
  const contestant = (id,corner) => `<div class="queue-player queue-player-${corner}"><div class="queue-corner"><span class="queue-corner-dot"></span>${corner === 'blue' ? 'Chung · Blue' : 'Hong · Red'}${b.winnerId && b.winnerId === id ? '<span class="queue-winner">Winner</span>' : ''}</div><strong>${escapeHtml(label(id))}</strong><small>${escapeHtml(athlete(id)?.team || 'To be determined')}</small></div>`;
  return `<article class="queue-bout queue-bout-${b.status.toLowerCase()}" aria-label="Bout ${escapeAttr(b.code)} · ${escapeAttr(b.category)}"><header class="queue-bout-header"><div class="queue-bout-code"><small>Bout</small><strong>${escapeHtml(b.code)}</strong></div><span class="status ${b.status.toLowerCase()}">${statusText[b.status]}</span></header><div class="queue-bout-info"><h2>${escapeHtml(b.category)}</h2>${categoryDetails(b)}<div class="queue-bout-meta"><span class="queue-round">${escapeHtml(roundLabel(b))}</span><span>Ring ${escapeHtml(assignedRing(b))}</span></div><p>${escapeHtml(formattedEvent(b.event))}</p></div><div class="queue-players">${contestant(b.blueId,'blue')}${contestant(b.redId,'red')}</div><footer class="queue-bout-footer">${b.status === 'READY' ? `<button class="record queue-record" data-bout="${escapeAttr(b.id)}">Record result <span aria-hidden="true">→</span></button>` : b.status === 'COMPLETE' ? `<button class="undo queue-correct" data-bout="${escapeAttr(b.id)}">Correct result</button>` : `<span class="queue-waiting">${b.status === 'WAITING' ? 'Awaiting earlier bout' : 'Automatic bye'}</span>`}</footer></article>`;
}
function adminBoutsContent() {
  const scoped = adminScope().filter(adminSearchMatch).sort(scheduleSort);
  const selected = scoped.filter(b => adminStatus === 'ALL' || b.status === adminStatus);
  const shown = selected;
  return `<div class="ad-page-head"><div><p class="ad-kicker">Match operations</p><h1>Bout queue</h1><p>Find bouts and record results for the assigned ring.</p></div>${role === 'admin' ? '<button class="ad-outline" data-results-export="bouts">Download results CSV</button>' : ''}</div>
  <div class="ad-filter-panel"><label>Ring<select id="admin-ring-select" ${role === 'coordinator' ? 'disabled' : ''}><option value="ALL" ${ring === 'ALL' ? 'selected' : ''}>All rings</option>${ringSelectOptions(ring)}</select></label><label>Status<select id="admin-status">${[['READY','Ready'],['WAITING','Waiting'],['COMPLETE','Completed'],['BYE','Bye'],['ALL','All statuses']].map(([v,n]) => `<option value="${v}" ${v === adminStatus ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label class="ad-search">Search bouts<input id="search" placeholder="Code, athlete, team or category" value="${escapeAttr(query)}"></label></div>
  <div class="ad-queue-summary"><strong>${selected.length.toLocaleString()} bouts</strong><span>${scoped.filter(b => b.status === 'READY').length} ready</span><span>${scoped.filter(b => b.status === 'COMPLETE').length} completed</span></div>
  <section class="queue-bout-list" aria-label="Bout queue">${shown.length ? shown.map(adminBoutCard).join('') : '<div class="ad-panel-empty">No bouts match the selected filters.</div>'}</section>`;
}
const numericCode = code => Number(String(code).match(/^[A-Z](\d+)/)?.[1] || 0);
function transferEntries() {
  return (transferMode === 'bouts' ? data.bouts : []).concat((transferMode === 'scored' ? data.poomsae : []).flatMap(g => g.entrants.map(e => ({
    id:e.id, code:e.code, category:g.category, day:1, event:'POOMSAE PRO', assignedRing:g.ring,
    scheduleOrder:e.scheduleOrder ?? numericCode(e.code), status:e.performed ? 'COMPLETE' : 'WAITING', blueId:e.id, redId:null,
  }))));
}
function adminTransferContent() {
  const sourceAll = transferEntries().filter(b => b.day === day && assignedRing(b) === transferSourceRing && b.code[0] === transferPrefix).sort(scheduleSort);
  const source = sourceAll.filter(b => !transferQuery || `${b.code} ${b.category} ${label(b.blueId)} ${label(b.redId)}`.toLowerCase().includes(transferQuery.toLowerCase()));
  const destinationAll = transferEntries().filter(b => b.day === day && assignedRing(b) === transferTargetRing).sort(scheduleSort);
  const destination = destinationAll.filter(b => !transferDestinationQuery || `${b.code} ${b.category}`.toLowerCase().includes(transferDestinationQuery.toLowerCase()));
  const boundsReady = Number.isInteger(transferStart) && Number.isInteger(transferEnd);
  const from = boundsReady ? Math.min(transferStart,transferEnd) : null, to = boundsReady ? Math.max(transferStart,transferEnd) : null;
  const picked = boundsReady ? sourceAll.filter(b => numericCode(b.code) >= from && numericCode(b.code) <= to) : [];
  const anchor = transferEntries().find(b => b.id === transferAfterId);
  const prefixes = [...new Set(transferEntries().filter(b => b.day === day && assignedRing(b) === transferSourceRing).map(b => b.code[0]))].sort();
  return `<div class="ad-page-head"><div><p class="ad-kicker">Schedule operations</p><h1>Bulk transfer</h1><p>Pick the first and last bout or Poomsae entry, then choose the destination position. Move each Poomsae category together.</p></div></div><div class="ad-transfer-layout"><section class="ad-panel ad-transfer-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Step 1</p><h2>Choose source bouts</h2></div><span>${sourceAll.length} on ring</span></div><div class="ad-transfer-controls"><label>Queue<select id="transfer-mode"><option value="bouts" ${transferMode === 'bouts' ? 'selected' : ''}>Knockout bouts</option><option value="scored" ${transferMode === 'scored' ? 'selected' : ''}>Scored Poomsae entries</option></select></label><span>Current ring</span><div class="ad-chip-list">${ringLetters.map(letter => `<button data-transfer-source="${letter}" class="${transferSourceRing === letter ? 'active' : ''}">${letter}</button>`).join('')}</div><span>Original code prefix</span><div class="ad-chip-list">${prefixes.map(letter => `<button data-transfer-prefix="${letter}" class="${transferPrefix === letter ? 'active' : ''}">${letter}</button>`).join('') || '<small>No bouts</small>'}</div><label>Find source bout<input id="transfer-search" placeholder="A47, category or athlete" value="${escapeAttr(transferQuery)}"></label></div><div class="ad-pick-head"><span>Bout / category</span><span>Range</span></div><div class="ad-pick-list" id="transfer-source-list">${source.map(b => { const n = numericCode(b.code); const selected = boundsReady && n >= from && n <= to; return `<div class="ad-pick-row ${selected ? 'selected' : ''}"><span><strong>${escapeHtml(b.code)}</strong><small>${escapeHtml(b.category)} · ${statusText[b.status]}</small></span><span class="ad-boundary"><button data-transfer-boundary="start" data-number="${n}" class="${transferStart === n ? 'active' : ''}">First</button><button data-transfer-boundary="end" data-number="${n}" class="${transferEnd === n ? 'active' : ''}">Last</button></span></div>`; }).join('') || '<div class="ad-panel-empty">No source bouts match.</div>'}</div></section><section class="ad-panel ad-transfer-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Step 2</p><h2>Place on destination ring</h2></div><span>${destinationAll.length} bouts</span></div><div class="ad-transfer-controls"><span>Destination ring</span><div class="ad-chip-list">${ringLetters.map(letter => `<button data-transfer-target="${letter}" class="${transferTargetRing === letter ? 'active' : ''}">${letter}</button>`).join('')}</div><label>Find insertion point<input id="transfer-destination-search" placeholder="B35 or category" value="${escapeAttr(transferDestinationQuery)}"></label></div><div class="ad-pick-head"><span>Existing bout</span><span>Position</span></div><div class="ad-pick-list" id="transfer-target-list"><div class="ad-pick-row ${transferAfterId === 'END' ? 'selected' : ''}"><span><strong>End of ring ${transferTargetRing}</strong><small>After all entries currently on this ring</small></span><button class="ad-after-button ${transferAfterId === 'END' ? 'active' : ''}" data-transfer-after="END">Choose end</button></div><div class="ad-pick-row ${!transferAfterId ? 'selected' : ''}"><span><strong>Start of ring ${transferTargetRing}</strong><small>Before the first scheduled bout</small></span><button class="ad-after-button ${!transferAfterId ? 'active' : ''}" data-transfer-after="">Choose</button></div>${destination.map(b => `<div class="ad-pick-row ${transferAfterId === b.id ? 'selected' : ''}"><span><strong>${escapeHtml(b.code)}</strong><small>${escapeHtml(b.category)} · ${statusText[b.status]}</small></span><button class="ad-after-button ${transferAfterId === b.id ? 'active' : ''}" data-transfer-after="${escapeAttr(b.id)}">After</button></div>`).join('')}</div></section></div><form id="transfer-table-form" class="ad-transfer-confirm"><div><strong>${picked.length ? `${picked.length} bouts · ${transferPrefix}${from}–${transferPrefix}${to}` : 'Select first and last bouts'}</strong><p>${picked.length ? `Move from Ring ${transferSourceRing} to Ring ${transferTargetRing}, ${transferAfterId === 'END' ? 'at the end' : anchor ? `after ${anchor.code}` : 'at the start'}. Original codes stay unchanged.` : 'The selected range and destination will appear here.'}</p></div><button class="ad-primary" ${!picked.length ? 'disabled' : ''}>Transfer ${picked.length || ''} bouts</button><p class="form-error" role="alert"></p></form>`;
}
let transferDestinationQuery = '', transferSourceScroll = 0, transferTargetScroll = 0;
function adminEmptyCategoriesContent() {
  const open = data.bouts.filter(b => b.day === day && b.manual && b.directIds.length + b.childIds.length < 2 && b.status !== 'COMPLETE').sort(scheduleSort);
  const target = open.find(b => b.id === categoryPlayerDraft.boutId) || open[0];
  const corners = target ? ['B','R'].filter(c => !Object.values(target.corners).includes(c)) : [];
  categoryPlayerDraft.boutId = target?.id || '';
  if (!corners.includes(categoryPlayerDraft.corner)) categoryPlayerDraft.corner = corners[0] || 'B';
  return `<div class="ad-transfer-layout ad-category-layout">
  <section class="ad-panel"><div class="ad-panel-title"><div><p class="ad-kicker">New category</p><h2>Create with 0 players</h2></div></div>
  <form id="category-create-form" class="ad-stage-form"><p>Each category starts with one final and two empty corners. Add its players when ready.</p>
  <label>Ring<select name="ring">${'ABCDEFG'.split('').map(r => `<option value="${r}" ${categoryCreateDraft.ring === r ? 'selected' : ''}>Ring ${r} · ${'FG'.includes(r) ? 'Poomsae knockout' : 'Kyorugi'}</option>`).join('')}</select></label>
  <label>Category names (one per line)<textarea name="names" rows="3" required placeholder="A Friendly A1&#10;A Friendly A2&#10;A Friendly A3">${escapeHtml(categoryCreateDraft.names)}</textarea></label>
  <button class="ad-primary">Create empty categories</button><p class="form-error" role="alert"></p></form></section>
  <section class="ad-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Players</p><h2>Fill an empty corner</h2></div><span>${open.length} categories waiting for players</span></div>
  ${target ? `<form id="category-player-form" class="ad-stage-form"><label>Category<select name="boutId" id="category-player-bout">${open.map(b => `<option value="${escapeAttr(b.id)}" ${target.id === b.id ? 'selected' : ''}>${escapeHtml(b.code)} · ${escapeHtml(b.category)} · ${b.directIds.length + b.childIds.length}/2 slots filled</option>`).join('')}</select></label>
  <div class="form-grid"><label>Corner<select name="corner">${corners.map(c => `<option value="${c}" ${c === categoryPlayerDraft.corner ? 'selected' : ''}>${c === 'B' ? 'Chung · Blue' : 'Hong · Red'}</option>`).join('')}</select></label><label>Athlete name<input name="name" required maxlength="120" value="${escapeAttr(categoryPlayerDraft.name)}"></label><label class="wide">Team<input name="team" required maxlength="120" value="${escapeAttr(categoryPlayerDraft.team)}"></label></div>
  <p>The bout stays Waiting until both players are entered. For more players, fill both corners first, then add qualifying bouts below.</p>
  <button class="ad-primary">Add player</button><p class="form-error" role="alert"></p></form>` : '<div class="ad-panel-empty">Create a category to add its players here. Filled categories appear in the bout queue and can receive qualifiers below.</div>'}</section></div>`;
}
function adminQualifyingContent() {
  if (qualifyingRing === 'SCORED') return adminPoomsaeEntryContent();
  const dayBouts = data.bouts.filter(b => b.day === day && b.directIds.length && b.status !== 'COMPLETE');
  const categories = [...new Set(dayBouts.filter(b => qualifyingRing === 'ALL' || assignedRing(b) === qualifyingRing).map(b => b.category))].sort();
  const selected = dayBouts.filter(b => (qualifyingRing === 'ALL' || assignedRing(b) === qualifyingRing) && (qualifyingCategory === 'ALL' || b.category === qualifyingCategory) && (!qualifyingQuery || `${b.code} ${b.category} ${label(b.blueId)} ${label(b.redId)}`.toLowerCase().includes(qualifyingQuery.toLowerCase()))).sort(scheduleSort);
  const pageSize = 30, pages = Math.max(1,Math.ceil(selected.length/pageSize));
  qualifyingPage = Math.min(qualifyingPage,pages-1);
  const shown = selected.slice(qualifyingPage*pageSize,(qualifyingPage+1)*pageSize);
  const target = data.bouts.find(b => b.id === qualifyingSelectedId && b.day === day && b.directIds.length && b.status !== 'COMPLETE');
  const targetRing = target ? assignedRing(target) : qualifyingRing === 'ALL' ? 'A' : qualifyingRing;
  const ringSchedule = data.bouts.filter(b => b.day === day && assignedRing(b) === targetRing).sort(scheduleSort);
  const targetPosition = target ? ringSchedule.findIndex(b => b.id === target.id) : -1;
  const defaultAfter = targetPosition > 0 ? ringSchedule[targetPosition-1].id : '';
  return `<div class="ad-page-head"><div><p class="ad-kicker">Bracket changes</p><h1>Categories & players</h1><p>Create empty categories, add players, or extend an existing draw with qualifiers.</p></div></div>${adminEmptyCategoriesContent()}<h2 class="ad-section-heading">Add qualifying bouts</h2><div class="ad-qualifying-layout"><section class="ad-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Step 1</p><h2>Find destination match</h2></div><span>${selected.length} matches</span></div><div class="ad-qualifying-filters"><label>Ring<select id="qualifying-ring"><option value="SCORED" ${qualifyingRing === 'SCORED' ? 'selected' : ''}>Poomsae scored entries</option><option value="ALL" ${qualifyingRing === 'ALL' ? 'selected' : ''}>All rings</option>${ringSelectOptions(qualifyingRing)}</select></label><label>Category<select id="qualifying-category"><option value="ALL">All categories</option>${categories.map(cat => `<option value="${escapeAttr(cat)}" ${cat === qualifyingCategory ? 'selected' : ''}>${escapeHtml(cat)}</option>`).join('')}</select></label><label class="wide">Search<input id="qualifying-search" placeholder="Bout, category or athlete" value="${escapeAttr(qualifyingQuery)}"></label></div><div class="ad-match-list">${shown.map(b => `<button class="ad-match-row ${qualifyingSelectedId === b.id ? 'selected' : ''}" data-qualifying-target="${escapeAttr(b.id)}"><span><strong>${escapeHtml(b.code)}</strong><small>Ring ${assignedRing(b)} · ${escapeHtml(b.category)}</small><small>${b.directIds.map(id => escapeHtml(label(id))).join(' / ')}</small></span><em>${qualifyingDraft.filter(item => item.targetBoutId === b.id).length ? 'Staged' : 'Select'}</em></button>`).join('') || '<div class="ad-panel-empty">No matches found. Try another ring or category.</div>'}</div>${pages > 1 ? `<div class="ad-pagination ad-qualifying-pages"><span>Page ${qualifyingPage+1} of ${pages}</span><div><button data-qualifying-page="prev" ${qualifyingPage === 0 ? 'disabled' : ''}>Previous</button><button data-qualifying-page="next" ${qualifyingPage === pages-1 ? 'disabled' : ''}>Next</button></div></div>` : ''}</section><div class="ad-qualifying-side"><section class="ad-panel ad-stage-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Step 2</p><h2>Stage a qualifier</h2></div></div>${target ? `<form id="qualifying-stage-form" class="ad-stage-form"><div class="ad-selected-target"><strong>${escapeHtml(target.code)} · ${escapeHtml(target.category)}</strong><small>The qualifier winner takes one athlete’s place in this match.</small></div><label>Existing athlete to qualify<select name="sourceAthleteId">${target.directIds.map(id => `<option value="${escapeAttr(id)}">${escapeHtml(label(id))} · ${escapeHtml(athlete(id)?.team)}</option>`).join('')}</select></label><div class="form-grid"><label>New athlete<input name="name" required maxlength="120"></label><label>Team<input name="team" required maxlength="120"></label><label>Assigned ring<select name="assignedRing" id="qualifying-assigned-ring">${ringSelectOptions(targetRing)}</select></label><label>Existing athlete corner<select name="sourceCorner"><option value="B">Chung</option><option value="R">Hong</option></select></label><label class="wide">Insert after<select name="afterBoutId" id="qualifying-after"><option value="">Start of ring</option>${ringSchedule.map(b => `<option value="${escapeAttr(b.id)}" ${b.id === defaultAfter ? 'selected' : ''}>${escapeHtml(b.code)} · ${escapeHtml(b.category)}</option>`).join('')}</select></label></div><button class="ad-primary">Add to draft</button><p class="form-error" role="alert"></p></form>` : '<div class="ad-panel-empty">Select a match from the filtered list to stage a qualifier.</div>'}</section><section class="ad-panel ad-draft-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Step 3</p><h2>Draft qualifiers</h2></div><span>${qualifyingDraft.length} staged</span></div>${qualifyingDraft.length ? `<div class="ad-draft-list">${qualifyingDraft.map((item,index) => { const b = data.bouts.find(x => x.id === item.targetBoutId); return `<div class="ad-draft-row"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.team)} · feeds ${escapeHtml(b?.code)}</small></span><button data-remove-draft="${index}" aria-label="Remove ${escapeAttr(item.name)}">×</button></div>`; }).join('')}</div><div class="ad-draft-save"><button class="ad-primary" id="save-qualifying-draft">Save ${qualifyingDraft.length} qualifying bouts</button><p class="form-error" role="alert"></p></div>` : '<div class="ad-panel-empty">Staged bouts will appear here before saving.</div>'}</section></div></div>`;
}
function adminPoomsaeEntryContent() {
  const groups = data.poomsae.filter(g => qualifyingRing === 'SCORED' || g.ring === qualifyingRing).filter(g => (qualifyingCategory === 'ALL' || g.category === qualifyingCategory) && (!qualifyingQuery || `${g.category} ${g.entrants.map(e => `${e.name} ${e.team} ${e.code}`).join(' ')}`.toLowerCase().includes(qualifyingQuery.toLowerCase())));
  const categories = data.poomsae.map(g => g.category).sort();
  return `<div class="ad-page-head"><div><p class="ad-kicker">Poomsae entries</p><h1>Add Poomsae athletes</h1><p>Stage scored athletes for Ring ${qualifyingRing === 'SCORED' ? 'G' : qualifyingRing}, then save them together. New entries receive codes for this ring.</p></div></div><div class="ad-qualifying-layout"><section class="ad-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Step 1</p><h2>Choose category</h2></div><span>${groups.length} categories</span></div><div class="ad-qualifying-filters"><label>Ring<select id="qualifying-ring"><option value="SCORED" ${qualifyingRing === 'SCORED' ? 'selected' : ''}>Poomsae scored entries</option>${ringSelectOptions(qualifyingRing)}<option value="ALL">All rings</option></select></label><label>Category<select id="qualifying-category"><option value="ALL">All categories</option>${categories.map(cat => `<option value="${escapeAttr(cat)}" ${cat === qualifyingCategory ? 'selected' : ''}>${escapeHtml(cat)}</option>`).join('')}</select></label><label class="wide">Search<input id="qualifying-search" placeholder="Category or athlete" value="${escapeAttr(qualifyingQuery)}"></label></div><div class="ad-match-list">${groups.map(g => `<button class="ad-match-row ${qualifyingSelectedId === g.id ? 'selected' : ''}" data-qualifying-pro-category="${escapeAttr(g.category)}"><span><strong>Ring ${g.ring} · ${escapeHtml(g.category)}</strong><small>${g.entrants.filter(e => e.performed).length} / ${g.entrants.length} performed · ${g.entrants.length} athletes · ${g.entrants.filter(e => e.rank !== null).length} placed</small></span><em>${qualifyingSelectedId === g.id ? 'Selected' : 'Select'}</em></button>`).join('') || '<div class="ad-panel-empty">No categories match this filter. You can enter a new category in Step 2.</div>'}</div></section><div class="ad-qualifying-side"><section class="ad-panel ad-stage-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Step 2</p><h2>Stage an athlete</h2></div></div><form id="pro-entry-stage-form" class="ad-stage-form"><label>Category<input name="category" list="pro-categories" value="${escapeAttr(data.poomsae.find(g => g.id === qualifyingSelectedId)?.category || (qualifyingCategory !== 'ALL' ? qualifyingCategory : ''))}" placeholder="Choose existing or type new category" maxlength="120" required><datalist id="pro-categories">${categories.map(cat => `<option value="${escapeAttr(cat)}">`).join('')}</datalist></label><div class="form-grid"><label>Athlete name<input name="name" maxlength="120" required></label><label>Team<input name="team" maxlength="120" required></label></div><button class="ad-primary">Add to draft</button><p class="form-error" role="alert"></p></form></section><section class="ad-panel ad-draft-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Step 3</p><h2>Draft athletes</h2></div><span>${proEntryDraft.length} staged</span></div>${proEntryDraft.length ? `<div class="ad-draft-list">${proEntryDraft.map((item,index) => `<div class="ad-draft-row"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.team)} · ${escapeHtml(item.category)}</small></span><button data-remove-pro-draft="${index}" aria-label="Remove ${escapeAttr(item.name)}">×</button></div>`).join('')}</div><div class="ad-draft-save"><button class="ad-primary" id="save-pro-entry-draft">Save ${proEntryDraft.length} Poomsae entries</button><p class="form-error" role="alert"></p></div>` : '<div class="ad-panel-empty">Staged athletes will appear here before saving.</div>'}</section></div></div>`;
}
function adminCoordinatorContent() {
  return `<div class="ad-page-head"><div><p class="ad-kicker">Access management</p><h1>Staff PINs</h1><p>Set one six-digit PIN for all rings and the awards desk. Changing it signs out all staff.</p></div></div><div class="ad-coordinator-layout"><form id="pin-form" class="ad-tool-card admin-form"><div class="ad-tool-icon">◈</div><h2>One PIN for all staff</h2><p>Share this one PIN with all coordinators and the awards team. Staff choose their ring or role when signing in.</p><label>Six-digit PIN<input name="pin" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="new-password"></label><button class="ad-primary">Save shared PIN</button><p class="form-error" role="alert"></p></form><section class="ad-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Access scope</p><h2>Staff permissions</h2></div></div><div class="ad-permission-list"><div><strong>Ring coordinators</strong><p>See and manage only bouts assigned to their ring.</p></div><div><strong>Awards desk</strong><p>Call medalists, record medal delivery, and mark absent athletes. No bout result access.</p></div><div><strong>Lead admin</strong><p>Can manage results, schedule changes, staff PINs, and awards.</p></div></div></section></div>`;
}
function adminTournamentContent() {
  const current = data.event;
  const resetPhrase = `RESET ${current.shortName}`;
  return `<div class="ad-page-head"><div><p class="ad-kicker">Tournament template</p><h1>Event setup & data</h1><p>Update this event, download its data, or prepare a new tournament from CSV files.</p></div><a class="ad-outline" href="/admin/template-guide?day=${day}">Open guide & templates →</a></div>
  <div class="ad-qualifying-layout"><div class="ad-qualifying-side"><section class="ad-panel ad-stage-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Current event</p><h2>Names & dates</h2></div></div><form id="event-settings-form" class="ad-stage-form"><label>Event name<input name="name" value="${escapeAttr(current.name)}" maxlength="120" required></label><label>Short name<input name="shortName" value="${escapeAttr(current.shortName || current.name)}" maxlength="40" required></label><div class="form-grid"><label>Day 1 date<input name="date1" value="${escapeAttr(current.dates[0])}" maxlength="60" required></label></div><button class="ad-primary">Save event details</button><p class="form-error" role="alert"></p></form></section>
  <section class="ad-panel ad-stage-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Export</p><h2>Download tournament data</h2></div></div><div class="ad-stage-form"><p>Save a complete JSON backup with roster, results, schedule, awards and audit history. Staff PINs are excluded.</p><button class="ad-primary" id="download-tournament" type="button">Download full backup</button><button class="ad-outline" data-results-export="medals">Export all results CSV</button><button class="ad-outline" data-results-export="bouts">Bout results CSV</button><p class="form-error" role="alert"></p></div></section>
  <section class="ad-panel ad-stage-panel ad-reset-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Manual reset</p><h2>Reset this tournament</h2></div></div><form id="tournament-reset-form" class="ad-stage-form"><p>Clears recorded winners, Poomsae placings and award delivery. The event name, imported base roster and staff PINs stay in place. Download a backup first.</p><label>Reset scope<select name="scope"><option value="progress">Results and awards only — keep transfers and added athletes</option><option value="operations">All competition operations — also clear transfers, added athletes and schedule changes</option></select></label><label>Type ${escapeHtml(resetPhrase)} to confirm<input name="confirm" autocomplete="off" required aria-label="Type ${escapeAttr(resetPhrase)} to confirm"></label><button class="ad-reset-button" type="submit">Reset current tournament</button><p class="form-error" role="alert"></p></form></section></div>
  <section class="ad-panel ad-stage-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Future tournament</p><h2>Import a new roster</h2></div></div><form id="tournament-import-form" class="ad-stage-form"><p>Use the same CSV columns as the supplied templates. Bout routes and corners must be assigned in the CSV, with final bout first and first scheduled contest in the last nonempty bout column. Importing creates a fresh tournament in this database; download a backup of the current event first.</p><div class="form-grid"><label>New event name<input name="name" maxlength="120" required></label><label>Short name<input name="shortName" maxlength="40" required></label><label>Day 1 date<input name="date1" maxlength="60" required placeholder="12 March 2027"></label></div><label>Bout roster CSV<input name="boutsCsv" type="file" accept=".csv,text/csv" required></label><label>Poomsae CSV (optional)<input name="poomsaeCsv" type="file" accept=".csv,text/csv"></label><div class="ad-stage-form"><button type="button" class="ad-outline" data-csv-template="bouts">Download bout CSV template</button><button type="button" class="ad-outline" data-csv-template="poomsae">Download Poomsae CSV template</button></div><label>Confirm by typing CREATE NEW TOURNAMENT<input name="confirm" autocomplete="off" required></label><button class="ad-primary">Import & start new tournament</button><p class="form-error" role="alert"></p></form></section></div>`;
}
function adminTemplateGuideContent() {
  const aiBrief = `Prepare tournament import files for this system. Return two UTF-8 CSV files: a bout roster and, if needed, a Poomsae roster. Use one row per athlete. Keep athlete names, teams, categories and event names exactly as supplied; do not invent missing entrants. Each bout athlete needs a unique competitor_no within its day and event. Set day to 1 or 2. Bout codes begin with ring A–J. The first_bout column is the FINAL; later bout_2 through bout_5 columns walk backward toward the athlete's first scheduled match. Each occupied bout column needs a matching B (Chung) or R (Hong) corner. Two athletes entering the same match must occupy opposite corners. Athletes with no scheduled match may leave all bout columns blank. Poomsae entries use unique D codes as competitor_no. Check duplicate IDs, category consistency, bracket paths and CSV quoting before delivery. Return files only after validation.`;
  return `<div class="ad-page-head"><div><p class="ad-kicker">Tournament template</p><h1>Guide & CSV templates</h1><p>Use these rules to prepare a future event by hand or with an AI assistant.</p></div><a class="ad-outline" href="/admin/tournament?day=${day}">← Event setup</a></div>
  <div class="ad-guide-grid"><section class="ad-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Workflow</p><h2>Before importing</h2></div></div><ol class="ad-guide-steps"><li><strong>Back up the current event.</strong><span>Download its full JSON backup from Event setup. Importing a new event replaces current live competition operations.</span></li><li><strong>Prepare the roster.</strong><span>Download the templates below. Use one CSV row per athlete and keep the supplied spellings of names, teams and categories.</span></li><li><strong>Check the bracket paths.</strong><span>Enter the final bout in first_bout, then earlier rounds in bout_2 through bout_5. Each occupied bout needs a B or R corner.</span></li><li><strong>Import in Event setup.</strong><span>Enter the new name and dates, upload the CSV files, then type the confirmation phrase. The new event starts without results.</span></li></ol></section>
  <section class="ad-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Downloads</p><h2>Ready-to-fill files</h2></div></div><div class="ad-stage-form"><button type="button" class="ad-outline" data-csv-template="bouts">Blank bout roster CSV</button><button type="button" class="ad-outline" data-csv-template="poomsae">Blank Poomsae CSV</button><button type="button" class="ad-outline" data-csv-template="example-bouts">Example bout roster CSV</button><button type="button" class="ad-outline" data-csv-template="example-poomsae">Example Poomsae CSV</button></div></section></div>
  <section class="ad-panel ad-guide-section"><div class="ad-panel-title"><div><p class="ad-kicker">Bout roster</p><h2>Required fields</h2></div></div><div class="ad-guide-table-wrap"><table class="ad-guide-table"><thead><tr><th>Column</th><th>What to enter</th></tr></thead><tbody><tr><td>day</td><td>1 (PERLIS is Day 1 only)</td></tr><tr><td>event</td><td>Exact discipline name, consistent for all athletes in one bracket</td></tr><tr><td>team</td><td>Team name shown publicly and used for medal tally</td></tr><tr><td>competitor_no</td><td>Unique identifier within the day and event</td></tr><tr><td>name</td><td>Full player name</td></tr><tr><td>category</td><td>Exact category name, identical for everyone in that bracket</td></tr><tr><td>first_bout, bout_2…bout_5</td><td>Final match first, then earlier rounds; use A–J ring prefix and a number</td></tr><tr><td>first_corner, corner_2…corner_5</td><td>B = Chung; R = Hong, paired with each occupied bout</td></tr></tbody></table></div><div class="ad-guide-example"><strong>Four-player bracket example</strong><p>A001 and A002 are semifinals. Their winners meet in final A003.</p><pre>${escapeHtml(boutCsvExample)}</pre></div></section>
  <div class="ad-guide-grid"><section class="ad-panel ad-guide-section"><div class="ad-panel-title"><div><p class="ad-kicker">Poomsae</p><h2>Single-round entries</h2></div></div><div class="ad-guide-example"><p>Use a unique E, F or G code in competitor_no. Assign placings 1–4 directly for the top entries.</p><pre>${escapeHtml(poomsaeCsvExample)}</pre></div></section><section class="ad-panel ad-guide-section"><div class="ad-panel-title"><div><p class="ad-kicker">Manual reset</p><h2>Reset scopes</h2></div></div><div class="ad-guide-example"><p><strong>Results and awards only</strong> clears winners, Poomsae placings and medal delivery. It keeps imported athletes, qualifiers, transfers and ring order.</p><p><strong>All competition operations</strong> also removes added athletes, qualifying bouts, transfers and schedule changes. It keeps the base roster, event name, dates and staff PINs. Both scopes leave a reset entry in the audit log.</p></div></section></div>
  <section class="ad-panel ad-guide-section"><div class="ad-panel-title"><div><p class="ad-kicker">For an AI assistant</p><h2>Copy this preparation brief</h2></div><button class="ad-outline" id="copy-template-brief" type="button">Copy brief</button></div><pre class="ad-ai-brief" id="template-ai-brief">${escapeHtml(aiBrief)}</pre><p class="ad-guide-copy-status" role="status"></p></section>`;
}
function adminPoomsaeContent() {
  const all = data.poomsae.filter(g => role === 'admin' ? ring === 'ALL' || g.ring === ring : g.ring === coordinatorRing);
  const filteredGroups = all.filter(g => !poomsaeQuery || `${g.category} ${g.entrants.map(e => `${e.name} ${e.team}`).join(' ')}`.toLowerCase().includes(poomsaeQuery.toLowerCase()));
  const group = all.find(g => g.category === poomsaeCategory) || filteredGroups[0] || all[0];
  poomsaeCategory = group?.category || '';
  const recorded = all.reduce((sum,g) => sum + g.entrants.filter(e => e.rank !== null).length,0);
  return `<div class="ad-page-head"><div><p class="ad-kicker">Ring G001–G032 · group scoring</p><h1>Poomsae scores</h1><p>G001–G032 use group scoring. Enter every participant’s score together and save once; placings follow the scores. For equal scores, enter referee-confirmed placings. G033 onward uses knockout bouts in the Bout queue.</p></div></div>
  <div class="ad-award-stats"><div><strong>${all.length}</strong><span>Categories</span></div><div><strong>${all.reduce((sum,g) => sum + g.entrants.length,0)}</strong><span>Entries</span></div><div><strong>${recorded}</strong><span>Results recorded</span></div><div><strong>${all.filter(g => g.finished).length}</strong><span>Categories finished</span></div></div>
  <div class="ad-filter-panel"><label>Ring<select id="poomsae-ring" ${role !== 'admin' ? 'disabled' : ''}><option value="ALL">All Poomsae rings</option>${['E','F','G'].map(r => `<option value="${r}" ${r === ring ? 'selected' : ''}>Ring ${r}</option>`).join('')}</select></label></div><div class="ad-pro-layout"><section class="ad-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Categories</p><h2>Choose category</h2></div><span>${filteredGroups.length} shown</span></div><div class="ad-pro-search"><label>Search category or athlete<input id="poomsae-search" value="${escapeAttr(poomsaeQuery)}" placeholder="Category, athlete or team"></label></div><div class="ad-pro-categories">${filteredGroups.map(g => `<button data-poomsae-category="${escapeAttr(g.category)}" class="${g.category === poomsaeCategory ? 'active' : ''}"><span><strong>Ring ${g.ring} · ${escapeHtml([...new Set(g.entrants.map(e => e.performanceNo).filter(Boolean))].join(' / '))} · ${escapeHtml(g.category)}</strong><small>${g.entrants.filter(e => e.performed).length} / ${g.entrants.length} performed · ${g.entrants.length} entries · ${g.entrants.filter(e => e.rank !== null).length} placed</small></span><span class="award-state ${g.finished ? 'delivered' : ''}">${g.finished ? 'Finished' : 'Open'}</span></button>`).join('') || '<div class="ad-panel-empty">No categories match this search.</div>'}</div></section>
  <section class="ad-panel ad-pro-scoring"><div class="ad-panel-title"><div><p class="ad-kicker">Placings</p><h2>${group ? 'Ring ' + group.ring + ' · ' : ''}${escapeHtml(group?.category || 'Select a category')}</h2></div><span>Score together</span></div>${group ? `<form id="poomsae-form"><div class="ad-pro-table-head"><span>Entry / athlete</span><span>Team</span><span>Placing / tie-break</span><span>Score (0–10)</span></div><div class="ad-pro-rows">${group.entrants.map(e => `<div class="ad-pro-row"><div><b>${escapeHtml(e.performanceNo || e.code)}</b><strong>${escapeHtml(e.name)}</strong></div><span class="ad-pro-team">${escapeHtml(e.team)}</span><label><span class="sr-only">Placing for ${escapeAttr(e.name)}</span><select data-poomsae-placement="${escapeAttr(e.code)}" aria-label="Placing for ${escapeAttr(e.name)}"><option value="" ${(poomsaeDraft.has(e.code) ? poomsaeDraft.get(e.code) : e.rank) == null || poomsaeDraft.get(e.code) === '' ? 'selected' : ''}>—</option>${[1,2,3,4].filter(rank => rank <= group.entrants.length).map(rank => `<option value="${rank}" ${Number(poomsaeDraft.has(e.code) ? poomsaeDraft.get(e.code) : e.rank) === rank ? 'selected' : ''}>${rank}</option>`).join('')}</select></label><label><span class="sr-only">Score for ${escapeAttr(e.name)}</span><input type="number" inputmode="decimal" min="0" max="10" step="0.001" required data-poomsae-score="${escapeAttr(e.code)}" aria-label="Score for ${escapeAttr(e.name)}" value="${escapeAttr(poomsaeScoreDraft.has(e.code) ? poomsaeScoreDraft.get(e.code) : e.score ?? '')}"></label></div>`).join('')}</div><div class="ad-pro-actions"><span>${group.finished ? 'Placings complete. Public results are live.' : 'Enter all scores, then save the whole group. Placings are calculated from highest to lowest score.'}</span><button class="ad-primary" type="submit">Save all scores</button><button class="ad-outline" type="button" id="save-manual-placings">Save referee placings only</button><p class="form-error" role="alert"></p></div></form>` : ''}</section></div>`;
}
function adminAwardsContent() {
  const all = data.awards.filter(a => a.day === day);
  const queue = all.filter(a => !a.autoRing);
  const counts = { FINISHED: queue.filter(a => a.finished).length, CALLED: queue.filter(a => a.status === 'CALLED').length, DELIVERED: queue.filter(a => a.status === 'DELIVERED').length, PENDING:queue.filter(a => a.finished).reduce((total,a) => total + a.medals.filter(m => m.state === 'PENDING').length,0) };
  const selected = all.filter(a => a.finished && !archivedAward(a) && (awardAdminRing === 'ALL' || a.ring === awardAdminRing) && (awardAdminStatus === 'ALL' || a.status === awardAdminStatus) && (!awardAdminQuery || `${a.ring} ${a.category} ${a.event} ${a.medals.map(m => `${label(m.athleteId)} ${athlete(m.athleteId)?.team || ''}`).join(' ')}`.toLowerCase().includes(awardAdminQuery.toLowerCase())))
    .sort((a,b) => ({ CALLED:0, NOT_CALLED:1, DELIVERED:2, DELIVERED_IN_RING:3 })[a.status] - ({ CALLED:0, NOT_CALLED:1, DELIVERED:2, DELIVERED_IN_RING:3 })[b.status] || a.ring.localeCompare(b.ring) || a.category.localeCompare(b.category));
  const pageSize = 15, pages = Math.max(1,Math.ceil(selected.length/pageSize));
  awardAdminPage = Math.min(awardAdminPage,pages-1);
  return `<div class="ad-page-head"><div><p class="ad-kicker">Medal operations</p><h1>Awards desk</h1><p>Finished categories appear automatically. Call athletes to the podium, then record delivery or absence.</p></div><a class="ad-public-link" href="/awards" target="_blank">Open public awards ↗</a></div>
  <div class="ad-award-stats"><div><strong>${counts.CALLED}</strong><span>Called to podium</span></div><div><strong>${counts.DELIVERED}</strong><span>Delivered</span></div><div><strong>${counts.FINISHED}</strong><span>Finished podium categories</span></div><div><strong>${counts.PENDING}</strong><span>Medals awaiting delivery</span></div></div>
  <section class="ad-panel ad-awards-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Category tracker</p><h2>Medal presentations</h2></div><a class="ad-public-link" href="/admin/awards/history?day=${day}">Delivered history ↗</a></div>
  <div class="ad-award-filters"><label>Search<input id="award-admin-search" placeholder="Category, athlete, team or ring" value="${escapeAttr(awardAdminQuery)}"></label><label>Ring<select id="award-admin-ring"><option value="ALL">All rings</option>${ringSelectOptions(awardAdminRing)}</select></label><label>Status<select id="award-admin-status">${[['ALL','All statuses'],['CALLED','Called']].map(([value,name]) => `<option value="${value}" ${awardAdminStatus === value ? 'selected' : ''}>${name}</option>`).join('')}</select></label></div>
  <div class="ad-award-list">${selected.slice(awardAdminPage*pageSize,(awardAdminPage+1)*pageSize).map(a => `<article class="ad-award-row"><div class="ad-award-row-head"><div><strong>${escapeHtml(a.category)}</strong><small>Ring ${escapeHtml(a.ring)} · ${escapeHtml(formattedEvent(a.event))} · ${a.event === 'POOMSAE PRO' ? 'Single-round placings' : `Final ${escapeHtml(a.finalCode)}`}</small></div><span class="award-state ${a.status.toLowerCase()}">${awardStatusText[a.status]}</span></div>${a.medals.length ? `<div class="ad-award-people">${a.medals.map(m => `<div class="ad-award-person ${m.medal.toLowerCase()}"><span class="award-medal ${m.medal.toLowerCase()}">${escapeHtml(m.medal)}</span><div><strong>${escapeHtml(label(m.athleteId))}</strong><small>${escapeHtml(athlete(m.athleteId)?.team || 'Team not listed')}</small></div><span class="award-person-state ${m.state.toLowerCase()}">${medalStateText[m.state]}</span>${!a.autoRing ? `<div class="ad-award-person-actions"><button data-award-medal="${escapeAttr(a.id)}" data-award-athlete="${escapeAttr(m.athleteId)}" data-award-state="DELIVERED" ${a.status === 'NOT_CALLED' || m.state === 'DELIVERED' ? 'disabled' : ''}>Delivered</button><button data-award-medal="${escapeAttr(a.id)}" data-award-athlete="${escapeAttr(m.athleteId)}" data-award-state="ABSENT" ${a.status === 'NOT_CALLED' || m.state === 'ABSENT' ? 'disabled' : ''}>Absent</button>${m.state !== 'PENDING' ? `<button data-award-medal="${escapeAttr(a.id)}" data-award-athlete="${escapeAttr(m.athleteId)}" data-award-state="PENDING">Reset</button>` : ''}</div>` : ''}</div>`).join('')}</div>` : '<div class="ad-award-pending">Waiting for category to finish.</div>'}<div class="ad-award-row-foot">${a.autoRing ? '<span>Medals are delivered at the ring when this category finishes.</span>' : a.status === 'NOT_CALLED' ? '<span>Podium call becomes available when all bouts finish.</span>' : `<button data-award-call="${escapeAttr(a.id)}">${a.callCount ? 'Call names again' : 'Call names'}</button>`}</div></article>`).join('') || `<div class="ad-panel-empty">${all.some(a => a.finished) ? 'No categories are awaiting presentation.' : 'Finished categories will appear here automatically.'}</div>`}</div>
  ${pages > 1 ? `<div class="ad-pagination"><span>Page ${awardAdminPage+1} of ${pages}</span><div><button data-award-admin-page="prev" ${awardAdminPage === 0 ? 'disabled' : ''}>Previous</button><button data-award-admin-page="next" ${awardAdminPage === pages-1 ? 'disabled' : ''}>Next</button></div></div>` : ''}</section>`;
}
function adminAwardsHistoryContent() {
  const selected = data.awards.filter(a => a.day === day && a.finished && archivedAward(a) && (awardAdminRing === 'ALL' || a.ring === awardAdminRing) && (!awardAdminQuery || `${a.ring} ${a.category} ${a.event} ${a.medals.map(m => `${label(m.athleteId)} ${athlete(m.athleteId)?.team || ''}`).join(' ')}`.toLowerCase().includes(awardAdminQuery.toLowerCase())))
    .sort((a,b) => String(b.deliveredAt || '').localeCompare(String(a.deliveredAt || '')));
  const pageSize = 15, pages = Math.max(1,Math.ceil(selected.length/pageSize));
  awardAdminPage = Math.min(awardAdminPage,pages-1);
  return `<div class="ad-page-head"><div><p class="ad-kicker">Medal operations</p><h1>Delivered history</h1><p>Completed presentations with timestamps in Malaysia time (MYT).</p></div><a class="ad-public-link" href="/admin/awards?day=${day}">← Awards desk</a></div><section class="ad-panel ad-awards-panel"><div class="ad-panel-title"><h2>Completed categories</h2><span>${selected.length} shown</span></div><div class="ad-award-filters"><label>Search<input id="award-admin-search" placeholder="Category, athlete, team or ring" value="${escapeAttr(awardAdminQuery)}"></label><label>Ring<select id="award-admin-ring"><option value="ALL">All rings</option>${ringSelectOptions(awardAdminRing)}</select></label></div><div class="ad-award-list">${selected.slice(awardAdminPage*pageSize,(awardAdminPage+1)*pageSize).map(a => `<article class="ad-award-row"><div class="ad-award-row-head"><div><strong>${escapeHtml(a.category)}</strong><small>Ring ${escapeHtml(a.ring)} · ${escapeHtml(formattedEvent(a.event))} · ${escapeHtml(malaysiaTime(a.deliveredAt))}</small></div><span class="award-state ${a.status.toLowerCase()}">${awardStatusText[a.status]}</span></div><div class="ad-award-people">${a.medals.map(m => `<div class="ad-award-person ${m.medal.toLowerCase()}"><span class="award-medal ${m.medal.toLowerCase()}">${escapeHtml(m.medal)}</span><div><strong>${escapeHtml(label(m.athleteId))}</strong><small>${escapeHtml(athlete(m.athleteId)?.team || 'Team not listed')}</small></div><span class="award-person-state ${m.state.toLowerCase()}">${medalStateText[m.state]}</span>${!a.autoRing ? `<div class="ad-award-person-actions"><button data-award-medal="${escapeAttr(a.id)}" data-award-athlete="${escapeAttr(m.athleteId)}" data-award-state="PENDING">Reset</button></div>` : ''}</div>`).join('')}</div></article>`).join('') || '<div class="ad-panel-empty">No completed presentations match these filters.</div>'}</div>${pages > 1 ? `<div class="ad-pagination"><span>Page ${awardAdminPage+1} of ${pages}</span><div><button data-award-admin-page="prev" ${awardAdminPage === 0 ? 'disabled' : ''}>Previous</button><button data-award-admin-page="next" ${awardAdminPage === pages-1 ? 'disabled' : ''}>Next</button></div></div>` : ''}</section>`;
}
function adminLayout() {
  if (!token) return `<div class="ad-login-shell"><div class="ad-login-brand"><span><img src="/mtkd-logo.png" alt="MTKD logo"></span><strong>Championship operations</strong></div>${notice ? `<div class="notice" role="status">${escapeHtml(notice)}<button id="dismiss">×</button></div>` : ''}<div class="login-panel"><p class="eyebrow">Officials only</p><h1>Sign in to control room</h1><p>Choose your ring or role and use the shared six-digit staff PIN. Lead admins use their admin password.</p><form id="login"><label>Staff role<select id="login-ring">${ringSelectOptions(ring === 'ALL' ? 'A' : ring)}${awardPinOption}</select></label><label>PIN or admin password<input type="password" id="password" autocomplete="current-password" required></label><button class="ad-primary">Sign in</button></form><a href="/">← Return to public view</a></div></div>`;
  const nav = role === 'awards' ? [['awards','Awards desk'],['awardsHistory','Delivered history']] : [['dashboard','Overview'],['bouts','Bout queue'],...(role === 'admin' || poomsaeRing(coordinatorRing) ? [['poomsae','Poomsae results']] : []),...(role === 'admin' ? [['awards','Awards desk'],['awardsHistory','Delivered history'],['transfer','Bulk transfer'],['qualifying','Categories & players'],['coordinators','Staff PIN'],['tournament','Tournament setup'],['templateGuide','Guide & templates']] : [])];
  const content = ({dashboard:adminDashboardContent,bouts:adminBoutsContent,poomsae:adminPoomsaeContent,awards:adminAwardsContent,awardsHistory:adminAwardsHistoryContent,transfer:adminTransferContent,qualifying:adminQualifyingContent,coordinators:adminCoordinatorContent,tournament:adminTournamentContent,templateGuide:adminTemplateGuideContent})[adminSection]?.() || (role === 'awards' ? adminAwardsContent() : adminDashboardContent());
  return `<div class="ad-app"><aside class="ad-sidebar"><div class="ad-side-brand"><span><img src="/mtkd-logo.png" alt="MTKD logo"></span><div><strong>${escapeHtml(data.event.shortName)}</strong><small>CONTROL CENTER</small></div></div><div class="ad-side-caption">WORKSPACE</div><nav aria-label="Admin menu">${nav.map(([id,name]) => `<a href="${adminHref(id)}?day=${day}" class="${adminSection === id ? 'active' : ''}" ${adminSection === id ? 'aria-current="page"' : ''}><span>${name}</span>${id === 'bouts' ? `<em>${data.bouts.filter(b => b.day === day && (role === 'admin' || assignedRing(b) === coordinatorRing) && b.status === 'READY').length}</em>` : ''}</a>`).join('')}</nav><div class="ad-sidebar-bottom"><span>${role === 'admin' ? 'Lead administrator' : role === 'awards' ? 'Awards staff' : `Ring ${coordinatorRing} coordinator`}</span><a href="/">Public site ↗</a><button id="logout">Sign out</button></div></aside><div class="ad-workspace"><header class="ad-topbar"><div class="ad-mobile-brand"><img src="/mtkd-logo.png" alt="MTKD logo"> <strong>${escapeHtml(data.event.shortName)} Control center</strong></div><div class="ad-topbar-label"><span class="ad-live-indicator"></span> Competition operations <small>${escapeHtml(data.event.dates.join(" · "))}</small></div><div class="ad-topbar-actions"><span class="day-label">Day 1</span><span class="ad-user-badge">${role === 'admin' ? 'Lead admin' : role === 'awards' ? 'Awards desk' : `Ring ${coordinatorRing}`}</span><a class="ad-mobile-public" href="/" aria-label="Public site">↗</a><button class="ad-mobile-logout" type="button">Sign out</button></div></header><div class="ad-mobile-nav">${nav.map(([id,name]) => `<a href="${adminHref(id)}?day=${day}" class="${adminSection === id ? 'active' : ''}" ${adminSection === id ? 'aria-current="page"' : ''}>${name}</a>`).join('')}</div><main class="ad-main">${notice ? `<div class="notice" role="status">${escapeHtml(notice)}<button id="dismiss">×</button></div>` : ''}${content}</main></div><div id="modal-root"></div></div>`;
}
function render() {
  if (!data) return;
  document.title = `${isAdminPage ? "Admin" : "Tournament"} · ${data.event.name}`;
  if (isAdminPage) { root.innerHTML = adminLayout(); attach(); return; }
  root.innerHTML = `<header class="masthead"><div class="mast-inner"><div class="brand"><div class="brand-mark"><img src="/mtkd-logo.png" alt="MTKD logo"></div><div><span>TAEKWONDO CHAMPIONSHIP</span><strong>${escapeHtml(data.event.shortName)}</strong></div></div><div class="mast-meta"><span class="live-dot"></span> Competition operations <small>${escapeHtml(data.event.dates.join(" · "))}</small></div></div></header>
    <main><div class="title-row"><div><p class="eyebrow">${escapeHtml(data.event.name)}</p><h1>${isAdminPage ? 'Admin control room' : ({live:'Live competition',schedule:'Match schedule',brackets:'Competition brackets',teams:'Teams',results:'Results',awards:'Awards',awardsHistory:'Delivered awards'})[view]}</h1><p class="subtitle">${view === 'teams' ? 'Find every competition path for your team and players.' : view === 'results' ? 'Completed category results and team medal standings.' : isAdminPage ? 'Manage bouts and official results.' : 'Competition paths and live tournament information.'}</p></div><div class="data-note">${data.athletes.length.toLocaleString()} entries · ${data.bouts.length.toLocaleString()} bouts</div></div>
    ${isAdminPage ? '<div class="admin-nav"><a href="/">← Public view</a></div>' : tabs()}${notice ? `<div class="notice" role="status">${escapeHtml(notice)}<button id="dismiss">×</button></div>` : ''}
    ${( { live, schedule, brackets, teams, results: resultView, awards: awardsView, awardsHistory: awardsHistoryView })[view]()}</main><footer class="site-footer"><div class="site-footer-inner"><div class="site-footer-identity"><small>${escapeHtml(data.event.shortName)}</small><strong>${escapeHtml(data.event.name)}</strong><span>${escapeHtml(data.event.dates.join(" · "))}</span></div><div class="site-footer-credit"><span>Powered by</span><img src="/mtkd-logo.png" alt="MTKD logo"></div></div></footer><div id="modal-root"></div>`;
  attach();
}
function attach() {
  document.querySelector('#event-settings-form')?.addEventListener('submit', async e => {
    e.preventDefault(); const form = e.currentTarget, values = Object.fromEntries(new FormData(form));
    try { await api('/api/admin/tournament-settings', { method:'POST', body:JSON.stringify({ version:data.version, event:{ name:values.name, shortName:values.shortName, dates:[values.date1] } }) }); notice = 'Event details saved'; await refresh(); }
    catch (error) { form.querySelector('.form-error').textContent = error.message; }
  });
  document.querySelector('#tournament-reset-form')?.addEventListener('submit', async e => {
    e.preventDefault(); const form = e.currentTarget, values = new FormData(form), button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/api/admin/tournament-reset', { method:'POST', body:JSON.stringify({ version:data.version, scope:values.get('scope'), confirm:values.get('confirm') }) });
      notice = values.get('scope') === 'operations' ? 'Tournament operations reset' : 'Results, marks and awards reset';
      await refresh();
    } catch (error) { form.querySelector('.form-error').textContent = error.message; button.disabled = false; }
  });
  document.querySelector('#copy-template-brief')?.addEventListener('click', async () => {
    const message = document.querySelector('.ad-guide-copy-status');
    try { await navigator.clipboard.writeText(document.querySelector('#template-ai-brief').textContent); message.textContent = 'Brief copied'; }
    catch { message.textContent = 'Copy unavailable in this browser. Select the text above to copy it.'; }
  });
  document.querySelectorAll('[data-results-export]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const medals = button.dataset.resultsExport === 'medals';
      const response = await fetch(medals ? '/api/medal-results.csv' : '/api/export.csv', { headers:{ Authorization:`Bearer ${token}` } });
      if (!response.ok) throw Error((await response.json()).error || 'Export failed');
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
      link.href = url; link.download = medals ? 'perlis-medal-results.csv' : 'perlis-results.csv'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) { notice = error.message; render(); }
    finally { button.disabled = false; }
  }));
  document.querySelector('#download-tournament')?.addEventListener('click', async e => {
    const button = e.currentTarget; button.disabled = true;
    try {
      const response = await fetch('/api/admin/tournament-export', { headers:{ Authorization:`Bearer ${token}` } });
      if (!response.ok) throw Error((await response.json()).error || 'Export failed');
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
      link.href = url; link.download = `${data.event.shortName.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}-backup.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) { button.parentElement.querySelector('.form-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
  document.querySelectorAll('[data-csv-template]').forEach(button => button.addEventListener('click', () => {
    const kind = button.dataset.csvTemplate;
    const headers = kind === 'example-bouts' ? boutCsvExample : kind === 'example-poomsae' ? poomsaeCsvExample : kind === 'bouts' ?
      'day,event,source_pdf,source_page,team,competitor_no,name,name_truncated_in_pdf,category,first_bout,first_corner,bout_2,corner_2,bout_3,corner_3,bout_4,corner_4,bout_5,corner_5' :
      'day,event,team,competitor_no,name,category';
    const url = URL.createObjectURL(new Blob(['\uFEFF' + headers + '\r\n'], { type:'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${kind}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }));
  document.querySelector('#tournament-import-form')?.addEventListener('submit', async e => {
    e.preventDefault(); const form = e.currentTarget, values = new FormData(form), button = form.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const [boutsCsv,poomsaeCsv] = await Promise.all([values.get('boutsCsv').text(), values.get('poomsaeCsv')?.size ? values.get('poomsaeCsv').text() : '']);
      const body = { version:data.version, confirm:values.get('confirm'), event:{ name:values.get('name'), shortName:values.get('shortName'), dates:[values.get('date1')] }, boutsCsv, poomsaeCsv };
      const answer = await api('/api/admin/tournament-import', { method:'POST', body:JSON.stringify(body) });
      notice = `New tournament loaded: ${answer.athletes} athletes and ${answer.bouts} bouts`; await refresh();
    } catch (error) { form.querySelector('.form-error').textContent = error.message; button.disabled = false; }
  });
  initBracketZoom();
  document.querySelectorAll('[data-admin-section]').forEach(el => el.onclick = () => { const params = new URLSearchParams({ day:String(day) }); if (el.dataset.status) params.set('status',el.dataset.status); location.href = `${adminHref(el.dataset.adminSection)}?${params}`; });
  document.querySelectorAll('[data-open-ring]').forEach(el => el.onclick = () => { location.href = `${adminHref('bouts')}?day=${day}&ring=${el.dataset.openRing}`; });
  document.querySelectorAll('[data-open-pro]').forEach(el => el.onclick = () => { location.href = '/admin/poomsae-pro?day=1&ring=' + el.dataset.openPro; });
  document.querySelectorAll('[data-admin-page]').forEach(el => el.onclick = () => { adminPage += el.dataset.adminPage === 'next' ? 1 : -1; render(); document.querySelector('.ad-queue-panel')?.scrollIntoView({block:'start'}); });
  document.querySelector('#admin-ring-select')?.addEventListener('change', e => { ring = e.target.value; adminPage = 0; render(); });
  document.querySelectorAll('[data-view]').forEach(el => el.onclick = () => { location.href = `${publicHref[el.dataset.view]}?day=${day}`; });
  document.querySelectorAll('[data-results-day]').forEach(el => el.onclick = () => { location.href = `/results?day=${el.dataset.resultsDay}`; });
  document.querySelectorAll('[data-day]').forEach(el => el.onclick = () => { location.href = `${location.pathname}?day=${el.dataset.day}`; });
  document.querySelector('#team-team')?.addEventListener('change', e => { teamTeam = e.target.value; teamPage = 0; render(); });
  document.querySelector('#team-player-search')?.addEventListener('input', e => { teamQuery = e.target.value; teamPage = 0; const pos = e.target.selectionStart; render(); const input = document.querySelector('#team-player-search'); input?.focus(); input?.setSelectionRange(pos, pos); });
  document.querySelectorAll('[data-team-page]').forEach(el => el.onclick = () => { teamPage += el.dataset.teamPage === 'next' ? 1 : -1; render(); document.querySelector('.team-results-heading')?.scrollIntoView({ block:'start' }); });
  document.querySelector('#export-overall-pdf')?.addEventListener('click', exportOverallPdf);
  document.querySelector('#results-event')?.addEventListener('change', e => { tallyEvent = e.target.value; awardPublicPage = 0; render(); });
  document.querySelector('#tally-preset')?.addEventListener('change', e => { tallyPreset = e.target.value; render(); });
  document.querySelector('#tally-gender')?.addEventListener('change', e => { tallyGender = e.target.value; render(); });
  document.querySelectorAll('[data-tally-event]').forEach(el => el.onclick = () => { tallyEvent = el.dataset.tallyEvent; tallyScope = 'ALL'; tallyAge = 'ALL'; awardPublicPage = 0; render(); });
  document.querySelectorAll('[data-tally-age]').forEach(el => el.onclick = () => { tallyAge = el.dataset.tallyAge; tallyScope = 'ALL'; render(); });
  document.querySelectorAll('[data-tally-scope]').forEach(el => el.onclick = () => { tallyScope = el.dataset.tallyScope; render(); });
  document.querySelectorAll('[data-admin-ring]').forEach(el => el.onclick = () => { ring = el.dataset.adminRing; query = ''; render(); });
  document.querySelector('#admin-status')?.addEventListener('change', e => { adminStatus = e.target.value; adminPage = 0; render(); });
  document.querySelectorAll('[data-plan-ring]').forEach(el => el.onclick = () => { ring = el.dataset.planRing; event = activePlan(day).find(item => item.ring === ring)?.event || event; query = ''; render(); });
  document.querySelector('#search')?.addEventListener('input', e => { query = e.target.value; adminPage = 0; const pos = e.target.selectionStart; render(); const input = document.querySelector('#search'); input.focus(); input.setSelectionRange(pos,pos); });
  document.querySelector('#dismiss')?.addEventListener('click', () => { notice = ''; render(); });
  document.querySelectorAll('#logout,.ad-mobile-logout').forEach(el => el.addEventListener('click', () => { token = ''; role = ''; coordinatorRing = ''; ['perlis-token','perlis-role','perlis-ring'].forEach(key => sessionStorage.removeItem(key)); notice = 'Signed out'; render(); }));
  document.querySelector('#login')?.addEventListener('submit', async e => { e.preventDefault(); try { const value = document.querySelector('#password').value, loginRing = document.querySelector('#login-ring').value; const answer = await api('/api/login',{method:'POST',body:JSON.stringify({password:value,pin:value,ring:loginRing})}); token = answer.token; role = answer.role; coordinatorRing = answer.ring || ''; ring = role === 'coordinator' ? coordinatorRing : 'ALL'; adminSection = role === 'awards' ? 'awards' : adminSection; day = coordinatorDay2Locked() ? 1 : day; sessionStorage.setItem('perlis-token',token); sessionStorage.setItem('perlis-role',role); sessionStorage.setItem('perlis-ring',coordinatorRing); notice = 'Signed in'; render(); } catch (error) { notice = error.message; render(); } });
  const restoreTransferScroll = () => { const source = document.querySelector('#transfer-source-list'), target = document.querySelector('#transfer-target-list'); if (source) source.scrollTop = transferSourceScroll; if (target) target.scrollTop = transferTargetScroll; };
  const rememberTransferScroll = () => { transferSourceScroll = document.querySelector('#transfer-source-list')?.scrollTop || 0; transferTargetScroll = document.querySelector('#transfer-target-list')?.scrollTop || 0; };
  restoreTransferScroll();
  document.querySelector('#transfer-source-list')?.addEventListener('scroll', e => { transferSourceScroll = e.target.scrollTop; });
  document.querySelector('#transfer-target-list')?.addEventListener('scroll', e => { transferTargetScroll = e.target.scrollTop; });
  document.querySelector('#transfer-mode')?.addEventListener('change', e => { transferMode = e.target.value; transferStart = transferEnd = null; transferAfterId = ''; render(); });
  document.querySelectorAll('[data-transfer-source]').forEach(el => el.onclick = () => { transferSourceRing = el.dataset.transferSource; transferPrefix = [...new Set(transferEntries().filter(b => b.day === day && assignedRing(b) === transferSourceRing).map(b => b.code[0]))].sort()[0] || transferSourceRing; transferStart = transferEnd = null; transferSourceScroll = 0; render(); });
  document.querySelectorAll('[data-transfer-prefix]').forEach(el => el.onclick = () => { transferPrefix = el.dataset.transferPrefix; transferStart = transferEnd = null; transferSourceScroll = 0; render(); });
  document.querySelectorAll('[data-transfer-target]').forEach(el => el.onclick = () => { transferTargetRing = el.dataset.transferTarget; transferAfterId = 'END'; transferTargetScroll = 0; render(); });
  document.querySelectorAll('[data-transfer-boundary]').forEach(el => el.onclick = () => { rememberTransferScroll(); if (el.dataset.transferBoundary === 'start') transferStart = Number(el.dataset.number); else transferEnd = Number(el.dataset.number); render(); });
  document.querySelectorAll('[data-transfer-after]').forEach(el => el.onclick = () => { rememberTransferScroll(); transferAfterId = el.dataset.transferAfter; render(); });
  const transferSearch = (selector,key) => document.querySelector(selector)?.addEventListener('input', e => { if (key === 'source') transferQuery = e.target.value; else transferDestinationQuery = e.target.value; const pos = e.target.selectionStart; render(); const input = document.querySelector(selector); input.focus(); input.setSelectionRange(pos,pos); });
  transferSearch('#transfer-search','source'); transferSearch('#transfer-destination-search','destination');
  document.querySelector('#transfer-table-form')?.addEventListener('submit', async e => { e.preventDefault(); const form = e.target; try { const answer = await api('/api/admin/transfer',{method:'POST',body:JSON.stringify({mode:transferMode,version:data.version,day,sourceRing:transferSourceRing,codePrefix:transferPrefix,targetRing:transferTargetRing,from:Math.min(transferStart,transferEnd),to:Math.max(transferStart,transferEnd),afterBoutId:transferAfterId})}); notice = `${answer.count} bouts transferred to Ring ${transferTargetRing}`; transferStart = transferEnd = null; transferAfterId = ''; transferSourceScroll = transferTargetScroll = 0; await refresh(); } catch (error) { form.querySelector('.form-error').textContent = error.message; } });
  document.querySelector('#qualifying-ring')?.addEventListener('change', e => { qualifyingRing = e.target.value; qualifyingCategory = 'ALL'; qualifyingPage = 0; render(); });
  document.querySelector('#qualifying-category')?.addEventListener('change', e => { qualifyingCategory = e.target.value; qualifyingPage = 0; render(); });
  document.querySelector('#qualifying-search')?.addEventListener('input', e => { qualifyingQuery = e.target.value; qualifyingPage = 0; const pos = e.target.selectionStart; render(); const input = document.querySelector('#qualifying-search'); input.focus(); input.setSelectionRange(pos,pos); });
  document.querySelectorAll('[data-qualifying-pro-category]').forEach(el => el.onclick = () => { const group = data.poomsae.find(g => g.category === el.dataset.qualifyingProCategory); qualifyingSelectedId = group?.id || ''; render(); document.querySelector('#pro-entry-stage-form')?.scrollIntoView({block:'nearest'}); });
  document.querySelector('#pro-entry-stage-form')?.addEventListener('submit', e => { e.preventDefault(); const form = e.target, item = Object.fromEntries(new FormData(form)); item.category = item.category.trim(); item.name = item.name.trim(); item.team = item.team.trim(); if (!item.category || !item.name || !item.team) { form.querySelector('.form-error').textContent = 'Enter the category, athlete and team.'; return; } if (proEntryDraft.some(d => d.category.toLowerCase() === item.category.toLowerCase() && d.name.toLowerCase() === item.name.toLowerCase() && d.team.toLowerCase() === item.team.toLowerCase())) { form.querySelector('.form-error').textContent = 'This athlete is already staged.'; return; } item.ring = qualifyingRing === 'SCORED' ? 'G' : qualifyingRing; proEntryDraft.push(item); notice = `${proEntryDraft.length} Poomsae athlete${proEntryDraft.length === 1 ? '' : 's'} staged`; render(); });
  document.querySelectorAll('[data-remove-pro-draft]').forEach(el => el.onclick = () => { proEntryDraft.splice(Number(el.dataset.removeProDraft),1); render(); });
  document.querySelector('#save-pro-entry-draft')?.addEventListener('click', async () => { const button = document.querySelector('#save-pro-entry-draft'); button.disabled = true; try { const answer = await api('/api/admin/poomsae-entries',{method:'POST',body:JSON.stringify({version:data.version,entries:proEntryDraft})}); notice = `${answer.count} Poomsae athletes saved: ${answer.codes.join(', ')}`; proEntryDraft = []; await refresh(); } catch (error) { const message = document.querySelector('.ad-draft-save .form-error'); if (message) message.textContent = error.message; button.disabled = false; } });
  document.querySelectorAll('[data-qualifying-page]').forEach(el => el.onclick = () => { qualifyingPage += el.dataset.qualifyingPage === 'next' ? 1 : -1; render(); document.querySelector('.ad-match-list')?.scrollIntoView({block:'start'}); });
  document.querySelectorAll('[data-qualifying-target]').forEach(el => el.onclick = () => { qualifyingSelectedId = el.dataset.qualifyingTarget; render(); document.querySelector('.ad-stage-panel')?.scrollIntoView({block:'nearest'}); });
  document.querySelector('#qualifying-assigned-ring')?.addEventListener('change', e => { const selectedRing = e.target.value, select = document.querySelector('#qualifying-after'); select.innerHTML = '<option value="">Start of ring</option>' + data.bouts.filter(b => b.day === day && assignedRing(b) === selectedRing).sort(scheduleSort).map(b => `<option value="${escapeAttr(b.id)}">${escapeHtml(b.code)} · ${escapeHtml(b.category)}</option>`).join(''); });
  for (const [id,draft] of [['category-create-form',categoryCreateDraft],['category-player-form',categoryPlayerDraft]]) {
    document.getElementById(id)?.addEventListener('input', e => { if (e.target.name) draft[e.target.name] = e.target.value; });
  }
  document.querySelector('#category-player-bout')?.addEventListener('change', e => { categoryPlayerDraft.boutId = e.target.value; render(); });
  document.querySelector('#category-create-form')?.addEventListener('submit', async e => {
    e.preventDefault(); const form = e.target, button = form.querySelector('button'); button.disabled = true;
    try {
      const values = new FormData(form), names = String(values.get('names')).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const answer = await api('/api/admin/categories',{method:'POST',body:JSON.stringify({version:data.version,ring:values.get('ring'),names})});
      categoryCreateDraft.names = '';
      notice = answer.count ? `Created ${answer.count} empty categories: ${answer.codes.join(', ')}` : 'These categories already exist. No duplicates were created.';
      await refresh();
    } catch (error) { form.querySelector('.form-error').textContent = error.message; button.disabled = false; }
  });
  document.querySelector('#category-player-form')?.addEventListener('submit', async e => {
    e.preventDefault(); const form = e.target, button = form.querySelector('button'); button.disabled = true;
    try {
      await api('/api/admin/category-player',{method:'POST',body:JSON.stringify({version:data.version,...Object.fromEntries(new FormData(form))})});
      categoryPlayerDraft.name = ''; categoryPlayerDraft.team = ''; notice = 'Player added to the category'; await refresh();
    } catch (error) { form.querySelector('.form-error').textContent = error.message; button.disabled = false; }
  });
  document.querySelector('#qualifying-stage-form')?.addEventListener('submit', e => { e.preventDefault(); const form = e.target, targetBoutId = qualifyingSelectedId, entry = { ...Object.fromEntries(new FormData(form)),targetBoutId }; if (qualifyingDraft.some(item => item.targetBoutId === targetBoutId && item.sourceAthleteId === entry.sourceAthleteId)) { form.querySelector('.form-error').textContent = 'This athlete slot is already staged.'; return; } qualifyingDraft.push(entry); notice = `${qualifyingDraft.length} qualifying bout${qualifyingDraft.length === 1 ? '' : 's'} staged`; render(); });
  document.querySelectorAll('[data-remove-draft]').forEach(el => el.onclick = () => { qualifyingDraft.splice(Number(el.dataset.removeDraft),1); render(); });
  document.querySelector('#save-qualifying-draft')?.addEventListener('click', async () => { const button = document.querySelector('#save-qualifying-draft'); button.disabled = true; try { const answer = await api('/api/admin/extra-bouts',{method:'POST',body:JSON.stringify({version:data.version,entries:qualifyingDraft})}); notice = `${answer.count} qualifying bouts saved: ${answer.codes.join(', ')}`; qualifyingDraft = []; qualifyingSelectedId = ''; await refresh(); } catch (error) { const message = document.querySelector('.ad-draft-save .form-error'); if (message) message.textContent = error.message; button.disabled = false; } });
  document.querySelector('#pin-form')?.addEventListener('submit', async e => { e.preventDefault(); const form = e.target; try { await api('/api/admin/pin',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))}); notice = 'Shared PIN saved for all rings and awards staff'; await refresh(); } catch (error) { form.querySelector('.form-error').textContent = error.message; } });
  document.querySelector('#poomsae-search')?.addEventListener('input', e => { poomsaeQuery = e.target.value; const pos = e.target.selectionStart; render(); const input = document.querySelector('#poomsae-search'); input?.focus(); input?.setSelectionRange(pos,pos); });
  document.querySelectorAll('[data-poomsae-category]').forEach(el => el.onclick = () => { poomsaeCategory = el.dataset.poomsaeCategory; render(); });
  document.querySelectorAll('[data-poomsae-undo]').forEach(el => el.addEventListener('click', async () => {
    const code = el.dataset.poomsaeUndo, entry = data.poomsae.flatMap(g => g.entrants).find(e => e.code === code);
    if (!entry || !window.confirm(`Clear the saved placing for ${entry.name} (${code})? This will reopen the category and clear its medal delivery records.`)) return;
    el.disabled = true;
    try { await api('/api/admin/poomsae-undo',{method:'POST',body:JSON.stringify({version:data.version,code})}); notice = `${code} placing cleared`; await refresh(); }
    catch (error) { notice = error.message; render(); }
  }));
  document.querySelectorAll('[data-poomsae-score]').forEach(input => input.addEventListener('input', () => poomsaeScoreDraft.set(input.dataset.poomsaeScore,input.value)));
  document.querySelectorAll('[data-poomsae-placement]').forEach(input => input.addEventListener('change', () => poomsaeDraft.set(input.dataset.poomsaePlacement,input.value)));
  document.querySelector('#poomsae-ring')?.addEventListener('change',e => {ring=e.target.value;poomsaeCategory='';render();});
  document.querySelectorAll('[data-poomsae-performed]').forEach(el => el.addEventListener('click',async () => {
    const code=el.dataset.poomsaePerformed;
    const entry=data.poomsae.flatMap(g => g.entrants).find(e => e.code === code);
    el.disabled=true;
    try {
      await api('/api/admin/poomsae-performed',{method:'POST',body:JSON.stringify({version:data.version,code,performed:!entry.performed})});
      notice=entry.performed ? `${code} returned to waiting` : `${code} dah selesai — queue advanced`;
      await refresh();
    } catch(error) {notice=error.message;render();}
  }));
  document.querySelector('#poomsae-form')?.addEventListener('submit', async e => {
    e.preventDefault(); const form = e.target, button = form.querySelector('button[type="submit"]');button.disabled = true;
    const scores = [...form.querySelectorAll('[data-poomsae-score]')].map(input => ({code:input.dataset.poomsaeScore,score:input.value,rank:[...form.querySelectorAll('[data-poomsae-placement]')].find(p => p.dataset.poomsaePlacement === input.dataset.poomsaeScore)?.value}));
    try { await api('/api/admin/poomsae-scores',{method:'POST',body:JSON.stringify({version:data.version,category:poomsaeCategory,ring:data.poomsae.find(g => g.category === poomsaeCategory)?.ring,scores})});scores.forEach(e => {poomsaeDraft.delete(e.code);poomsaeScoreDraft.delete(e.code);});notice = 'All group scores saved together';await refresh(); }
    catch(error) { form.querySelector('.form-error').textContent = error.message;button.disabled = false; }
  });
  document.querySelector('#save-manual-placings')?.addEventListener('click', async e => {
    const form = document.querySelector('#poomsae-form');const placements = [...form.querySelectorAll('[data-poomsae-placement]')].map(input => ({code:input.dataset.poomsaePlacement,rank:input.value}));e.target.disabled = true;
    try {await api('/api/admin/poomsae-placements',{method:'POST',body:JSON.stringify({version:data.version,category:poomsaeCategory,ring:data.poomsae.find(g => g.category === poomsaeCategory)?.ring,placements})});placements.forEach(e => poomsaeDraft.delete(e.code));notice = 'Referee placings saved';await refresh();}
    catch(error) {form.querySelector('.form-error').textContent = error.message;e.target.disabled = false;}
  });
  const awardSearch = (selector,key) => document.querySelector(selector)?.addEventListener('input', e => { if (key === 'admin') { awardAdminQuery = e.target.value; awardAdminPage = 0; } else { awardQuery = e.target.value; awardPublicPage = 0; } const pos = e.target.selectionStart; render(); const input = document.querySelector(selector); input?.focus(); input?.setSelectionRange(pos,pos); });
  awardSearch('#award-search','public'); awardSearch('#award-admin-search','admin');
  document.querySelector('#award-public-status')?.addEventListener('change', e => { awardPublicStatus = e.target.value; awardPublicPage = 0; render(); });
  document.querySelector('#award-admin-status')?.addEventListener('change', e => { awardAdminStatus = e.target.value; awardAdminPage = 0; render(); });
  document.querySelector('#award-admin-ring')?.addEventListener('change', e => { awardAdminRing = e.target.value; awardAdminPage = 0; render(); });
  document.querySelectorAll('[data-award-page]').forEach(el => el.onclick = () => { awardPublicPage += el.dataset.awardPage === 'next' ? 1 : -1; render(); document.querySelector('.awards-directory')?.scrollIntoView({block:'start'}); });
  document.querySelectorAll('[data-award-admin-page]').forEach(el => el.onclick = () => { awardAdminPage += el.dataset.awardAdminPage === 'next' ? 1 : -1; render(); document.querySelector('.ad-awards-panel')?.scrollIntoView({block:'start'}); });
  document.querySelectorAll('[data-award-call]').forEach(el => el.onclick = async () => { el.disabled = true; try { await api('/api/admin/award/call',{method:'POST',body:JSON.stringify({awardId:el.dataset.awardCall})}); notice = 'Podium call recorded'; await refresh(); } catch (error) { notice = error.message; render(); } });
  document.querySelectorAll('[data-award-medal]').forEach(el => el.onclick = async () => { el.disabled = true; try { await api('/api/admin/award/medal',{method:'POST',body:JSON.stringify({awardId:el.dataset.awardMedal,athleteId:el.dataset.awardAthlete,state:el.dataset.awardState})}); notice = el.dataset.awardState === 'ABSENT' ? 'Athlete marked absent' : el.dataset.awardState === 'DELIVERED' ? 'Medal delivery recorded' : 'Medal status reset'; await refresh(); } catch (error) { notice = error.message; render(); } });
  document.querySelectorAll('.record').forEach(el => el.onclick = () => resultModal(el.dataset.bout));
  document.querySelectorAll('.undo').forEach(el => el.onclick = () => undoModal(el.dataset.bout));
}
function modal(inner) { const target = document.querySelector('#modal-root'); target.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${inner}</div></div>`; target.querySelector('.modal-backdrop').onclick = e => { if (e.target.classList.contains('modal-backdrop')) target.innerHTML = ''; }; target.querySelector('.close').onclick = () => target.innerHTML = ''; }
function resultModal(id) {
  const b = data.bouts.find(item => item.id === id);
  modal(`<button class="close" aria-label="Close">×</button><p class="eyebrow">Record result</p><h2>Ring ${escapeHtml(assignedRing(b))} · ${escapeHtml(b.code)}</h2><p class="modal-sub">${formattedEvent(b.event)} · ${escapeHtml(b.category)} · ${roundBadge(b)}</p>${categoryDetails(b)}<form id="result-form"><fieldset><legend>Winner</legend><div class="winner-options"><label class="choice"><input type="radio" name="winner" value="${escapeAttr(b.blueId)}" required><span class="corner b">Chung</span>${escapeHtml(label(b.blueId))}</label><label class="choice"><input type="radio" name="winner" value="${escapeAttr(b.redId)}" required><span class="corner r">Hong</span>${escapeHtml(label(b.redId))}</label></div></fieldset><button class="primary" type="submit">Save result</button><p class="form-error" role="alert"></p></form>`);
  document.querySelector('#result-form').onsubmit = async e => { e.preventDefault(); const form = new FormData(e.target), button = e.target.querySelector('button[type=submit]'); button.disabled = true; try { await api('/api/admin/result',{method:'POST',body:JSON.stringify({boutId:id,winnerId:form.get('winner'),boutRevision:b.revision,version:data.version})}); notice = `Result saved for Ring ${assignedRing(b)} · ${b.code}`; await refresh(); } catch (error) { const message = document.querySelector('.form-error'); if (message) message.textContent = error.message; else { notice = error.message; render(); } } finally { button.disabled = false; } };
}
function undoModal(id) {
  const b = data.bouts.find(item => item.id === id);
  modal(`<button class="close" aria-label="Close">×</button><p class="eyebrow">Correct result</p><h2>Undo Ring ${escapeHtml(assignedRing(b))} · ${escapeHtml(b.code)}?</h2><p>The bout will return to ready status. Later results in the same bracket must be undone first.</p><form id="undo-form"><label>Reason for correction<input name="reason" required minlength="3"></label><button class="danger" type="submit">Undo result</button><p class="form-error" role="alert"></p></form>`);
  document.querySelector('#undo-form').onsubmit = async e => { e.preventDefault(); const form = new FormData(e.target), button = e.target.querySelector('button[type=submit]'); button.disabled = true; try { await api('/api/admin/undo',{method:'POST',body:JSON.stringify({boutId:id,reason:form.get('reason'),boutRevision:b.revision,version:data.version})}); notice = `Result undone for Ring ${assignedRing(b)} · ${b.code}`; await refresh(); } catch (error) { const message = document.querySelector('.form-error'); if (message) message.textContent = error.message; else { notice = error.message; render(); } } finally { button.disabled = false; } };
}
refresh();
setInterval(() => refresh(true), 10000);
