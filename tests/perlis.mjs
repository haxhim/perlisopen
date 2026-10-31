import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {jsPDF} from 'jspdf';
import * as standings from '../public/standings.js';
import {createOverallPdf} from '../public/overall-pdf.js';
import {parseCsv,buildCompetition,projectCompetition,buildAwardState,buildPoomsaeState,buildPoomsaeAwards,validatePoomsaePlacements} from '../server.mjs';
const rows=parseCsv(fs.readFileSync(new URL('../csv/perlis_day_1.csv',import.meta.url),'utf8'));
const pro=parseCsv(fs.readFileSync(new URL('../csv/perlis_poomsae_pro.csv',import.meta.url),'utf8'));
const comp=buildCompetition(rows),blank=projectCompetition(comp,{bouts:{}});
assert.equal(rows.length,741);assert.equal(pro.length,97);
assert.equal(new Set(rows.filter(r=>r.event==='KYORUGI').map(r=>r.category)).size,81);
assert.equal(new Set(rows.filter(r=>r.event==='POOMSAE PK').map(r=>r.category)).size,94);
const stored={bouts:{}};
for(let pass=0;pass<8;pass++)for(const b of projectCompetition(comp,stored).filter(b=>b.status==='READY'))stored.bouts[b.id]={winnerId:b.blueId,method:'POINTS'};
const finished=projectCompetition(comp,stored);assert(finished.every(b=>['COMPLETE','BYE'].includes(b.status)));
const awards=buildAwardState(finished);assert.equal(awards.length,175);assert(awards.every(a=>a.finished&&a.medals.filter(m=>m.medal==='Gold').length===1));
const groups=buildPoomsaeState(pro);assert.equal(groups.length,30);
const ranks=Object.fromEntries(groups.flatMap(g=>g.entrants.slice(0,4).map((e,i)=>[e.code,{rank:i+1,performed:true}])));
const completePro=buildPoomsaeState(pro,ranks);assert(completePro.every(g=>g.finished));
assert.equal(buildPoomsaeAwards(completePro).length,30);
assert.throws(()=>validatePoomsaePlacements(groups[0],groups[0].entrants.map(e=>({code:e.code,rank:1}))),/only one/);
const fixture={event:{name:'Perlis Open Taekwondo Championship 2026',shortName:'PERLIS 2026',dates:['31 October 2026']},version:1,bouts:blank,poomsae:groups,athletes:comp.athletes.concat(groups.flatMap(g=>g.entrants)),awards:[],customRoster:false};
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*\n/,'').replace(/refresh\(\);\s*setInterval\(\(\) => refresh\(true\), 10000\);\s*$/,'');
const context=vm.createContext({...standings,calculateStandings:standings.teamStandings,document:{querySelector:()=>({})},location:{pathname:'/live',search:''},URLSearchParams,sessionStorage:{getItem:()=>''},fixture});
vm.runInContext(app,context);vm.runInContext('data=fixture;role="admin"',context);
for(const ring of 'ABCDEFG')assert(vm.runInContext('live()',context).includes('ring '+ring)||vm.runInContext('live()',context).includes('Ring '+ring));
for(const ring of 'FG'){
 vm.runInContext(`ring='${ring}';event='POOMSAE PK'`,context);
 assert(vm.runInContext('schedule()',context).includes(ring==='F'?'F001':'G033'));
 assert(vm.runInContext('brackets()',context).includes(ring==='F'?'F001':'G033'));
}
assert(vm.runInContext('schedule()',context).includes('scored final placings'));
assert.equal((vm.runInContext("poomsaePublicView('schedule')",context).match(/pro-schedule-callout current/g)||[]).length,4,'all four simultaneous entrants are current');
assert(!vm.runInContext('live()',context).includes('G033 Poomsae'));
fixture.poomsae=completePro;assert(vm.runInContext('live()',context).includes('G033'));fixture.poomsae=groups;

