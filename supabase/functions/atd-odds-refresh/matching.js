function numExpansion_(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function expansionNameKey_(name,team){return String(name||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g,'').replace(/\s+/g,' ').trim()+'|'+team;}
const NFL_OU_MARKETS = {
  player_pass_yds:{label:'Passing Yards',stat:'passing_yards',volume:'attempts',positions:['QB'],minimum:10,floor:2},
  player_pass_tds:{label:'Passing TD',stat:'passing_tds',volume:'attempts',positions:['QB'],minimum:10,floor:0.25},
  player_rush_yds:{label:'Rushing Yards',stat:'rushing_yards',volume:'carries',positions:['QB','RB'],minimum:5,floor:2},
  player_reception_yds:{label:'Receiving Yards',stat:'receiving_yards',volume:'targets',positions:['RB','WR','TE'],minimum:2,floor:2},
  player_receptions:{label:'Receptions',stat:'receptions',volume:'targets',positions:['RB','WR','TE'],minimum:2,floor:0.5}
};
function nflOUName_(name){return expansionNameKey_(name,'').split('|')[0];}
function nflOUTeam_(name){
  const names={'Arizona Cardinals':'ARI','Atlanta Falcons':'ATL','Baltimore Ravens':'BAL','Buffalo Bills':'BUF','Carolina Panthers':'CAR','Chicago Bears':'CHI','Cincinnati Bengals':'CIN','Cleveland Browns':'CLE','Dallas Cowboys':'DAL','Denver Broncos':'DEN','Detroit Lions':'DET','Green Bay Packers':'GB','Houston Texans':'HOU','Indianapolis Colts':'IND','Jacksonville Jaguars':'JAX','Kansas City Chiefs':'KC','Las Vegas Raiders':'LV','Los Angeles Chargers':'LAC','Los Angeles Rams':'LAR','Miami Dolphins':'MIA','Minnesota Vikings':'MIN','New England Patriots':'NE','New Orleans Saints':'NO','New York Giants':'NYG','New York Jets':'NYJ','Philadelphia Eagles':'PHI','Pittsburgh Steelers':'PIT','San Francisco 49ers':'SF','Seattle Seahawks':'SEA','Tampa Bay Buccaneers':'TB','Tennessee Titans':'TEN','Washington Commanders':'WAS'};
  return names[name]||null;
}
function nflOUJoinQuotes_(projections,events,now) {
  let unmatched=0;const matched=new Set();
  events.forEach(event=>{
    const fetchedAt=Number.isFinite(Date.parse(event._fetched_at))?Date.parse(event._fetched_at):now;
    if(Date.parse(event.commence_time)<=fetchedAt)return;
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
        p.quote={bookmaker:'draftkings',event_id:event.id,commence_time:event.commence_time,line:pair.line,over_odds:pair.Over,under_odds:pair.Under,last_update:m.last_update||book.last_update||null,fetched_at:new Date(fetchedAt).toISOString()};
      });
    });
  });
  return {rows:projections,unmatched:unmatched};
}
function nflOUATDQuotes_(players,events,season,week,now){
 const identities=new Map();players.forEach(p=>identities.set(p.player+'|'+p.team,p));
 const rows=[],seen=new Set(),ambiguous=new Set();let unmatched=0;
 for(const e of events){const fetched=Date.parse(e._fetched_at)||now;if(Date.parse(e.commence_time)<=fetched)continue;
  const home=nflOUTeam_(e.home_team),away=nflOUTeam_(e.away_team),book=(e.bookmakers||[]).find(b=>b.key==='draftkings');if(!book)continue;
  for(const m of book.markets||[]){if(m.key!=='player_anytime_td')continue;
   for(const o of m.outcomes||[]){if(o.name!=='Yes'||!o.description||!Number.isInteger(o.price)||Math.abs(o.price)<100)continue;
    const candidates=[...identities.values()].filter(p=>nflOUName_(p.player)===nflOUName_(o.description)&&[home,away].includes(p.team)&&p.opponent===(p.team===home?away:home));
    if(candidates.length!==1){unmatched++;continue;}const p=candidates[0],id=p.player+'|'+p.team;if(seen.has(id)){ambiguous.add(id);continue;}seen.add(id);
    rows.push({season:season,week:week,player:p.player,team:p.team,opponent:p.opponent,position:p.position,quote:{bookmaker:'draftkings',price:o.price,event_id:e.id,commence_time:e.commence_time,last_update:m.last_update||book.last_update||null,fetched_at:new Date(fetched).toISOString()},updated_at:new Date(now).toISOString()});
   }
  }
 }
 return {rows:rows.filter(p=>!ambiguous.has(p.player+'|'+p.team)),unmatched:unmatched};
}

export {NFL_OU_MARKETS,nflOUJoinQuotes_,nflOUTeam_,nflOUName_,nflOUATDQuotes_};
