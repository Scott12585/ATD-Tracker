(function(){
  const $=id=>document.getElementById(id);
  const profit=(stake,odds)=>Number(odds)>0?Number(stake||0)*Number(odds)/100:Number(stake||0)*100/Math.abs(Number(odds)||1);
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
  window.atdRefreshHockeyBet=refreshHockeyBet;
})();