vm.runInContext("qualifyingRing='G'",context);assert(vm.runInContext('adminQualifyingContent()',context).includes('Stage a qualifier'));
vm.runInContext("qualifyingRing='SCORED'",context);assert(vm.runInContext('adminQualifyingContent()',context).includes('BELOW 8'));
vm.runInContext("transferMode='bouts';transferSourceRing='G';transferPrefix='G'",context);assert(vm.runInContext('adminTransferContent()',context).includes('G033'));
vm.runInContext("transferMode='scored'",context);assert(!vm.runInContext('transferEntries()',context).some(b=>b.event==='POOMSAE PK'));
// Age bands derive from numbers, regardless of the source's JUNIOR/SENIOR labels.
for(const [category,expected] of [['9 - 11 JUNIOR FFLY','SUPER_CADET'],['12–14 / Male / TAEGEUK 1','CADET'],['PAIR / 15 - 17','JUNIOR'],['BELOW 8 / MALE / TAEGEUK 1',null]])assert.equal(standings.ageGroup(category),expected);
assert.equal(standings.tallyPresets.length,9);
const source={...fixture,athletes:[],awards:[]};let sequence=0;
function add(event,category,team,medal='Gold',finished=true){const id='a'+(++sequence);source.athletes.push({id,team});source.awards.push({day:1,event,category,finished,medals:[{athleteId:id,medal}]});}
for(const event of ['KYORUGI','POOMSAE PK','POOMSAE PRO'])for(const age of ['9 - 11','12 - 14','15 - 17'])for(const gender of ['M','F']){
 const cat=event==='KYORUGI'?`${age} SENIOR ${gender}FIN`:`${age} / ${gender==='M'?'MALE':'FEMALE'} / TAEGEUK 1`;
 for(let team=1;team<=5;team++)for(let n=team;n<=5;n++)add(event,cat,`Club ${team}`);
}
add('POOMSAE PRO','PAIR / 12 - 14','Pair Club','Silver');
add('POOMSAE PRO','BELOW 8 / MALE / TAEGEUK 1','Young Club');
add('KYORUGI','9 - 11 JUNIOR MFIN','Unfinished','Gold',false);
for(const preset of standings.tallyPresets){const ranked=standings.teamStandings(preset,'ALL',source);assert.equal(ranked[0].team,'Club 1');assert.equal(ranked[0].trophy,'Champion');assert.equal(ranked[2].trophy,'2nd Runner Up');assert(!ranked.some(r=>r.team==='Unfinished'));assert.equal(ranked.some(r=>r.team==='Young Club'),false);assert.equal(ranked.some(r=>r.team==='Pair Club'),preset.id==='POOMSAE_CADET'||preset.id==='POOMSAE_ALL'||preset.id==='COMBINED_ALL');}
const genderPreset=standings.tallyPresets[0];assert.equal(standings.teamStandings(genderPreset,'M',source)[0].gold,5);assert.equal(standings.teamStandings(genderPreset,'ALL',source)[0].gold,10);
const pPreset=standings.tallyPresets.find(p=>p.id==='POOMSAE_SUPER_CADET');assert.equal(standings.teamStandings(pPreset,'ALL',source)[0].gold,20);
const combinedPreset=standings.tallyPresets.find(p=>p.id==='COMBINED_ALL');
const combinedRows=standings.teamStandings(combinedPreset,'ALL',source);
assert.equal(combinedRows[0].gold,90);
for(const row of combinedRows){
 const separated=['KYORUGI_ALL','POOMSAE_ALL'].map(id=>standings.teamStandings(standings.tallyPresets.find(p=>p.id===id),'ALL',source).find(r=>r.team===row.team));
 for(const medal of ['gold','silver','bronze'])assert.equal(row[medal],separated.reduce((n,r)=>n+(r?.[medal]||0),0));
}
assert(combinedRows.some(r=>r.team==='Pair Club'));
assert(!combinedRows.some(r=>r.team==='Young Club'));
assert.equal(standings.teamStandings(combinedPreset,'M',source)[0].gold,45);
assert.equal(standings.teamStandings(combinedPreset,'F',source)[0].gold,45);
assert(!standings.tallyAwardMatches({day:1,event:'VIRTUAL',category:'12 - 14 MFIN',finished:true,medals:[{}]},combinedPreset));
const tieSource={athletes:[{id:'a',team:'Z Club'},{id:'b',team:'A Club'}],awards:['a','b'].map(id=>({day:1,event:'KYORUGI',category:'9 - 11 JUNIOR MFIN',finished:true,medals:[{athleteId:id,medal:'Gold'}]}))};assert(standings.teamStandings(genderPreset,'ALL',tieSource).every(r=>r.rank===1&&r.tied));
context.source=source;vm.runInContext('data=source;tallyGender="ALL"',context);const report=vm.runInContext('overallReportSnapshot()',context);assert.equal(report.groups.length,9);
assert.equal(report.totalCategories,source.awards.filter(a=>a.day===1&&!standings.isBelowEight(a.category)).length);
assert(!report.groups.flatMap(g=>g.sections.flatMap(s=>s.rows)).some(r=>r.team==='Young Club'));
assert(source.awards.some(a=>standings.isBelowEight(a.category)&&a.finished),'Below 8 category results remain available');
for(const gender of ['ALL','M','F']){
 const preset=standings.tallyPresets.find(p=>p.id==='POOMSAE_ALL');
 assert(!standings.tallyAwardMatches({day:1,event:'POOMSAE PRO',category:'BELOW 8 / MALE / TAEGEUK 1',finished:true,medals:[{}]},preset,gender));
}
const pdf=createOverallPdf(report,jsPDF);assert.equal(pdf.getNumberOfPages(),9);const text=pdf.internal.pages.flat().join('\n');assert(text.includes('Overall Kyorugi + Poomsae'));assert(text.includes('Champion - Trophy'));assert(text.includes('2nd Runner Up - Trophy'));assert(!text.includes('Young Club'));assert(!text.includes('Club 4'));assert(!text.includes('Club 5'));
assert(vm.runInContext('teamTallyView()',context).includes('Club 5'));
fs.mkdirSync(new URL('../tmp/pdfs/',import.meta.url),{recursive:true});pdf.save(fileURLToPath(new URL('../tmp/pdfs/overall-awards-test.pdf',import.meta.url)));
console.log('PASS: 838 entries; all 175 elimination brackets can finish; 30 scored categories; mixed ring G routing; nine award groups; both Poomsae formats, pairs and teams; gender filters, shared ranks, and nine-page trophy PDF.');

