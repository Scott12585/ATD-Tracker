/***************************************************************
 * DraftKings O/U projections v1 — experimental, no hit probability.
 * Add this file alongside Research Model Expansion.gs.
 * Script Property: ODDS_API_KEY (The Odds API, the-odds-api.com).
 * Run refreshNFLPlayerOddsAndProjections after availability refresh.
 * Main research sync also calls the internal refresh when configured.
 ***************************************************************/
const NFL_OU_MARKETS = {
  player_pass_yds:{label:'Passing Yards',stat:'passing_yards',volume:'attempts',positions:['QB'],minimum:10,floor:2},
  player_pass_tds:{label:'Passing TD',stat:'passing_tds',volume:'attempts',positions:['QB'],minimum:10,floor:0.25},
  player_rush_yds:{label:'Rushing Yards',stat:'rushing_yards',volume:'carries',positions:['QB','RB'],minimum:5,floor:2},
  player_reception_yds:{label:'Receiving Yards',stat:'receiving_yards',volume:'targets',positions:['RB','WR','TE'],minimum:2,floor:2},
  player_receptions:{label:'Receptions',stat:'receptions',volume:'targets',positions:['RB','WR','TE'],minimum:2,floor:0.5}
};
function nflOUProjectionRows_(audit,raw,schedule,season,week) {
  const history={},current={},stats={},coverage={},groups={},seen=new Set();
  const metrics=Array.from(new Set(Object.values(NFL_OU_MARKETS).flatMap(m=>[m.stat,m.volume])));
  schedule.filter(g=>Number(g.Season)===season).forEach(g=>{
    const w=Number(g.Week),away=expansionSyncTeam_(g.Away),home=expansionSyncTeam_(g.Home);
    if(w===week){current[away]=home;current[home]=away;}
    if(w<1||w>=week||String(g.Status).toLowerCase()!=='final')return;
    [[away,home],[home,away]].forEach(([team,opponent])=>{history[team]=history[team]||{};if(history[team][w])throw new Error('Duplicate team game');history[team][w]=opponent;});
  });
  raw.filter(r=>Number(r.season)===season&&Number(r.week)>0&&Number(r.week)<week&&(!r.season_type||r.season_type==='REG')).forEach(r=>{
    const team=expansionSyncTeam_(r.recent_team||r.team),w=Number(r.week),position=normalizePosition(r.position);
    if(!history[team]?.[w]||!['QB','RB','WR','TE'].includes(position))return;
    const key=expansionNameKey_(r.player_display_name||r.player_name||r.player,team),id=String(r.player_id||r.gsis_id||key)+'|'+team+'|'+w;
    if(seen.has(id))throw new Error('Duplicate projection stats '+id);seen.add(id);
    coverage[team+'|'+w]=true;stats[key]=stats[key]||{};
    const values={};metrics.forEach(k=>values[k]=numExpansion_(r[k]));
    stats[key][w]=stats[key][w]?{ambiguous:true}:values;
    const gkey=team+'|'+w+'|'+position;groups[gkey]=groups[gkey]||{};
    metrics.forEach(k=>{if(values[k]===null)groups[gkey][k]=null;else if(groups[gkey][k]!==null)groups[gkey][k]=(groups[gkey][k]||0)+values[k];});
  });
  const output=[],players=new Set();
  audit.forEach(p=>{
    const team=expansionSyncTeam_(p.Team),opponent=current[team],key=expansionNameKey_(p.Player,team),pos=p.Position;
    if(!opponent||players.has(key))return;players.add(key);
    const weeks=Object.keys(history[team]||{}).map(Number).sort((a,b)=>b-a),recent=weeks.slice(0,3),own=stats[key]||{};
    function total(ws,k){const values=ws.map(w=>!coverage[team+'|'+w]?null:!own[w]?0:own[w].ambiguous?null:own[w][k]);return values.length&&values.every(v=>v!==null&&v!==undefined)?values.reduce((a,b)=>a+b,0):null;}
    Object.entries(NFL_OU_MARKETS).forEach(([market,m])=>{
      if(!m.positions.includes(pos))return;
      const rt=total(recent,m.stat),rv=total(recent,m.volume),st=total(weeks,m.stat),sv=total(weeks,m.volume);
      if(recent.length<2||rt===null||rv===null||st===null||sv===null||rv<=0||sv<=0)return;
      const recentVolume=rv/recent.length,seasonVolume=sv/weeks.length;
      const volume=0.65*recentVolume+0.35*seasonVolume;
      const efficiency=0.65*rt/rv+0.35*st/sv;
      const allowances=[],league=[];
      Object.entries(history).forEach(([defense,ws])=>Object.entries(ws).forEach(([w,offense])=>{const g=groups[offense+'|'+w+'|'+pos],v=g?.[m.stat];if(v!==null&&v!==undefined){league.push(v);if(defense===opponent)allowances.push(v);}}));
      const dg=Object.keys(history[opponent]||{}).length,complete=dg>0&&allowances.length===dg;
      const avg=a=>a.reduce((s,v)=>s+v,0)/a.length;
      const leagueAvg=league.length?avg(league):null,defenseAvg=complete?avg(allowances):null;
      const factor=defenseAvg!==null&&leagueAvg>0?Math.max(0.85,Math.min(1.15,1+(defenseAvg/leagueAvg-1)*dg/(dg+6))):1;
      const projection=Math.max(0,volume*efficiency*factor);
      const active=String(p.Availability).startsWith('Active roster;')||p.Availability==='Available';
      const roleOK=pos!=='QB'||p['Current Role']==='Listed starter';
      const threshold=pos==='QB'&&m.volume==='carries'?3:pos==='WR'&&m.volume==='targets'?3:m.minimum;
      const eligible=active&&roleOK&&recent.length>=3&&recentVolume>=threshold&&complete&&dg>=2;
      const reason=p.Player+' averaged '+(rt/recent.length).toFixed(1)+' '+m.label.toLowerCase()+' on '+recentVolume.toFixed(1)+' '+m.volume+'/game over the last '+recent.length+' team games. '+opponent+' allowed '+(defenseAvg===null?'unknown':defenseAvg.toFixed(1))+' '+m.label.toLowerCase()+'/game to all '+pos+'s. Projected '+projection.toFixed(1)+' using blended workload and efficiency, with a '+((factor-1)*100).toFixed(1)+'% opponent adjustment.';
      output.push({season:season,week:week,player:p.Player,team:team,opponent:opponent,position:pos,market:m.label,market_key:market,projection:Math.round(projection*100)/100,availability:p.Availability||'Unverified',role:p['Current Role']||'Role unverified',model:'workload-efficiency-v1',detail:{recent_games:recent.length,recent_average:rt/recent.length,recent_volume:recentVolume,projected_volume:volume,efficiency:efficiency,defense_games:dg,defense_average:defenseAvg,defense_factor:factor,eligible:eligible,context_checked_at:p['Checked At']||null,reason:reason},quote:null});
    });
  });
  return output;
}
function nflOUName_(name){return expansionNameKey_(name,'').split('|')[0];}
function nflOUTeam_(name){
  const names={'Arizona Cardinals':'ARI','Atlanta Falcons':'ATL','Baltimore Ravens':'BAL','Buffalo Bills':'BUF','Carolina Panthers':'CAR','Chicago Bears':'CHI','Cincinnati Bengals':'CIN','Cleveland Browns':'CLE','Dallas Cowboys':'DAL','Denver Broncos':'DEN','Detroit Lions':'DET','Green Bay Packers':'GB','Houston Texans':'HOU','Indianapolis Colts':'IND','Jacksonville Jaguars':'JAX','Kansas City Chiefs':'KC','Las Vegas Raiders':'LV','Los Angeles Chargers':'LAC','Los Angeles Rams':'LAR','Miami Dolphins':'MIA','Minnesota Vikings':'MIN','New England Patriots':'NE','New Orleans Saints':'NO','New York Giants':'NYG','New York Jets':'NYJ','Philadelphia Eagles':'PHI','Pittsburgh Steelers':'PIT','San Francisco 49ers':'SF','Seattle Seahawks':'SEA','Tampa Bay Buccaneers':'TB','Tennessee Titans':'TEN','Washington Commanders':'WAS'};
  return names[name]||null;
}
function nflOUJoinQuotes_(projections,events,now) {
  let unmatched=0;const matched=new Set();
  events.forEach(event=>{
    const home=nflOUTeam_(event.home_team),away=nflOUTeam_(event.away_team);
    const book=(event.bookmakers||[]).find(b=>b.key==='draftkings');if(!book)return;
    (book.markets||[]).forEach(m=>{
      if(!NFL_OU_MARKETS[m.key])return;
      const pairs={};
      (m.outcomes||[]).forEach(o=>{const line=numExpansion_(o.point),price=numExpansion_(o.price);if(!['Over','Under'].includes(o.name)||line===null||line<0||price===null||Math.abs(price)<100||!o.description)return;const key=nflOUName_(o.description)+'|'+line;pairs[key]=pairs[key]||{name:o.description,line:line};pairs[key][o.name]=price;});
      Object.values(pairs).forEach(pair=>{
        const candidates=projections.filter(p=>p.market_key===m.key&&nflOUName_(p.player)===nflOUName_(pair.name)&&[home,away].includes(p.team)&&p.opponent===(p.team===home?away:home));
        if(candidates.length!==1||pair.Over===undefined||pair.Under===undefined){unmatched++;return;}
        const p=candidates[0],pk=p.player+'|'+p.team+'|'+p.market_key;
        // More than one line for a player is ambiguous: never choose an alternate silently.
        if(matched.has(pk)){p.quote=null;p.detail.quote_ambiguous=true;return;}matched.add(pk);
        p.quote={bookmaker:'draftkings',event_id:event.id,commence_time:event.commence_time,line:pair.line,over_odds:pair.Over,under_odds:pair.Under,last_update:m.last_update||book.last_update||null,fetched_at:new Date(now).toISOString()};
      });
    });
  });
  return {rows:projections,unmatched:unmatched};
}
function nflOUApi_(path,key){
  let response;
  try {response=UrlFetchApp.fetch('https://api.the-odds-api.com/v4/sports/americanfootball_nfl/'+path+(path.includes('?')?'&':'?')+'apiKey='+encodeURIComponent(key),{muteHttpExceptions:true});}
  catch(e){throw new Error('Odds provider request failed; check connectivity. API key redacted.');}
  const status=response.getResponseCode();
  if(status!==200)throw new Error('Odds provider HTTP '+status+'. Check key, player-prop access and quota.');
  const h=response.getAllHeaders();console.log('Odds API credits remaining: '+(h['x-requests-remaining']||h['X-Requests-Remaining']||'unknown'));
  try{return JSON.parse(response.getContentText());}catch(e){throw new Error('Odds provider returned invalid JSON.');}
}
function refreshNFLPlayerOddsAndProjections(){
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw new Error('Another NFL refresh is running.');
  try {refreshNFLPlayerOddsAndProjections_();}finally{lock.releaseLock();}
}
function refreshNFLPlayerOddsAndProjections_(){
  const started=Date.now(),ss=SpreadsheetApp.getActiveSpreadsheet(),season=Number(NFL.SEASON),week=Number(getCurrentWeek()),properties=PropertiesService.getScriptProperties();
  const key=properties.getProperty('ODDS_API_KEY');if(!key)throw new Error('Add ODDS_API_KEY in Apps Script Project Settings → Script Properties.');
  if(!Number.isInteger(week)||week<1||week>18)throw new Error('Select a regular-season week.');
  const audit=expansionAvailabilityRows_(ss,season,week);if(!audit)throw new Error('Build availability and recent usage first.');
  const raw=expansionTable_(ss,NFL.SHEETS.RAW_PLAYERS,['season','week','position','passing_yards','rushing_yards','receiving_yards','passing_tds','receptions','attempts','carries','targets']);
  const schedule=expansionTable_(ss,NFL.SHEETS.SCHEDULE,['Season','Week','Date','Away','Home','Status']);
  const projections=nflOUProjectionRows_(Array.from(audit.values()),raw,schedule,season,week);
  if(!projections.length)throw new Error('No projections: at least two completed team games with complete stats are needed.');
  const games=schedule.filter(g=>Number(g.Season)===season&&Number(g.Week)===week);
  const events=nflOUApi_('events',key),now=Date.now(),selected=events.filter(e=>{
    if(Date.parse(e.commence_time)<=now)return false;
    const away=nflOUTeam_(e.away_team),home=nflOUTeam_(e.home_team);
    return games.some(g=>expansionSyncTeam_(g.Away)===away&&expansionSyncTeam_(g.Home)===home&&nflOUDate_(g.Date)===Utilities.formatDate(new Date(e.commence_time),'America/New_York','yyyy-MM-dd'));
  });
  console.log('DRAFTKINGS O/U: selected-week future games '+selected.length+'/'+games.length+'; projections '+projections.length);
  const quotes=[];
  selected.forEach(e=>{
    if(Date.now()-started>90000)throw new Error('Odds refresh time limit reached; previous snapshot preserved.');
    quotes.push(nflOUApi_('events/'+encodeURIComponent(e.id)+'/odds?bookmakers=draftkings&markets='+Object.keys(NFL_OU_MARKETS).join(',')+'&oddsFormat=american',key));
  });
  const joined=nflOUJoinQuotes_(projections,quotes,now);
  if(Number(getCurrentWeek())!==week||Number(NFL.SEASON)!==season)throw new Error('Selected season/week changed during odds refresh.');
  const base=String(properties.getProperty('SUPABASE_URL')||'').replace(/\/$/,''),anon=properties.getProperty('SUPABASE_ANON_KEY'),token=properties.getProperty('NFL_RESEARCH_SYNC_TOKEN');
  if(!base||!anon||!token)throw new Error('Supabase sync properties missing.');
  const response=UrlFetchApp.fetch(base+'/functions/v1/atd-expanded-research-sync',{method:'post',contentType:'application/json',muteHttpExceptions:true,headers:{apikey:anon,Authorization:'Bearer '+anon,'x-research-sync-token':token},payload:JSON.stringify({season:season,week:week,ou_projections:joined.rows})});
  if(response.getResponseCode()!==200)throw new Error('O/U sync HTTP '+response.getResponseCode()+' '+response.getContentText());
  console.log('DRAFTKINGS O/U SYNC COMPLETE: '+projections.length+' projections; '+projections.filter(p=>p.quote).length+' paired lines; '+joined.unmatched+' unmatched outcomes. No calibrated hit probabilities or value claims.');
  const headers=['Season','Week','Position','Player','Team','Opponent','Market','Projection','DK Line','Over Odds','Under Odds','Availability','Reason'];
  expansionWriteBoard_(ss,'Player OU Projections',headers,projections.map(p=>[season,week,p.position,p.player,p.team,p.opponent,p.market,p.projection,p.quote?.line??'',p.quote?.over_odds??'',p.quote?.under_odds??'',p.availability,p.detail.reason]));
}
function nflOUDate_(value){return value instanceof Date?Utilities.formatDate(value,'America/New_York','yyyy-MM-dd'):String(value).slice(0,10);}
// Rolling diagnostics only: predicts each completed week with strictly earlier stats.
// No historical sportsbook lines: this cannot establish an over win rate or ROI.
function testNFLPlayerProjections(){
  const ss=SpreadsheetApp.getActiveSpreadsheet(),season=Number(NFL.SEASON),week=Number(getCurrentWeek());
  const raw=expansionTable_(ss,NFL.SHEETS.RAW_PLAYERS,['season','week','position','passing_yards','rushing_yards','receiving_yards','passing_tds','receptions','attempts','carries','targets']);
  const schedule=expansionTable_(ss,NFL.SHEETS.SCHEDULE,['Season','Week','Away','Home','Status']);
  const report=nflOUBacktest_(raw,schedule,season,week);
  Object.entries(report).forEach(([market,r])=>console.log(market+': '+r.samples+' rolling predictions; MAE '+(r.absolute/r.samples).toFixed(1)+'; bias (prediction - actual) '+(r.bias/r.samples).toFixed(1)));
  console.log('PROJECTION DIAGNOSTICS COMPLETE: before-week inputs only; point-total accuracy, not over-hit probability or historical profit.');
}
function nflOUBacktest_(raw,schedule,season,week){
  const results={};
  for(let target=4;target<week;target++){
    const seen=new Set(),audit=[];
    raw.filter(r=>Number(r.season)===season&&Number(r.week)<target&&(!r.season_type||r.season_type==='REG')).forEach(r=>{const team=expansionSyncTeam_(r.recent_team||r.team),player=r.player_display_name||r.player_name||r.player,pos=normalizePosition(r.position),key=expansionNameKey_(player,team);if(!seen.has(key)){seen.add(key);audit.push({Player:player,Team:team,Position:pos,Availability:'Unverified'});}});
    nflOUProjectionRows_(audit,raw,schedule,season,target).forEach(p=>{
      const m=NFL_OU_MARKETS[p.market_key],minimum=p.position==='QB'&&m.volume==='carries'?3:p.position==='WR'&&m.volume==='targets'?3:m.minimum;
      if(p.detail.recent_games<3||p.detail.recent_volume<minimum||p.detail.defense_average===null)return;
      const game=schedule.find(g=>Number(g.Season)===season&&Number(g.Week)===target&&String(g.Status).toLowerCase()==='final'&&[expansionSyncTeam_(g.Away),expansionSyncTeam_(g.Home)].includes(p.team));if(!game)return;
      const teamRows=raw.filter(r=>Number(r.season)===season&&Number(r.week)===target&&expansionSyncTeam_(r.recent_team||r.team)===p.team&&(!r.season_type||r.season_type==='REG'));if(!teamRows.length)return;
      const matches=teamRows.filter(r=>expansionNameKey_(r.player_display_name||r.player_name||r.player,p.team)===expansionNameKey_(p.player,p.team));
      if(matches.length>1)return;
      const actual=matches.length?numExpansion_(matches[0][m.stat]):0;if(actual===null)return;
      results[p.market]=results[p.market]||{samples:0,absolute:0,bias:0};const result=results[p.market];result.samples++;result.absolute+=Math.abs(p.projection-actual);result.bias+=p.projection-actual;
    });
  }
  return results;
}
