// NFL Research dashboard
(function(){
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number(v||0);
  const pct=v=>v==null?'—':`${(n(v)*100).toFixed(1)}%`;
  const state={week:5,position:'WR',defenses:[],best:[],games:[],wr:[],props:[],details:[],bestPosition:'All',propPosition:'All',market:'Passing Yards'};
  function client(){return window.atdSupabase}
  async function latestWeek(){const{data,error}=await client().from('nfl_defense_targets').select('week').eq('season',2026).order('week',{ascending:false}).limit(1);if(error)throw error;return data?.[0]?.week||5}
  async function load(){
    const sb=client(); if(!sb)return;
    state.week=await latestWeek();
    const [d,b,g,w,p,detail]=await Promise.all([
      sb.from('nfl_defense_targets').select('*').eq('season',2026).eq('week',state.week).order('position').order('target_rank'),
      sb.from('nfl_best_plays').select('*').eq('season',2026).eq('week',state.week).order('confidence',{ascending:false}),
      sb.from('nfl_game_best_plays').select('*').eq('season',2026).eq('week',state.week).order('game_date').order('game_time').order('play_rank'),
      sb.from('nfl_wr_matchups').select('*').eq('season',2026).eq('week',state.week).order('matchup_score',{ascending:false}),
      sb.from('nfl_player_props').select('*').eq('season',2026).eq('week',state.week).order('research_score',{ascending:false}),
      sb.from('nfl_player_research_details').select('*').eq('season',2026).eq('week',state.week).order('player')
    ]);
    for(const x of [d,b,g,w])if(x.error)throw x.error;
    state.defenses=d.data||[];state.best=b.data||[];state.games=g.data||[];state.wr=w.data||[];state.props=p.error?[]:(p.data||[]);state.details=detail.error?[]:(detail.data||[]);
    $('researchWeekLabel').textContent=`Week ${state.week}`;renderDefenses();renderBest();renderGames();renderWR();renderProps();renderDeepDive('RB');renderDeepDive('TE');$('researchStatus').textContent=p.error?'Prop research unavailable.':detail.error?'Production details unavailable.':'';
  }
  function renderDefenses(){
    const rows=state.defenses.filter(x=>x.position===state.position).slice(0,10);
    $('researchDefensesCount').textContent=state.position+' · top '+rows.length;
    $('defenseTargetList').innerHTML=rows.map((x,i)=>`<button class="research-rank-row" type="button" data-defense="${esc(x.defense)}"><span class="research-rank">${i+1}</span><span class="research-team"><strong>${esc(x.defense)}</strong><small>${esc(x.position)} defense rank: ${x.defense_rank||'—'}</small></span><span class="research-metric"><strong>${n(x.td_per_game).toFixed(2)}</strong><small>TD/G allowed</small></span></button>`).join('')||'<div class="dashboard-empty">No defense data.</div>';
    document.querySelectorAll('.research-pos').forEach(b=>b.classList.toggle('active',b.dataset.position===state.position));
  }
  function positionOf(x){return x.position||(/^(QB|RB|TE) Anytime TD$/.exec(x.play_type||'')?.[1])||'WR'}
  function renderBest(){
    const rows=state.best.filter(x=>state.bestPosition==='All'||positionOf(x)===state.bestPosition)
      .sort((a,b)=>n(b.confidence)-n(a.confidence)||String(a.player).localeCompare(String(b.player)));
    $('researchBestCount').textContent=rows.length+' plays';
    $('researchBestPlays').innerHTML=rows.map((x,i)=>`<article class="research-play"><div><small class="research-list-rank">#${i+1}</small><span class="research-score">${Math.round(n(x.confidence))}</span></div><div>${playerLink(x,'best')}<span><span class="research-position-badge">${esc(positionOf(x))}</span> ${esc(x.team)} vs ${esc(x.opponent)} · Anytime TD</span><small>Research score · ${esc(x.availability||'Unverified')}</small><small>${esc(explanation(x,'Anytime TD').reasons[0])}</small></div></article>`).join('')||'<div class="dashboard-empty">No qualifying plays.</div>';
  }
  function renderProps(){
    const rows=state.props.filter(x=>x.market===state.market&&(state.propPosition==='All'||x.position===state.propPosition));
    $('researchPropsCount').textContent=rows.length+' props';
    $('researchProps').innerHTML=rows.slice(0,30).map(x=>`<article class="research-play"><div><span class="research-score">${Math.round(n(x.research_score))}</span></div><div>${playerLink(x,'props',x.player+' · '+x.position)}<span>${esc(x.team)} vs ${esc(x.opponent)} · ${esc(x.market)}</span><small>Research score · ${esc(x.availability||'Unverified')}</small><small>${esc(explanation(x,x.market).reasons[0])}</small></div></article>`).join('')||'<div class="dashboard-empty">No synced research for this market and position.</div>';
  }
  function renderGames(){
    const by={};state.games.forEach(x=>(by[x.game_label]??=[]).push(x));
    $('researchGamesCount').textContent=Object.keys(by).length+' games';
    $('researchGames').innerHTML=Object.entries(by).map(([game,plays])=>`<article class="research-game"><h3><button type="button" class="research-detail-link" data-detail-game="${esc(game)}">${esc(game)} <span aria-hidden="true">›</span></button></h3>${plays.map(x=>`<div class="research-game-play"><span>#${x.play_rank}</span><div>${playerLink(x,'games')}<small>${esc(x.play_type)} · ${Math.round(n(x.confidence))} research score · ${esc(x.availability||'Unverified')}</small></div></div>`).join('')}</article>`).join('')||'<div class="dashboard-empty">No game plays.</div>';
  }
  function renderWR(){
    const q=($('researchSearch')?.value||'').trim().toLowerCase();
    const min=n($('researchMinConfidence')?.value||0);
    const conf=new Map(state.best.map(x=>[`${x.player}|${x.team}`,n(x.confidence)]));
    const rows=state.wr.filter(x=>(!q||`${x.player} ${x.team} ${x.opponent}`.toLowerCase().includes(q))&&(!min||n(conf.get(`${x.player}|${x.team}`))>=min));
    $('researchWRCount').textContent=rows.length+' WRs';
    $('researchWRTableBody').innerHTML=rows.slice(0,100).map(x=>`<tr><td>${playerLink(x,'wr')}<small>${esc(x.team)} vs ${esc(x.opponent)}</small></td><td>${Math.round(n(x.matchup_score))}</td><td>${Math.round(n(x.usage_score))}</td><td>${Math.round(n(x.td_rz_score))}</td><td>${Math.round(n(x.defense_wr_score))}</td><td>${Math.round(n(x.coverage_score))}</td><td>${n(x.targets_per_game).toFixed(1)}</td><td>${pct(x.target_share)}</td><td>${x.inside10_targets??'—'}</td></tr>`).join('');
  }
  const teamKey=t=>t==='LA'?'LAR':t;
  const teamOf=x=>x.team||x.player_team;
  const nameKey=v=>String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g,'').replace(/\s+/g,' ').trim();
  const samePlayer=(a,b)=>nameKey(a.player)===nameKey(b.player)&&teamKey(teamOf(a))===teamKey(teamOf(b))&&(!a.position||!b.position||a.position===b.position);
  const value=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const fmt=(v,d=1)=>value(v)?Number(v).toFixed(d):'—';
  function playerLink(x,source,label){return `<button type="button" class="research-detail-link" data-detail-source="${source}" data-detail-index="${state[source].indexOf(x)}">${esc(label||x.player)}</button>`}
  function contextOf(x){
    const match=state.best.find(b=>samePlayer(b,x));
    const prop=state.props.find(p=>samePlayer(p,x));
    const text=String(x.notes||x.key_reason||match?.key_reason||prop?.notes||'');
    const current=text.includes('[Current context]')?text.split('[Current context]')[1]:'';
    const metric=name=>{const m=current.match(new RegExp(name+'/G (unknown|[0-9]+(?:\\.[0-9]+)?)'));return m&&m[1]!=='unknown'?Number(m[1]):null};
    const weeks=current.match(/Recent team weeks ([0-9, ]+)/)?.[1]?.trim()||'';
    const role=current.match(/; (Listed starter|Depth rank \d+|Recent passing leader; starter unverified|Role unverified); usage/)?.[1]||'Role unverified';
    const trend=current.match(/; usage ([^.]+)\./)?.[1]||'Unknown';
    return {text,current,pass:metric('pass'),rush:metric('carries'),targets:metric('targets'),weeks,role,trend,source:current.split('Source: ')[1]||''};
  }
  function productionOf(x){return state.details.find(d=>samePlayer(d,x))?.detail||null}
  function explanation(x,market){
    const pos=positionOf(x), c=contextOf(x), production=productionOf(x), wr=state.wr.find(w=>samePlayer(w,x)), reasons=[];
    const atd=market==='Anytime TD'||market==='WR Matchup';
    const primary=market.startsWith('Passing')?'pass':market.startsWith('Rushing')?'rush':market.startsWith('Receiving')?'rec':pos==='QB'||pos==='RB'?'rush':'rec';
    const direction={pass:'passing',rush:'rushing',rec:'receiving'}[primary];
    if(production){
      const last=production.latest||{}, recent=production.recent||{}, defense=production.defense||{};
      const yards=primary+'_yards',td=primary+'_td',weeks=production.recent_weeks||[],games=Number(production.recent_games||weeks.length);
      if(value(last[yards])) reasons.push(`${x.player} had ${fmt(last[yards],0)} ${direction} yards${value(last[td])?` and ${fmt(last[td],0)} ${direction} touchdowns`:''} in his team's last completed game (Week ${production.latest_week}).`);
      if(value(recent[yards])) reasons.push(`Over the last ${games} completed team games (Weeks ${weeks.join(', ')}), he averaged ${fmt(recent[yards])} ${direction} yards${value(recent[td])?` and ${fmt(recent[td],1)} ${direction} touchdowns`:''} per game.`);
      if(value(defense[yards])) reasons.push(`${x.opponent} allows ${fmt(defense[yards])} ${direction} yards per game ${primary==='pass'?'to quarterbacks':`to ${pos}s`}${value(defense[td])?`, plus ${fmt(defense[td],1)} ${direction} touchdowns per game`:''}, across ${defense.games} completed games this season.`);
      if(atd&&pos==='RB'){
        if(value(last.rec_yards)&&value(last.rec_td))reasons.push(`He also had ${fmt(last.rec_yards,0)} receiving yards and ${fmt(last.rec_td,0)} receiving touchdowns in that last game. Either a rushing or receiving touchdown can count for an RB anytime-TD bet.`);
        if(value(defense.rec_td))reasons.push(`${x.opponent} also allows ${value(defense.rec_yards)?fmt(defense.rec_yards)+' receiving yards and ':''}${fmt(defense.rec_td,1)} receiving touchdowns per game to RBs.`);
      }
      const volume=primary==='pass'?'attempts':primary==='rush'?'carries':'targets';
      if(value(last[volume])&&value(recent[volume]))reasons.push(`Workload: ${fmt(last[volume],0)} ${volume==='attempts'?'pass attempts':volume} in the last team game; ${fmt(recent[volume])} per game over the last ${games}.`);
      if(!value(defense[yards]))reasons.push(`A complete ${x.opponent} ${direction}-yard allowance is unavailable in this snapshot.`);
    }else{
      const metric=primary==='pass'?'pass':primary==='rush'?'rush':'targets', label={pass:'pass attempts',rush:'carries',targets:'targets'}[metric];
      if(value(c[metric]))reasons.push(`${x.player} averaged ${fmt(c[metric])} ${label} per completed team game in Weeks ${c.weeks||'shown in the source'}. Last-game production and opponent yard allowances have not been synced for this player yet.`);
      else if(wr&&value(wr.targets_per_game))reasons.push(`${x.player} averages ${fmt(wr.targets_per_game)} targets per game in the WR snapshot. Last-game yardage has not been synced yet.`);
      else reasons.push('Recent production and opponent yard allowances are not available for this player yet.');
    }
    if(atd&&pos==='WR'&&wr){
      if(value(wr.inside10_targets))reasons.push(`Goal-line receiving usage: ${fmt(wr.inside10_targets,0)} inside-the-10 targets in the WR snapshot.`);
      if(value(wr.season_td)&&value(wr.last3_td))reasons.push(`Receiving touchdowns: ${fmt(wr.season_td,0)} this season; ${fmt(wr.last3_td,0)} in the WR model's last-three-game window.`);
    }
    if(atd&&pos==='QB')reasons.push('For anytime TD, only his rushing touchdown signal is used. Passing touchdowns do not count toward this bet.');
    return {reasons,c,wr,production};
  }
  function renderDeepDive(pos){
    const q=($(pos==='RB'?'researchRBSearch':'researchTESearch')?.value||'').trim().toLowerCase();
    const hide=$(pos==='RB'?'researchRBAvailability':'researchTEAvailability')?.value!=='all';
    const rows=state.details.filter(x=>x.position===pos&&(!q||`${x.player} ${x.team} ${x.opponent}`.toLowerCase().includes(q))&&(!hide||!restricted(x.detail?.availability))).sort((a,b)=>{
      const score=x=>state.best.find(r=>samePlayer(r,x))?.confidence??-1;
      return Number(score(b))-Number(score(a))||a.player.localeCompare(b.player);
    });
    $('research'+pos+'Count').textContent=rows.length+' players';
    const metric=pos==='RB'?'rush_yards':'rec_yards';
    const score=(x,market)=>state.props.find(p=>samePlayer(p,x)&&p.market===market)?.research_score;
    $('research'+pos+'TableBody').innerHTML=rows.map(x=>{
      const d=x.detail||{},recent=d.recent||{},last=d.latest||{},def=d.defense||{},best=state.best.find(b=>samePlayer(b,x));
      return `<tr><td>${playerLink(x,'details')}<small>${esc(x.team)} vs ${esc(x.opponent)} · ${esc(d.role||'Role unverified')}</small></td><td>${fmt(best?.confidence,0)}</td><td>${fmt(score(x,pos==='RB'?'Rushing Yards':'Receiving Yards'),0)}</td><td>${fmt(score(x,pos==='TE'?'Receiving TD':'Receiving Yards'),0)}</td><td>${fmt(last[metric],0)}<small>Week ${esc(d.latest_week??'—')}</small></td><td>${fmt(recent[metric])}</td><td>${fmt(def[metric])}<small>${esc(def.games??'—')} games</small></td><td>${fmt(recent[pos==='RB'?'carries':'targets'])}</td><td>${esc(d.availability||'Unverified')}</td></tr>`;
    }).join('')||'<tr><td colspan="9">No synced players match these filters.</td></tr>';
  }
  function restricted(status){return /^(out|inactive|injured reserve|ir|suspended|reserve|practice squad|released|retired|exempt)(\b|$)/i.test(status||'')}
  function detailFrame(title,body){
    $('researchDetailTitle').textContent=title;
    $('researchDetailBody').innerHTML=body;
    const dialog=$('researchDetailDialog');
    if(!dialog.open)dialog.showModal();
  }
  function openPlayer(x,market='Anytime TD'){
    const pos=positionOf(x), data=explanation(x,market), detail=productionOf(x), score=market==='Anytime TD'?(x.confidence??state.best.find(b=>samePlayer(b,x))?.confidence):market==='WR Matchup'?x.matchup_score:x.research_score;
    const props=state.props.filter(p=>samePlayer(p,x));
    const best=state.best.find(b=>samePlayer(b,x));
    const status=x.availability||detail?.availability||best?.availability||props[0]?.availability||'Unverified';
    const caution=/out|reserve|inactive|released|practice squad|suspended/i.test(status)?'The synced status indicates a restriction. Review availability before considering this player.':/questionable|doubtful/i.test(status)?'The injury designation needs review before considering this player.':'Active-roster and depth labels do not establish game-day availability.';
    const metrics=[['Recent pass attempts/G',detail?.recent?.attempts??data.c.pass],['Recent carries/G',detail?.recent?.carries??data.c.rush],['Recent targets/G',detail?.recent?.targets??data.c.targets]];
    const updated=x.updated_at?new Date(x.updated_at):null;
    detailFrame(x.player,`<p class="research-detail-kicker">${esc(pos)} · ${esc(teamOf(x))} vs ${esc(x.opponent)} · Week ${state.week}</p><div class="research-detail-hero"><span class="research-score">${value(score)?Math.round(Number(score)):'—'}</span><div><strong>${esc(market)}</strong><small>${value(score)?'Research index / 100':'No qualifying score synced for this market'}</small></div></div><div class="research-detail-markets">${best?playerLink(best,'best','Anytime TD'):''}${props.map(p=>playerLink(p,'props',p.market)).join('')}</div><h3>Recent production vs. opponent</h3>${data.reasons.map(r=>`<p>${esc(r)}</p>`).join('')}<div class="research-detail-metrics">${metrics.map(([label,v])=>`<div><small>${esc(label)}</small><strong>${fmt(v)}</strong></div>`).join('')}</div><h3>Availability and limits</h3><p><strong>${esc(status)}</strong> · ${esc(detail?.role||data.c.role)}</p><p>${esc(caution)} Averages use completed games before Week ${state.week}. Missed team games count as zero when stats coverage is present. Defensive yardage is allowed to the entire position group, not to one player. These scores rank research signals; they are not hit probabilities, projected yards, or evidence that a sportsbook line offers value.</p><details><summary>Model and source details</summary><p>${esc(x.score_basis||best?.score_basis||(pos==='WR'?'WR matchup research model':'Position-specific FTN player and defensive allowance research indices'))}</p><p>${esc(detail?.source||data.c.source||'Current context source not included in this snapshot.')}</p><p>Synced: ${updated&&!Number.isNaN(updated.getTime())?esc(updated.toLocaleString()):'Unknown'}</p>${data.c.text?`<p class="research-source-note">${esc(data.c.text)}</p>`:''}</details>`);
  }
  function openGame(label){
    const games=state.games.filter(g=>g.game_label===label);if(!games.length)return;
    const g=games[0], teams=[teamKey(g.away_team),teamKey(g.home_team)];
    const best=state.best.filter(b=>teams.includes(teamKey(b.team))&&teams.includes(teamKey(b.opponent)));
    const props=state.props.filter(p=>teams.includes(teamKey(p.team))&&teams.includes(teamKey(p.opponent)));
    const defenses=state.defenses.filter(d=>teams.includes(teamKey(d.defense)));
    detailFrame(label,`<p class="research-detail-kicker">Week ${state.week} · ${esc(g.game_date||'Date unavailable')} ${esc(g.game_time||'')} · Source schedule time</p><h3>Anytime TD candidates</h3><p>Grouped by position because WR and expansion scores use different models.</p>${['WR','QB','RB','TE'].map(pos=>{const rows=best.filter(b=>positionOf(b)===pos);return rows.length?`<h4>${pos}</h4>${rows.map(b=>`<div class="research-detail-row">${playerLink(b,'best')}<span>${fmt(b.confidence,0)} · ${esc(b.availability||'Unverified')}</span></div>`).join('')}`:''}).join('')||'<p>No synced ATD candidates.</p>'}<h3>Prop research</h3>${['Passing TD','Passing Yards','Rushing TD','Rushing Yards','Receiving TD','Receiving Yards'].map(m=>{const rows=props.filter(p=>p.market===m).sort((a,b)=>n(b.research_score)-n(a.research_score));return rows.length?`<h4>${esc(m)}</h4>${rows.map(p=>`<div class="research-detail-row">${playerLink(p,'props',p.player+' · '+p.position)}<span>${fmt(p.research_score,0)}</span></div>`).join('')}`:''}).join('')||'<p>No synced prop research.</p>'}<h3>Opponent touchdown context</h3><div class="research-detail-metrics">${defenses.map(d=>`<div><small>${esc(d.defense)} · ${esc(d.position)}${d.position==='QB'?' rushing':''} TD/G allowed</small><strong>${fmt(d.td_per_game,2)}</strong><small>${esc(d.games)} games · attack rank ${esc(d.target_rank)}</small></div>`).join('')}</div><p class="research-note">These are touchdown allowance figures, not yardage forecasts. Click a player to see the evidence and availability behind the ranking.</p>`);
  }

  function show(){$('researchStatus').textContent='Loading…';document.querySelectorAll('#appView .view').forEach(v=>v.classList.add('hidden'));$('researchView').classList.remove('hidden');load().catch(e=>{$('researchStatus').textContent=e.message||'Could not load research.';console.error(e)})}
  function back(){$('researchView').classList.add('hidden');$('dashboardView').classList.remove('hidden')}
  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelectorAll('[data-research-jump]').forEach(button=>button.addEventListener('click',()=>{
      const section=$(button.dataset.researchJump);
      if(!section)return;
      section.open=true;
      section.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
    }));
    $('researchExpandAll')?.addEventListener('click',()=>{
      const sections=Array.from(document.querySelectorAll('.research-section'));
      const open=sections.some(section=>!section.open);
      sections.forEach(section=>section.open=open);
      $('researchExpandAll').textContent=open?'Collapse all':'Expand all';
    });
    document.querySelectorAll('.research-section').forEach(section=>section.addEventListener('toggle',()=>{
      $('researchExpandAll').textContent=Array.from(document.querySelectorAll('.research-section')).every(x=>x.open)?'Collapse all':'Expand all';
    }));
    const updateResearchEntry=()=>{ $('openResearchBtn').hidden=(window.atdCurrentSport||'football')!=='football'; };
    document.addEventListener('click',event=>{if(event.target.closest('[data-sport]'))setTimeout(updateResearchEntry,0)});
    updateResearchEntry();
    $('researchView')?.addEventListener('click',detailClick);
    $('researchDetailBody')?.addEventListener('click',detailClick);
    $('researchDetailClose')?.addEventListener('click',()=>$('researchDetailDialog').close());
    function detailClick(event){
      const button=event.target.closest('[data-detail-source],[data-detail-game]');
      if(!button)return;
      if(button.dataset.detailGame!==undefined){openGame(button.dataset.detailGame);return;}
      const source=button.dataset.detailSource;
      if(!['best','props','wr','games','details'].includes(source))return;
      const row=state[source][Number(button.dataset.detailIndex)];
      if(row)openPlayer(row,source==='props'?row.market:source==='wr'?'WR Matchup':'Anytime TD');
    }
    $('openResearchBtn')?.addEventListener('click',show);$('researchBackBtn')?.addEventListener('click',back);
    document.querySelectorAll('.research-pos').forEach(b=>b.addEventListener('click',()=>{state.position=b.dataset.position;renderDefenses()}));
    $('researchBestPosition')?.addEventListener('change',e=>{state.bestPosition=e.target.value;renderBest()});
    $('researchPropPosition')?.addEventListener('change',e=>{state.propPosition=e.target.value;renderProps()});
    $('researchPropMarket')?.addEventListener('change',e=>{state.market=e.target.value;renderProps()});
    ['RB','TE'].forEach(pos=>{ $('research'+pos+'Search')?.addEventListener('input',()=>renderDeepDive(pos));$('research'+pos+'Availability')?.addEventListener('change',()=>renderDeepDive(pos)); });
    $('researchSearch')?.addEventListener('input',renderWR);$('researchMinConfidence')?.addEventListener('change',renderWR);
  });
})();