// Weight labels add the supplied kg limit while retaining the original division,
// gender, class, raw category and round labels on every existing bout surface.
for (const [category,expected] of [
  ['9 - 11 JUNIOR MFIN','FIN · -20 kg'],['9 - 11 JUNIOR FFLY','FLY · -21 kg'],
  ['9 - 11 SENIOR MHEAVY','HEAVY · >40 kg'],['9 - 11 SENIOR FHEAVY','HEAVY · >38 kg'],
  ['12 - 14 JUNIOR FLIGHT MIDDLE','LIGHT MIDDLE · -51 kg'],
  ['12 - 14 SENIOR MLIGHT MIDDLE','LIGHT MIDDLE · -57 kg'],
  ['12 - 14 SENIOR FLIGHT HEAVY','LIGHT HEAVY · -59 kg'],
  ['12 - 14 SENIOR MHEAVY','HEAVY · >65 kg'],
  ['15 - 17 SENIOR MFIN','FIN · -45 kg'],['15 - 17 SENIOR FLIGHT MIDDLE','LIGHT MIDDLE · -59 kg'],
  ['15 - 17 SENIOR MHEAVY','HEAVY · >78 kg'],['15 - 17 SENIOR FHEAVY','HEAVY · >68 kg'],
]) {
  context.weightBout={...blank[0],event:'KYORUGI',category};
  assert.equal(vm.runInContext('kyorugiCategoryDetails(weightBout)[2]',context),expected);
}
const seededCategories=[...new Set(rows.filter(r=>r.event==='KYORUGI').map(r=>r.category))];
assert.equal(seededCategories.length,81);
for (const category of seededCategories) {
  context.weightBout={event:'KYORUGI',category};
  const details=vm.runInContext('kyorugiCategoryDetails(weightBout)',context);
  assert.match(details[2],/ · (?:-\d+|>\d+) kg$/,category);
  assert(details[2].startsWith(category.match(/[MF]([A-Z ]+)$/)[1]+' · '));
}
vm.runInContext('data=fixture',context);
context.weightBout={...blank.find(b=>b.code==='A01'),category:'12 - 14 JUNIOR FLIGHT MIDDLE'};
for(const expression of ['card(weightBout)','scheduleRow(weightBout)','adminBoutCard(weightBout)']) {
 const html=vm.runInContext(expression,context);
 for(const text of ['12 - 14 JUNIOR FLIGHT MIDDLE','Cadet · 12 - 14','Female','LIGHT MIDDLE · -51 kg','Semifinal'])assert(html.includes(text),expression+': '+text);
}
for (const event of ['POOMSAE PK','POOMSAE PRO']) {
 context.weightBout={event,category:'12 - 14 JUNIOR FLIGHT MIDDLE'};
 assert.equal(vm.runInContext('categoryDetails(weightBout)',context),'');
}
console.log('PASS: all 81 Kyorugi categories have reference kg labels; age/gender limits and Heavy thresholds match; existing labels and Poomsae are preserved.');

console.log('PASS: Below 8 medals excluded from overall screen/PDF standings and report counts; individual results remain available.');

console.log('PASS: combined overall equals Kyorugi plus both Poomsae formats, includes pairs/teams, excludes Below 8 and other events, and appears in the nine-group PDF.');
