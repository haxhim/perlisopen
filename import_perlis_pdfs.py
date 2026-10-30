"""Rebuild Perlis rosters; validate every entrant and route against supplied draws."""
import csv,json,re
from pathlib import Path
from collections import Counter
import fitz
ROOT=Path(__file__).resolve().parent
FIELDS='day event source_pdf source_page team competitor_no name name_truncated_in_pdf category first_bout first_corner bout_2 corner_2 bout_3 corner_3 bout_4 corner_4 bout_5 corner_5 performance_no'.split()
def clean(s):return ' '.join((s or '').split())
def norm(s):return re.sub(r'[^A-Z0-9]','',s.upper().replace('GROUP','G'))
def row(event,f,p,team,no,name,category,routes=(),performance=''):
 r=dict.fromkeys(FIELDS,'');r.update(day=1,event=event,source_pdf='source/'+f.name,source_page=p,team=team,competitor_no=no,name=clean(name),name_truncated_in_pdf='yes' if '...' in name else 'no',category=category,performance_no=performance)
 for i,(code,corner) in enumerate(routes,1):r['first_bout' if i==1 else f'bout_{i}']=code;r['first_corner' if i==1 else f'corner_{i}']=corner
 return r
def route(c):
 m=re.search(r'([A-G]\d+[a-z]?)\s*\(([BR])\)',c or '');return (m[1],m[2]) if m else None

def kyorugi():
 f=next((ROOT/'source').glob('*Kyorugi*TM*'));rows=[];totals={}
 for pn,p in enumerate(fitz.open(f),1):
  lines=p.get_text().splitlines();team=next(x[5:].strip() for x in lines if x.startswith('TEAM:'));totals[team]=int(next(x.split(':')[1] for x in lines if x.startswith('Competitors:')))
  t=next(t.extract() for t in p.find_tables() if t.extract()[0][0]=='No')
  for no,name,cat,*cells in t[1:]:
   routes=[route(c) for c in reversed(cells) if c];assert all(routes),(pn,no,cells)
   rows.append(row('KYORUGI',f,pn,team,no,name,cat,routes))
 assert Counter(r['team'] for r in rows)==totals
 assert len(rows)==len({r['competitor_no'] for r in rows})
 draw=next((ROOT/'source').glob('*Kyorugi*Bout*'));seen=set();recovered=0
 for pn,p in enumerate(fitz.open(draw),1):
  lines=p.get_text().splitlines();cat=next(l for l in lines if re.match(r'^\d+ - \d+ (?:JUNIOR|SENIOR) ',l));n=int(next(l for l in lines if re.match(r'^\d+ competitors',l)).split()[0]);codes=set(re.findall(r'^[A-E]\d+[a-z]?$',p.get_text(),re.M));group=[r for r in rows if (cat.startswith(r['category'].split('...')[0]) if '...' in r['category'] else cat==r['category'])]
  assert len(group)==n,(pn,cat,n,len(group)); assert len({r['category'] for r in group})==1
  actual={r[k] for r in group for k in ['first_bout','bout_2','bout_3','bout_4','bout_5'] if r[k]};assert codes <= actual,(pn,actual^codes)
  for r in group:
   assert cat.startswith(r['category'].split('...')[0]),(cat,r['category']);r['category']=cat
   for l in lines:
    m=re.match(r'^(\d{3}) - (.+)$',l) or re.match(r'^(.+) - (\d{3})$',l)
    if not m:continue
    no,name=(m[1],m[2]) if m[1].isdigit() else (m[2],m[1])
    if no==r['competitor_no'] and '...' in r['name'] and '...' not in name:
     assert norm(name).startswith(norm(r['name'].split('...')[0])),(pn,r['name'],name);r['name']=name;r['name_truncated_in_pdf']='no';recovered+=1
   seen.add(r['competitor_no'])
 assert len(seen)==len(rows)
 return rows,dict(entries=len(rows),categories=len(fitz.open(draw)),teams=len(totals),recovered_names=recovered,truncated_names=sum(r['name_truncated_in_pdf']=='yes' for r in rows))

