// NFL Research dashboard
(function(){
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number(v||0);
  const pct=v=>v==null?'—':`${(n(v)*100).toFixed(1)}%`;
  const state={week:5,position:'WR',defenses:[],best:[],games:[],wr:[]};
  function client(){return window.atdSupabase}
  async function latestWeek(){const{data,error}=await client().from('nfl_defense_targets').select('week').eq('season',2026).order('week',{ascending:false}).limit(1);if(error)throw error;return data?.[0]?.week||5}
  async function load(){
    const sb=client(); if(!sb)return;
    state.week=await latestWeek();
    const [d,b,g,w]=await Promise.all([
      sb.from('nfl_defense_targets').select('*').eq('season',2026).eq('week',state.week).order('position').order('target_rank'),
      sb.from('nfl_best_plays').select('*').eq('season',2026).eq('week',state.week).order('confidence',{ascending:false}),
      sb.from('nfl_game_best_plays').select('*').eq('season',2026).eq('week',state.week).order('game_date').order('game_time').order('play_rank'),
      sb.from('nfl_wr_matchups').select('*').eq('season',2026).eq('week',state.week).order('matchup_score',{ascending:false})
    ]);
    for(const x of [d,b,g,w])if(x.error)throw x.error;
    state.defenses=d.data||[];state.best=b.data||[];state.games=g.data||[];state.wr=w.data||[];
    $('researchWeekLabel').textContent=`Week ${state.week}`;renderDefenses();renderBest();renderGames();renderWR();
  }
  function renderDefenses(){
    const rows=state.defenses.filter(x=>x.position===state.position).slice(0,10);
    $('defenseTargetList').innerHTML=rows.map((x,i)=>`<button class="research-rank-row" type="button" data-defense="${esc(x.defense)}"><span class="research-rank">${i+1}</span><span class="research-team"><strong>${esc(x.defense)}</strong><small>${esc(x.position)} defense rank: ${x.defense_rank||'—'}</small></span><span class="research-metric"><strong>${n(x.td_per_game).toFixed(2)}</strong><small>TD/G allowed</small></span></button>`).join('')||'<div class="dashboard-empty">No defense data.</div>';
    document.querySelectorAll('.research-pos').forEach(b=>b.classList.toggle('active',b.dataset.position===state.position));
  }
  function renderBest(){
    $('researchBestPlays').innerHTML=state.best.slice(0,8).map(x=>`<article class="research-play"><div><span class="research-score">${Math.round(n(x.confidence))}</span></div><div><strong>${esc(x.player)}</strong><span>${esc(x.team)} vs ${esc(x.opponent)} · ${esc(x.play_type||'TD Play')}</span><small>${esc(x.key_reason||'')}</small></div></article>`).join('')||'<div class="dashboard-empty">No qualifying plays.</div>';
  }
  function renderGames(){
    const by={};state.games.forEach(x=>(by[x.game_label]??=[]).push(x));
    $('researchGames').innerHTML=Object.entries(by).map(([game,plays])=>`<article class="research-game"><h3>${esc(game)}</h3>${plays.map(x=>`<div class="research-game-play"><span>#${x.play_rank}</span><div><strong>${esc(x.player)}</strong><small>${esc(x.play_type)} · ${Math.round(n(x.confidence))} confidence</small></div></div>`).join('')}</article>`).join('')||'<div class="dashboard-empty">No game plays.</div>';
  }
  function renderWR(){
    const q=($('researchSearch')?.value||'').trim().toLowerCase();
    const min=n($('researchMinConfidence')?.value||0);
    const conf=new Map(state.best.map(x=>[`${x.player}|${x.team}`,n(x.confidence)]));
    const rows=state.wr.filter(x=>(!q||`${x.player} ${x.team} ${x.opponent}`.toLowerCase().includes(q))&&(!min||n(conf.get(`${x.player}|${x.team}`))>=min));
    $('researchWRTableBody').innerHTML=rows.slice(0,100).map(x=>`<tr><td><strong>${esc(x.player)}</strong><small>${esc(x.team)} vs ${esc(x.opponent)}</small></td><td>${Math.round(n(x.matchup_score))}</td><td>${Math.round(n(x.usage_score))}</td><td>${Math.round(n(x.td_rz_score))}</td><td>${Math.round(n(x.defense_wr_score))}</td><td>${Math.round(n(x.coverage_score))}</td><td>${n(x.targets_per_game).toFixed(1)}</td><td>${pct(x.target_share)}</td><td>${x.inside10_targets??'—'}</td></tr>`).join('');
  }
  function show(){document.querySelectorAll('#appView .view').forEach(v=>v.classList.add('hidden'));$('researchView').classList.remove('hidden');load().catch(e=>{$('researchStatus').textContent=e.message||'Could not load research.';console.error(e)})}
  function back(){$('researchView').classList.add('hidden');$('dashboardView').classList.remove('hidden')}
  document.addEventListener('DOMContentLoaded',()=>{
    $('openResearchBtn')?.addEventListener('click',show);$('researchBackBtn')?.addEventListener('click',back);
    document.querySelectorAll('.research-pos').forEach(b=>b.addEventListener('click',()=>{state.position=b.dataset.position;renderDefenses()}));
    $('researchSearch')?.addEventListener('input',renderWR);$('researchMinConfidence')?.addEventListener('change',renderWR);
  });
})();