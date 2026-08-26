/* 沿革解析的跨法規稽核
 *
 * 背景：沿革敘述的格式各法規不同，只在建築法上驗過並不足以說明通用。
 * 實測 18 部法規後找出兩種先前未處理的情形：
 *   1. 「全文修正」「制定公布」不列個別條號，但確實動到每一條
 *      （憲法只有一次制定公布，民法早期為全文修正）
 *   2. 分編立法的法規（民法）用 LawRedirectLY.aspx 而非 LawRedirect.ashx
 * 需要網路；離線時明確略過而非假性通過。
 */
const UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120'};
const {JSDOM}=require('jsdom');
const fs=require('fs');
const code=fs.readFileSync('src/lawhover.js','utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const LAWS=[
 ['A0000001','中華民國憲法'],['B0000001','民法'],['C0000001','中華民國刑法'],
 ['D0070109','建築法'],['A0030055','行政程序法'],['N0030001','勞動基準法'],
 ['D0070118','公寓大廈管理條例'],['A0030057','政府採購法'],['I0050021','個人資料保護法'],
 ['D0070001','都市計畫法'],['D0120001','消防法'],['D0060001','土地法'],
 ['B0000002','民法總則施行法'],['C0010001','中華民國刑法施行法'],['N0060001','職業安全衛生法'],
 ['G0330001','所得稅法'],['A0030154','行政訴訟法'],['B0010001','民事訴訟法'],
];

(async()=>{
  try{ await fetch('https://law.moj.gov.tw/',{headers:UA}); }
  catch(e){ console.log('\x1b[33m略過：無法連線至 law.moj.gov.tw\x1b[0m'); process.exit(0); }
  console.log('\n\x1b[1m沿革解析跨法規稽核（'+LAWS.length+' 部）\x1b[0m');
  let total=0,parsed=0,noRec=0,issues=[];
  for(const [pcode,name] of LAWS){
    await sleep(900);
    let html;
    try{ html=await fetch('https://law.moj.gov.tw/LawClass/LawHistory.aspx?pcode='+pcode,{headers:UA}).then(r=>r.text()); }
    catch(e){ issues.push([name,'連線失敗 '+e.message]); continue; }

    const dom=new JSDOM('<body><h2 id="hlLawName">'+name+'</h2></body>',
      {url:'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode='+pcode,runScripts:'outside-only',pretendToBeVisual:true});
    const w=dom.window;
    w.fetch=()=>Promise.resolve({ok:true,status:200,text:()=>Promise.resolve(html)});
    w.eval(code);
    const h=await w.__lawhover__.hist(pcode);

    // 原始沿革條目數（以「N. 中華民國」開頭者為準）
    const rawCount=(html.match(/>\s*\d+\.\s*中華民國/g)||[]).length;
    const withArts=h.list.filter(x=>x.arts.length).length;
    const withWhen=h.list.filter(x=>x.when).length;
    total++;
    if(h.list.length) parsed++;

    const flag=[];
    if(!h.list.length) flag.push('完全解析不到');
    else{
      if(rawCount && Math.abs(rawCount-h.list.length)>rawCount*0.25) flag.push('條目數落差大 raw='+rawCount);
      // 只有制定公布而未曾修正的法規（如憲法）本來就沒有條號可抽，不算問題
      const onlyEnacted=h.list.length<=1 && h.list.every(x=>x.whole||!x.arts.length);
      if(withArts===0 && !onlyEnacted) flag.push('抽不到任何條號');
      if(withWhen<h.list.length*0.6) flag.push('日期抽取率低 '+withWhen+'/'+h.list.length);
      // 分編立法者（民法）用 LawRedirectLY 端點，有入口即可
      if(!h.lyUrl) flag.push('無立法院入口');
    }
    // 抽樣：找一個有修法紀錄的條號驗證反查
    let sample='';
    const first=h.list.find(x=>x.arts.length);
    if(first){
      const a=first.arts[0];
      const rec=w.__lawhover__.histFor(h,a);
      const named=rec.filter(r=>!r.whole).length;
      sample='第'+a+'條→'+rec.length+'次(明列'+named+')';
      if(!rec.length) flag.push('反查失敗(條號'+a+')');
      // 明列該條號的紀錄必須被抓到，否則是解析漏了
      if(!named) flag.push('明列條號未被反查到('+a+')');
    } else noRec++;

    console.log(
      name.padEnd(14),
      '沿革'+String(h.list.length).padStart(3),
      '/raw'+String(rawCount).padStart(3),
      ' 有條號'+String(withArts).padStart(3),
      ' 有日期'+String(withWhen).padStart(3),
      ' LY='+(h.lyCode?h.lyCode:(h.lyUrl?'redir':'-')).padEnd(6),
      sample.padEnd(14),
      flag.length?'⚠ '+flag.join('; '):'ok');
    if(flag.length) issues.push([name,flag.join('; ')]);
  }
  console.log('\n'+(issues.length===0
    ? '\x1b[32m沿革稽核全部通過：'+total+' 部法規\x1b[0m'
    : '\x1b[31m'+total+' 部中有 '+issues.length+' 部異常\x1b[0m'));
  issues.forEach(([n,f])=>console.log('  \x1b[31m✗\x1b[0m',n,'—',f));
  process.exit(issues.length?1:0);
})();
