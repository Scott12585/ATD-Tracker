(function(){
  const $=id=>document.getElementById(id);
  const profit=(stake,odds)=>Number(odds)>0?Number(stake||0)*Number(odds)/100:Number(stake||0)*100/Math.abs(Number(odds)||1);
  const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v||0));
  const odds=v=>{const n=Number(v);return Number.isFinite(n)?`${n>0?'+':''}${n}`:''};
  const dt=v=>v?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York'}).format(new Date(v)):'—';
  function prop(b){const t=String(b.bet_type||'point').toLowerCase(),n=t==='goal'?'Goal':t==='assist'?'Assist':'Point',x=Number(b.stat_target||1);return `${x}+ ${n}${x>1?'s':''}`}
  async function refreshHockeyBet(b){
    const client=window.atdSupabase;
    if(!client)throw new Error('Tracker connection is not ready.');
    const {data,error}=await client.functions.invoke('atd-live',{body:{sport:'hockey',gameId:b.game_id,playerId:b.player_id,betType:b.bet_type,statTarget:Number(b.stat_target||1)}});
    if(error)throw error;
    if(data?.error)throw new Error(data.error);
    const result=data.result||'Pending';
    const actualPL=result==='Won'?profit(b.stake,b.american_odds):result==='Lost'?-Number(b.stake||0):0;
    const {error:updateError}=await client.from('atd_bets').update({current_stat:Number(data.current_stat||0),result,game_status:data.gameStatus||b.game_status||'Scheduled',actual_pl:actualPL,updated_at:new Date().toISOString()}).eq('id',b.id);
    if(updateError)throw updateError;
    return data;
  }
  function renderCards(list){
    if((window.atdCurrentSport||'football')!=='hockey')return;
    for(const id of ['pendingBets','finishedBets']){
      const host=$(id);if(!host)continue;
      const rows=list.filter(b=>id==='pendingBets'?b.result==='Pending':b.result!=='Pending');
      if(!rows.length){host.innerHTML=`<div class="dashboard-empty">No ${id==='pendingBets'?'pending':'finished'} bets.</div>`;continue}
      host.innerHTML=rows.map(b=>`<div class="swipe-bet" data-id="${b.id}"><div class="swipe-delete" aria-hidden="true">Delete</div><div class="swipe-content"><details class="dash-bet"><summary><div class="dash-bet-main"><strong>${b.player_name}</strong><span>${prop(b)} · ${odds(b.american_odds)}</span><span>${b.team||'—'} vs ${b.opponent||'—'}</span><span class="dash-game-time">${dt(b.game_date)}</span></div><div class="dash-bet-right"><span class="badge ${b.result}">${b.result}</span><span class="dash-chevron">›</span></div></summary><div class="dash-bet-detail"><div><span>Prop</span><strong>${prop(b)}</strong></div><div><span>Current</span><strong>${Number(b.current_stat||0)} / ${Number(b.stat_target||1)}</strong></div><div><span>Stake</span><strong>${money(b.stake)}</strong></div><div><span>Potential Profit</span><strong>${money(profit(b.stake,b.american_odds))}</strong></div><div><span>P/L</span><strong>${money(b.actual_pl||0)}</strong></div><p>${dt(b.game_date)} · ${b.game_status||'Scheduled'}</p>${b.result==='Pending'?`<button type="button" class="text-btn hockey-refresh" data-hrefresh="${b.id}">Refresh Live Stats</button>`:''}${b.result!=='Pending'&&b.result!=='Void'?`<button type="button" class="text-btn refund-bet" data-id="${b.id}">Mark Refunded</button>`:''}</div></details></div></div>`).join('');
    }
    if($('pendingCount'))$('pendingCount').textContent=`(${list.filter(b=>b.result==='Pending').length})`;
    if($('finishedCount'))$('finishedCount').textContent=`(${list.filter(b=>b.result!=='Pending').length})`;
  }
  async function loadAndRender(){
    if((window.atdCurrentSport||'football')!=='hockey')return;
    const client=window.atdSupabase;if(!client)return;
    const {data,error}=await client.from('atd_bets').select('*').eq('sport','hockey').order('created_at',{ascending:false});
    if(error){console.warn('Hockey card load failed',error);return}
    renderCards(data||[]);
  }
  document.addEventListener('click',async e=>{
    const btn=e.target.closest('[data-hrefresh]');if(!btn)return;
    e.preventDefault();e.stopImmediatePropagation();
    const original=btn.textContent;btn.disabled=true;btn.textContent='Refreshing…';
    try{
      const client=window.atdSupabase;
      const {data,error}=await client.from('atd_bets').select('*').eq('id',btn.dataset.hrefresh).single();
      if(error)throw error;
      await refreshHockeyBet(data);
      await loadAndRender();
    }catch(err){alert(err.message||'Could not refresh NHL stats.');btn.disabled=false;btn.textContent=original}
  },true);
  document.addEventListener('click',e=>{if(e.target.closest('[data-sport="hockey"]'))setTimeout(loadAndRender,300)});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(loadAndRender,200)});
  window.atdRefreshHockeyBet=refreshHockeyBet;
  window.atdRenderHockeyCards=loadAndRender;
})();
