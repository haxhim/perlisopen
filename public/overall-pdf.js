// Browser/Node compatible PDF layout. All report data is supplied as one snapshot.
export function createOverallPdf(report, PdfConstructor) {
  const pdf = new PdfConstructor({ unit:'mm', format:'a4', compress:true, putOnlyUsedFonts:true });
  const red = [157,15,45], gray = [93,99,111], ink = [30,35,45];
  const x = 16, width = 178, bottom = 270;
  const columns = [14,102,16,16,16,14];
  const clean = value => String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/[–—]/g,'-');
  const generated = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(report.generatedAt)) + ' MYT';
  pdf.setProperties({ title:'Perlis Overall Awards', subject:'Overall trophies by event and age category - combined medals', author:clean(report.event.shortName) });
  let y = 0, currentGroup = '';
  function header(continued = false) {
    pdf.setFillColor(...red); pdf.rect(0,0,210,5,'F');
    pdf.setFont('helvetica','bold'); pdf.setTextColor(...red); pdf.setFontSize(10);
    pdf.text(clean(report.event.shortName).toUpperCase(),x,16);
    pdf.setFontSize(10); pdf.setTextColor(...ink);
    const name = pdf.splitTextToSize(clean(report.event.name),width);
    pdf.text(name,x,24); y = 24 + (name.length - 1) * 4.2;
    pdf.setFontSize(21);
    const title = pdf.splitTextToSize(clean(currentGroup) + (continued ? ' (continued)' : ''),width);
    pdf.text(title,x,y+13); y += (title.length - 1) * 8;
    pdf.setFontSize(9); pdf.setFont('helvetica','normal'); pdf.setTextColor(...gray);
    pdf.text('OVERALL AWARDS  |  ' + clean(report.event.dates.join(' / ')),x,y+20);
    pdf.text('Generated: ' + generated,x,y+26);
    pdf.text(`Completed categories: ${report.completedCategories} / ${report.totalCategories}`,x,y+32);
    y += 43;
  }
  function newPage() { pdf.addPage(); header(true); }
  function tableHeader(label, continued = false) {
    pdf.setFont('helvetica','bold'); pdf.setFontSize(12); pdf.setTextColor(...red);
    pdf.text(clean(label) + (continued ? ' (continued)' : ''),x,y); y += 4;
    pdf.setFillColor(242,243,246); pdf.rect(x,y,width,9,'F');
    pdf.setFontSize(8); pdf.setTextColor(...gray);
    let columnX = x;
    ['Rank','Team','Gold','Silver','Bronze','Total'].forEach((label,index) => {
      pdf.text(label,index === 1 ? columnX+3 : columnX+columns[index]/2,y+5.8,{align:index === 1 ? 'left' : 'center'});
      columnX += columns[index];
    }); y += 9;
  }
  for (const [groupIndex,group] of report.groups.entries()) {
    currentGroup = group.title;
    if (groupIndex) pdf.addPage();
    header();
    // Combined medals determine the trophy positions; tied medal totals share a rank.
    const combined = group.sections.find(section => section.gender === 'ALL');
    for (const section of [{ label:'Top 3 trophy positions', rows:(combined?.rows || []).filter(row => row.rank <= 3) }]) {
      // Keep the heading and first row together if long names cause a page break.
      if (y + 32 > bottom) newPage();
      tableHeader(section.label);
      if (!section.rows.length) {
        pdf.setFillColor(250,250,251); pdf.rect(x,y,width,14,'F');
        pdf.setFont('helvetica','normal'); pdf.setFontSize(9); pdf.setTextColor(...gray);
        pdf.text('No completed category medals in this selection yet.',x+3,y+8.5); y += 14;
      }
      for (const [index,row] of section.rows.entries()) {
        pdf.setFont('helvetica','bold'); pdf.setFontSize(9);
        const trophy = row.trophy ? `${row.tied ? 'Joint ' : ''}${row.trophy} - Trophy` : '';
        const teamLines = pdf.splitTextToSize(clean(row.team) + (trophy ? '\n'+trophy : ''),columns[1]-6);
        const height = Math.max(12,teamLines.length*4+6);
        if (y + height > bottom) { newPage(); tableHeader(section.label,true); }
        pdf.setFillColor(...([[255,250,236],[247,248,250],[255,247,242]][index] || (index % 2 ? [247,248,250] : [255,255,255])));
        pdf.rect(x,y,width,height,'F');
        pdf.setDrawColor(226,228,233); pdf.line(x,y+height,x+width,y+height);
        pdf.setTextColor(...ink); pdf.setFontSize(10);
        pdf.text(String(row.rank || index+1),x+columns[0]/2,y+7,{align:'center'});
        pdf.setFontSize(9); pdf.text(teamLines,x+columns[0]+3,y+6,{lineHeightFactor:1.25});
        let columnX=x+columns[0]+columns[1];
        pdf.setFont('helvetica','normal'); pdf.setFontSize(10);
        [row.gold,row.silver,row.bronze,row.gold+row.silver+row.bronze].forEach((number,index) => {
          pdf.text(String(number),columnX+columns[index+2]/2,y+7,{align:'center'});
          columnX+=columns[index+2];
        }); y += height;
      }
      y += 13;
    }
  }
  const pages=pdf.getNumberOfPages();
  for (let page=1;page<=pages;page++) {
    pdf.setPage(page); pdf.setDrawColor(225,227,231); pdf.line(x,279,x+width,279);
    pdf.setFont('helvetica','normal'); pdf.setFontSize(8); pdf.setTextColor(...gray);
    pdf.text('Ranking: gold, silver, bronze. Equal totals share a rank.',x,285);
    pdf.text(`${page} / ${pages}`,x+width,285,{align:'right'});
    pdf.text('Snapshot of completed results. Export again after any result corrections.',x,290);
  }
  return pdf;
}