def poomsae():
 knockout=[];scored=[];tm=[];report={}
 for ring,pattern in [('F','*PK-Ring-F*'),('G','*12-14-PK*')]:
  tf=next((ROOT/'source').glob(f'*Ring-{ring}-TM*'));totals={};trows=[]
  for pn,p in enumerate(fitz.open(tf),1):
   text=p.get_text()
   if 'TEAM:' in text:
    team=next(x[5:].strip() for x in text.splitlines() if x.startswith('TEAM:'));totals[team]=int(re.search(r'Entries: (\d+)',text)[1])
   for table in p.find_tables():
    for no,name,cat,perf,semi,final in table.extract()[1:]:
     trows.append(dict(team=clean(team),name=clean(name),cat=clean(cat),perf=clean(perf),routes=[m for c in [final,semi] if (m:=route(c))],page=pn))
  assert Counter(r['team'] for r in trows)==totals,(ring,len(trows),totals)
  tm+=trows
  f=next((ROOT/'source').glob(pattern));start=len(knockout)
  for pn,p in enumerate(fitz.open(f),1):
   lines=p.get_text().splitlines();cat=lines[1];count=int(lines[2].split()[0]);codes=set(re.findall(r'^'+ring+r'\d+$',p.get_text(),re.M));group=[r for r in trows if r['routes'] and r['routes'][0][0] in codes]
   assert len(group)==count,(ring,pn,count,len(group),codes)
   assert {r['cat'] for r in group} and all(norm(r['cat'])==norm(cat) for r in group),(cat,group)
   actual={c for r in group for c,_ in r['routes']};assert actual==codes
   # Cross-check full draw names and clubs in the four fixed entrant boxes.
   boxes=[(30,140,325,290),(522,140,815,290)] if count>=3 else [(30,190,325,240),(522,190,815,240)]
   for r in group:
    assert norm(r['name']) in norm(' '.join(p.get_textbox(fitz.Rect(b)) for b in boxes)) or '...' in r['name'],(ring,pn,r['name'])
    knockout.append(row('POOMSAE PK',f,pn,r['team'],f'PK{ring}{len(knockout)-start+1:03}',r['name'],cat,r['routes']))
  report[ring]=dict(entries=len(knockout)-start,categories=len(fitz.open(f)),tm_entries=len(trows))
 f=next((ROOT/'source').glob('*Open-2026-Poomsae-Ring-G*'))
 used=set();category_count=0
 for pn,p in enumerate(fitz.open(f),1):
  blocks=p.get_text('blocks')
  for table in p.find_tables():
   before=[b for b in blocks if b[3]<table.bbox[1] and ('CONTESTANT NO.' in b[4] or ' / GROUP ' in b[4])]
   header=before[-1][4].strip(); contestant=next(b[4] for b in reversed(before) if 'CONTESTANT NO.' in b[4]);perf='G'+re.search(r'CONTESTANT NO\. (\d+)',contestant)[1].zfill(3)
   if 'CONTESTANT NO.' in header: cat=header.split(' / ',1)[1]
   else:cat=header
   category_count+=1
   for name,team,score,rank in table.extract()[1:]:
    assert not score and not rank
    if not clean(name) and not clean(team):continue
    name,team=clean(name),clean(team)
    candidates=[(i,r) for i,r in enumerate(tm) if r['perf']==perf and norm(r['name'])==norm(name) and norm(r['team'])==norm(team)]
    assert len(candidates)==1,(pn,perf,name,team,candidates)
    i,matched=candidates[0];assert i not in used;used.add(i)
    scored.append(row('POOMSAE PRO',f,pn,team,f'G{len(scored)+1:03}',name,cat,performance=perf))
 assert len(used)==sum(bool(r['perf']) for r in tm)
 report['scored']=dict(entries=len(scored),categories=len({r['category'] for r in scored}),performance_groups=category_count)
 return knockout,scored,report

def write(name,rows):
 with (ROOT/'csv'/name).open('w',newline='',encoding='utf-8-sig') as f:
  w=csv.DictWriter(f,FIELDS);w.writeheader();w.writerows(rows)
if __name__=='__main__':
 k,kr=kyorugi();pk,pro,pr=poomsae();write('perlis_day_1.csv',k+pk);write('perlis_poomsae_pro.csv',pro)
 state=dict(version=1,bouts={},audit=[],extraBouts=[],extraAthletes=[],extraPoomsaeEntries=[],schedule={},pins={},awards={},poomsae={})
 (ROOT/'seed/initial-state.sql').write_text('-- Fresh Perlis state; initializes empty databases only.\nINSERT INTO competition_state (id,version,state) VALUES (1,1,$perlis$'+json.dumps(state,separators=(',',':'))+'$perlis$::jsonb) ON CONFLICT (id) DO NOTHING;\n')
 report=dict(kyorugi=kr,poomsae=pr,total_entries=len(k)+len(pk)+len(pro));(ROOT/'source/import-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
