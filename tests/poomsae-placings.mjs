import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as standings from '../public/standings.js';
import {parseCsv,buildPoomsaeState,buildPoomsaeAwards,validatePoomsaePlacements} from '../server.mjs';
const rows=parseCsv(fs.readFileSync(new URL('../csv/perlis_poomsae_pro.csv',import.meta.url),'utf8'));
const first=buildPoomsaeState(rows)[0],codes=first.entrants.map(e=>e.code);
// Historical scores must never influence the selected placings.
let saved=Object.fromEntries(codes.map((code,i)=>[code,{rank:i+1,score:[9,8,7,6][i],performed:true}]));
const fixture={version:12,event:{name:'Perlis',shortName:'PERLIS',dates:[]},bouts:[],athletes:first.entrants,poomsae:buildPoomsaeState(rows,saved),awards:[],customRoster:false};
const code=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*\n/,'').replace(/refresh\(\);\s*setInterval\(\(\) => refresh\(true\), 10000\);\s*$/,'');
let captured,refreshes=0;
const context=vm.createContext({...standings,calculateStandings:standings.teamStandings,document:{querySelector:()=>({})},location:{pathname:'/admin/poomsae-pro',search:''},URLSearchParams,sessionStorage:{getItem:()=>''},fixture,
 fakeApi:async(path,options)=>{
   assert.equal(path,'/api/admin/poomsae-placements');captured=JSON.parse(options.body);
   assert.equal(captured.category,first.category);assert.equal(captured.ring,'G');
   const updates=validatePoomsaePlacements(fixture.poomsae[0],captured.placements);
   for(const [code,rank] of updates)saved[code]={...saved[code],rank,performed:rank!==null};
   fixture.poomsae=buildPoomsaeState(rows,JSON.parse(JSON.stringify(saved)));fixture.version++;
 },fakeRefresh:async()=>{refreshes++;}});
vm.runInContext(code,context);vm.runInContext("data=fixture;role='admin';ring='G';api=fakeApi;refresh=fakeRefresh",context);
const button={disabled:false},error={textContent:''};
const inputs=codes.map((code,i)=>({dataset:{poomsaePlacement:code},value:String([3,1,4,2][i])}));
const form={dataset:{category:first.category,ring:'G'},querySelector:selector=>selector==='.form-error'?error:button,querySelectorAll:()=>inputs};context.form=form;
vm.runInContext("poomsaeCategory='different selection';poomsaeDraft.set('G001','3')",context);
await vm.runInContext('savePoomsaePlacements(form)',context);
assert.deepEqual(captured.placements.map(e=>e.rank),['3','1','4','2']);assert.equal(refreshes,1);assert(!button.disabled);assert.equal(error.textContent,'');
assert.deepEqual(fixture.poomsae[0].entrants.map(e=>e.code),codes);
assert.deepEqual(fixture.poomsae[0].entrants.map(e=>e.rank),[3,1,4,2]);
assert.equal(vm.runInContext('poomsaeDraft.size',context),0);
assert(!fixture.poomsae[0].entrants.some(e=>'score' in e));
const award=buildPoomsaeAwards(fixture.poomsae).find(g=>g.id===first.id);
assert.equal(award.medals[0].medal,'Gold');assert.equal(award.medals[0].athleteId,first.entrants[1].id);
assert.equal(award.medals[1].medal,'Silver');assert.equal(award.medals[1].athleteId,first.entrants[3].id);
const html=vm.runInContext('adminPoomsaeContent()',context);
assert(html.includes('Save placings'));assert(!html.includes('Score (0–10)'));assert(!html.includes('data-poomsae-score'));assert(!html.includes('Save all scores'));
const renderedRows=html.split('<div class="ad-pro-row">').slice(1);
for(let i=0;i<codes.length;i++){
 assert(renderedRows[i].includes(first.entrants[i].name));
 assert(renderedRows[i].includes(`value="${[3,1,4,2][i]}" selected`));
}
const publicHtml=vm.runInContext("poomsaePublicView('schedule')",context);assert(!publicHtml.includes('Score / Placing'));assert(!publicHtml.includes('9.000'));
// Invalid duplicate placings must neither change the saved ranks nor lose the draft.
const before=JSON.stringify(saved);inputs[0].value='1';
vm.runInContext("poomsaeDraft.set('G001','1')",context);
await vm.runInContext('savePoomsaePlacements(form)',context);
assert.match(error.textContent,/only one/);assert(!button.disabled);assert.equal(JSON.stringify(saved),before);assert.equal(refreshes,1);assert.equal(vm.runInContext("poomsaeDraft.get('G001')",context),'1');
console.log('PASS: referee selections 3,1,4,2 survive save/reload on the same athletes; historical scores cannot alter placings; medal order stays correct; no score fields; errors retain drafts.');
