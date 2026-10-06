// NFL Research dashboard
(function(){
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number(v||0);
  const pct=v=>v==null?'—':`${(n(v)*100).toFixed(1)}%`;
  const state={week:5,position:'WR',defenses:[],best:[],games:[],wr:[],props:[],bestPosition:'All',propPosition:'All',market:'Passing Yards'};
  function client(){return window.atdSupabase}
  async function latestWeek(){const{data,error}=await client().from('nfl_defense_targets').select('week').eq('season',2026).order('week',{ascending:false}).limit(1);if(error)throw error;return data?.[0]?.week||5}
  async function load(){
    const sb=client(); if(!sb)return;
    state.week=await latestWeek();
    const [d,b,g,w,p]=await Promise.all([
      sb.from('nfl_defense_targets').select('*').eq('season',2026).eq('week',state.week).order('position').order('target_rank'),
      sb.from('nfl_best_plays').select('*').eq('season',2026).eq('week',state.week).order('confidence',{ascending:false}),
      sb.from('nfl_game_best_plays').select('*').eq('season',2026).eq('week',state.week).order('game_date').order('game_time').order('play_rank'),
      sb.from('nfl_wr_matchups').select('*').eq('season',2026).eq('week',state.week).order('matchup_score',{ascending:false}),
      sb.from('nfl_player_props').select('*').eq('season',2026).eq('week',state.week).order('research_score',{ascending:false})
    ]);
    for(const x of [d,b,g,w])if(x.error)throw x.error;
    state.defenses=d.data||[];state.best=b.data||[];state.games=g.data||[];state.wr=w.data||[];state.props=p.error?[]:(p.data||[]);
    $('researchWeekLabel').textContent=`Week ${state.week}`;renderDefenses();renderBest();renderGames();renderWR();renderProps();$('researchStatus').textContent=p.error?'Prop research unavailable.':'';
  }
  function renderDefenses(){
    const rows=state.defenses.filter(x=>x.position===state.position).slice(0,10);
    $('defenseTargetList').innerHTML=rows.map((x,i)=>`<button class="research-rank-row" type="button" data-defense="${esc(x.defense)}"><span class="research-rank">${i+1}</span><span class="research-team"><strong>${esc(x.defense)}</strong><small>${esc(x.position)} defense rank: ${x.defense_rank||'—'}</small></span><span class="research-metric"><strong>${n(x.td_per_game).toFixed(2)}</strong><small>TD/G allowed</small></span></button>`).join('')||'<div class="dashboard-empty">No defense data.</div>';
    document.querySelectorAll('.research-pos').forEach(b=>b.classList.toggle('active',b.dataset.position===state.position));
  }
  function positionOf(x){return x.position||(/^(QB|RB|TE) Anytime TD$/.exec(x.play_type||'')?.[1])||'WR'}
  function renderBest(){
    const positions=state.bestPosition==='All'?['WR','QB','RB','TE']:[state.bestPosition];
    $('researchBestPlays').innerHTML=positions.map(pos=>{
      const rows=state.best.filter(x=>positionOf(x)===pos).sort((a,b)=>pos==='WR'?n(a.rank)-n(b.rank):n(b.confidence)-n(a.confidence)).slice(0,8);
      if(!rows.length)return '';
      return `<h3>${esc(pos)} · Anytime TD</h3>`+rows.map(x=>`<article class="research-play"><div><span class="research-score">${Math.round(n(x.confidence))}</span></div><div>${playerLink(x,'best')}<span>${esc(x.team)} vs ${esc(x.opponent)} · ${esc(x.play_type||'Anytime TD')}</span><small>Research score · ${esc(x.availability||'Unverified')}</small><small>${esc(explanation(x,'Anytime TD').reasons[0])}</small></div></article>`).join('');
    }).join('')||'<div class="dashboard-empty">No qualifying plays.</div>';
  }
  function renderProps(){
    const rows=state.props.filter(x=>x.market===state.market&&(state.propPosition==='All'||x.position===state.propPosition));
    $('researchProps').innerHTML=rows.slice(0,30).map(x=>`<article class="research-play"><div><span class="research-score">${Math.round(n(x.research_score))}</span></div><div>${playerLink(x,'props',x.player+' · '+x.position)}<span>${esc(x.team)} vs ${esc(x.opponent)} · ${esc(x.market)}</span><small>Research score · ${esc(x.availability||'Unverified')}</small><small>${esc(explanation(x,x.market).reasons[0])}</small></div></article>`).join('')||'<div class="dashboard-empty">No synced research for this market and position.</div>';
  }
  function renderGames(){
    const by={};state.games.forEach(x=>(by[x.game_label]??=[]).push(x));
    $('researchGames').innerHTML=Object.entries(by).map(([game,plays])=>`<article class="research-game"><h3><button type="button" class="research-detail-link" data-detail-game="${esc(game)}">${esc(game)} <span aria-hidden="true">›</span></button></h3>${plays.map(x=>`<div class="research-game-play"><span>#${x.play_rank}</span><div>${playerLink(x,'games')}<small>${esc(x.play_type)} · ${Math.round(n(x.confidence))} research score · ${esc(x.availability||'Unverified')}</small></div></div>`).join('')}</article>`).join('')||'<div class="dashboard-empty">No game plays.</div>';
  }
  function renderWR(){
    const q=($('researchSearch')?.value||'').trim().toLowerCase();
    const min=n($('researchMinConfidence')?.value||0);
    const conf=new Map(state.best.map(x=>[`${x.player}|${x.team}`,n(x.confidence)]));
    const rows=state.wr.filter(x=>(!q||`${x.player} ${x.team} ${x.opponent}`.toLowerCase().includes(q))&&(!min||n(conf.get(`${x.player}|${x.team}`))>=min));
    $('researchWRTableBody').innerHTML=rows.slice(0,100).map(x=>`<tr><td>${playerLink(x,'wr')}<small>${esc(x.team)} vs ${esc(x.opponent)}</small></td><td>${Math.round(n(x.matchup_score))}</td><td>${Math.round(n(x.usage_score))}</td><td>${Math.round(n(x.td_rz_score))}</td><td>${Math.round(n(x.defense_wr_score))}</td><td>${Math.round(n(x.coverage_score))}</td><td>${n(x.targets_per_game).toFixed(1)}</td><td>${pct(x.target_share)}</td><td>${x.inside10_targets??'—'}</td></tr>`).join('');
  }
  const teamKey=t=>t==='LA'?'LAR':t;
  const teamOf=x=>x.team||x.player_team;
  const samePlayer=(a,b)=>a.player===b.player&&teamKey(teamOf(a))===teamKey(teamOf(b));
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
  function explanation(x,market){
    const pos=positionOf(x), c=contextOf(x), reasons=[];
    const wr=state.wr.find(w=>samePlayer(w,x));
    const atd=market==='Anytime TD'||market==='WR Matchup';
    const metric=market.startsWith('Passing')?'pass':market.startsWith('Rushing')?'rush':market.startsWith('Receiving')?'targets':pos==='QB'?'rush':pos==='RB'?'rush':'targets';
    const label={pass:'pass attempts',rush:'carries',targets:'targets'}[metric];
    if(!value(c[metric])&&!wr) reasons.push('Recent workload is not included in this synced record, so the explanation cannot establish how many opportunities this player is receiving.');
    if(value(c[metric])) reasons.push(`${x.player} averaged ${fmt(c[metric])} ${label} per completed team game in recent weeks ${c.weeks||'shown in the source'}. ${metric==='pass'?'Passing volume supplies opportunities for passing production.':metric==='rush'?'Rushing volume supplies opportunities for yards and rushing touchdowns.':'Targets supply opportunities for receiving yards and touchdowns.'}`);
    if(atd&&pos==='RB'&&value(c.targets)) reasons.push(`An additional ${fmt(c.targets)} targets per recent team game adds receiving opportunities to the rushing workload; either a rushing or receiving touchdown can count for anytime TD.`);
    if(wr&&(atd||market.startsWith('Receiving'))){
      if(!value(c.targets)&&value(wr.targets_per_game)) reasons.push(`The WR snapshot shows ${fmt(wr.targets_per_game)} targets per game${value(wr.target_share)?` and ${(Number(wr.target_share)*100).toFixed(1)}% of team targets`:''}, which measures his share of receiving opportunities.`);
      if(value(wr.inside10_targets)) reasons.push(`${wr.inside10_targets} inside-the-10 targets in the WR snapshot show ${Number(wr.inside10_targets)>0?'usage near the goal line, where a catch can produce a touchdown':'no recorded receiving opportunities inside the 10 in that snapshot'}.`);
      if(value(wr.season_td)&&value(wr.last3_td)) reasons.push(`He has ${wr.season_td} season receiving touchdowns, including ${wr.last3_td} in the last three games reported by the WR model. Past touchdowns describe production; they do not guarantee another score.`);
      const scores=[['usage',wr.usage_score],['TD/red-zone',wr.td_rz_score],['defense',wr.defense_wr_score],['coverage',wr.coverage_score]].filter(a=>value(a[1])).sort((a,b)=>Number(b[1])-Number(a[1]));
      if(scores.length) reasons.push(`Within the WR model, the highest component is ${scores[0][0]} (${fmt(scores[0][1],0)}/100)${scores.length>1?`, while ${scores[scores.length-1][0]} is the lowest (${fmt(scores[scores.length-1][1],0)}/100)`:''}. The overall ranking combines these signals.`);
    }
    if(atd){
      const defense=state.defenses.find(d=>teamKey(d.defense)===teamKey(x.opponent)&&d.position===pos);
      if(defense&&value(defense.td_per_game)&&value(defense.games)) reasons.push(`${x.opponent} has allowed ${fmt(defense.td_per_game,2)} ${pos==='QB'?'QB rushing touchdowns':pos+' touchdowns'} per game across ${defense.games} games. Its ${pos} attack rank is ${defense.target_rank??'unavailable'} (${Number(defense.target_rank)<=10?'among the ten most permissive defenses in this view':'outside the ten most permissive defenses in this view'}). This is touchdown matchup context${Number(defense.games)<5?', with a small sample':''}.`);
      if(pos==='QB') reasons.push('This anytime-TD ranking uses rushing touchdown signals. Passing touchdowns do not count toward a quarterback anytime-TD bet.');
    }else if(pos!=='WR') reasons.push(`The ${market.toLowerCase()} score combines a position-specific FTN player index with a market-specific defensive allowance index. The individual component values are not included in this synced dataset, so no additional numeric breakdown is inferred.`);
    if(c.role!=='Role unverified') reasons.push(`Current role: ${c.role}. ${c.role==='Listed starter'?'The depth source lists him first at his position; it does not confirm game-day availability.':'Use the role label alongside recent volume; it is not confirmation of game-day availability.'}`);
    if(c.trend==='Up'||c.trend==='Down') reasons.push(`Recent primary usage is ${c.trend.toLowerCase()} versus the preceding three-team-game window; this trend describes workload, not a forecast for this particular market.`);
    if(!reasons.length) reasons.push('The synced model supplies a research ranking, but detailed workload and component evidence are not available for this player.');
    return {reasons,c,wr};
  }
  function detailFrame(title,body){
    $('researchDetailTitle').textContent=title;
    $('researchDetailBody').innerHTML=body;
    const dialog=$('researchDetailDialog');
    if(!dialog.open)dialog.showModal();
  }
  function openPlayer(x,market='Anytime TD'){
    const pos=positionOf(x), data=explanation(x,market), score=market==='Anytime TD'?x.confidence:market==='WR Matchup'?x.matchup_score:x.research_score;
    const props=state.props.filter(p=>samePlayer(p,x));
    const best=state.best.find(b=>samePlayer(b,x));
    const status=x.availability||best?.availability||props[0]?.availability||'Unverified';
    const caution=/out|reserve|inactive|released|practice squad|suspended/i.test(status)?'The synced status indicates a restriction. Review availability before considering this player.':/questionable|doubtful/i.test(status)?'The injury designation needs review before considering this player.':'Active-roster and depth labels do not establish game-day availability.';
    const metrics=[['Recent pass attempts/G',data.c.pass],['Recent carries/G',data.c.rush],['Recent targets/G',data.c.targets]];
    const updated=x.updated_at?new Date(x.updated_at):null;
    detailFrame(x.player,`<p class="research-detail-kicker">${esc(pos)} · ${esc(teamOf(x))} vs ${esc(x.opponent)} · Week ${state.week}</p><div class="research-detail-hero"><span class="research-score">${value(score)?Math.round(Number(score)):'—'}</span><div><strong>${esc(market)}</strong><small>Research index / 100</small></div></div><div class="research-detail-markets">${best?playerLink(best,'best','Anytime TD'):''}${props.map(p=>playerLink(p,'props',p.market)).join('')}</div><h3>Why the model ranks this player here</h3>${data.reasons.map(r=>`<p>${esc(r)}</p>`).join('')}<div class="research-detail-metrics">${metrics.map(([label,v])=>`<div><small>${esc(label)}</small><strong>${fmt(v)}</strong></div>`).join('')}</div><h3>Availability and limits</h3><p><strong>${esc(status)}</strong> · ${esc(data.c.role)}</p><p>${esc(caution)} These scores rank research signals; they are not hit probabilities, projected yards, or evidence that a sportsbook line offers value.</p><details><summary>Model and source details</summary><p>${esc(x.score_basis||best?.score_basis||'WR matchup research model')}</p><p>${esc(data.c.source||'Current context source not included in this snapshot.')}</p><p>Synced: ${updated&&!Number.isNaN(updated.getTime())?esc(updated.toLocaleString()):'Unknown'}</p>${data.c.text?`<p class="research-source-note">${esc(data.c.text)}</p>`:''}</details>`);
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
    $('researchView')?.addEventListener('click',detailClick);
    $('researchDetailBody')?.addEventListener('click',detailClick);
    $('researchDetailClose')?.addEventListener('click',()=>$('researchDetailDialog').close());
    function detailClick(event){
      const button=event.target.closest('[data-detail-source],[data-detail-game]');
      if(!button)return;
      if(button.dataset.detailGame!==undefined){openGame(button.dataset.detailGame);return;}
      const source=button.dataset.detailSource;
      if(!['best','props','wr','games'].includes(source))return;
      const row=state[source][Number(button.dataset.detailIndex)];
      if(row)openPlayer(row,source==='props'?row.market:source==='wr'?'WR Matchup':'Anytime TD');
    }
    $('openResearchBtn')?.addEventListener('click',show);$('researchBackBtn')?.addEventListener('click',back);
    document.querySelectorAll('.research-pos').forEach(b=>b.addEventListener('click',()=>{state.position=b.dataset.position;renderDefenses()}));
    $('researchBestPosition')?.addEventListener('change',e=>{state.bestPosition=e.target.value;renderBest()});
    $('researchPropPosition')?.addEventListener('change',e=>{state.propPosition=e.target.value;renderProps()});
    $('researchPropMarket')?.addEventListener('change',e=>{state.market=e.target.value;renderProps()});
    $('researchSearch')?.addEventListener('input',renderWR);$('researchMinConfidence')?.addEventListener('change',renderWR);
  });
})();
