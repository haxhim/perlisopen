export const ageGroups = [
  {id:'SUPER_CADET',label:'Super Cadet (9–11 years)',low:9,high:11},
  {id:'CADET',label:'Cadet (12–14 years)',low:12,high:14},
  {id:'JUNIOR',label:'Junior (15–17 years)',low:15,high:17},
];
export const tallyPresets = [['KYORUGI','Kyorugi'],['POOMSAE','Poomsae']].flatMap(([event,label]) => [
  ...ageGroups.map(age => ({id:`${event}_${age.id}`,event,age:age.id,label:`${label} · ${age.label}`})),
  {id:`${event}_ALL`,event,age:'ALL',label:`Overall ${label}`},
]);
export const trophyTitles = ['Champion','1st Runner Up','2nd Runner Up'];
export const isBelowEight = category => /^\s*BELOW\s*8\b/i.test(String(category));
export function ageGroup(category) {
  const range = String(category).match(/(?:^|[^0-9])(\d{1,2})\s*[-–—]\s*(\d{1,2})(?![0-9])/);
  if (!range) return null;
  return ageGroups.find(g => Number(range[1]) >= g.low && Number(range[2]) <= g.high)?.id || null;
}
export function tallyAwardMatches(award,preset,gender='ALL') {
  if (!award.finished || !award.medals.length || award.day !== 1 || isBelowEight(award.category)) return false;
  const discipline = award.event === 'KYORUGI' ? 'KYORUGI' : /^POOMSAE(?:\s|$)/.test(award.event) ? 'POOMSAE' : null;
  if (discipline !== preset.event || preset.age !== 'ALL' && ageGroup(award.category) !== preset.age) return false;
  if (gender === 'ALL') return true;
  const category = String(award.category).toUpperCase();
  const match = category.match(/^\d+\s*[-–—]\s*\d+\s+(?:JUNIOR|SENIOR)\s+([MF])/) || category.match(/(?:^|\/\s*)(MALE|FEMALE)(?: TEAM)?\s*\//);
  const value = match?.[1];
  return (value === 'MALE' ? 'M' : value === 'FEMALE' ? 'F' : value) === gender;
}
export function teamStandings(preset,gender='ALL',source) {
  const teams = new Map(), athletes = new Map(source.athletes.map(a => [a.id,a]));
  for (const award of source.awards.filter(a => tallyAwardMatches(a,preset,gender))) for (const medal of award.medals) {
    const team = athletes.get(medal.athleteId)?.team?.trim(), kind = medal.medal.toLowerCase();
    if (!team || !['gold','silver','bronze'].includes(kind)) continue;
    const key = team.toUpperCase().replace(/[^A-Z0-9]/g,'');
    const entry = teams.get(key) || {team,gold:0,silver:0,bronze:0};
    entry[kind]++;teams.set(key,entry);
  }
  const sorted = [...teams.values()].sort((a,b) => b.gold-a.gold || b.silver-a.silver || b.bronze-a.bronze || a.team.localeCompare(b.team));
  let rank = 0;
  return sorted.map((row,index) => {
    const previous = sorted[index-1];
    if (!previous || row.gold !== previous.gold || row.silver !== previous.silver || row.bronze !== previous.bronze) rank = index+1;
    return {...row,rank,tied:sorted.some((other,i) => i !== index && row.gold === other.gold && row.silver === other.silver && row.bronze === other.bronze),trophy:rank <= 3 ? trophyTitles[rank-1] : null};
  });
}
