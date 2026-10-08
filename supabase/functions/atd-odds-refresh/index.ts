import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "jsr:@supabase/supabase-js@2.57.4";
import {NFL_OU_MARKETS,nflOUJoinQuotes_,nflOUTeam_,nflOUName_,nflOUATDQuotes_} from './matching.js';
const cors={'Access-Control-Allow-Origin':'https://scott12585.github.io','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'POST required'},405);
 if(req.headers.get('origin')&&req.headers.get('origin')!=='https://scott12585.github.io')return reply({error:'Origin not allowed'},403);
 const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 let runId=null,remaining=null;
 try {
  const token=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');
  const {data:user,error:authError}=await sb.auth.getUser(token);
  if(authError||!user.user)return reply({error:'Sign in to refresh odds.'},401);
  const body=await req.json(),season=body.season,week=body.week;
  if(!Number.isInteger(season)||season<2020||season>2100||!Number.isInteger(week)||week<1||week>18)return reply({error:'Invalid season/week.'},400);
  const {data:latest,error:latestError}=await sb.from('nfl_player_ou').select('week').eq('season',season).order('week',{ascending:false}).limit(1);
  if(latestError)throw new Error('Projection snapshot unavailable.');
  if(!latest?.length||latest[0].week!==week)return reply({error:'Refresh supports the current research week only. Rebuild that week in Apps Script first.'},409);
  const {data:reservation,error:reserveError}=await sb.rpc('reserve_nfl_odds_refresh',{p_user:user.user.id,p_season:season,p_week:week});
  if(reserveError)throw new Error('Could not reserve odds refresh.');
  if(reservation.error)return reply({error:reservation.error},reservation.code==='forbidden'?403:409);
  if(reservation.cached)return reply({ok:true,cached:true,message:'Recent DraftKings prices reused; no additional credits spent.'});
  if(reservation.busy)return reply({error:'An odds refresh is running or was just attempted. Try again in '+Math.ceil(reservation.retry_after/60)+' minute(s).'},429);
  runId=reservation.run_id;
  const {data:key,error:keyError}=await sb.rpc('get_nfl_odds_app_key');if(keyError||!key)throw new Error('Connect app odds refresh from Apps Script first.');
  const projections=[];
  for(let offset=0;offset<3000;offset+=1000){const {data,error}=await sb.from('nfl_player_ou').select('*').eq('season',season).eq('week',week).order('player').order('team').order('market_key').range(offset,offset+999);if(error)throw new Error('Projection snapshot unavailable.');projections.push(...(data||[]));if(!data||data.length<1000)break;}
  if(!projections.length||projections.some(p=>!p.detail?.game_date))throw new Error('Run connectDraftKingsAppRefresh in the updated odds module first.');
  const {data:details,error:detailsError}=await sb.from('nfl_player_research_details').select('player,team,opponent,position').eq('season',season).eq('week',week).limit(1000);
  if(detailsError)throw new Error('Player matching data unavailable.');
  const identities=new Map();[...projections,...(details||[])].forEach(p=>identities.set(p.player+'|'+p.team,p));
  const started=Date.now();
  async function provider(path:string){
   let response;
   try {response=await fetch('https://api.the-odds-api.com/v4/sports/americanfootball_nfl/'+path+(path.includes('?')?'&':'?')+'apiKey='+encodeURIComponent(key),{signal:AbortSignal.timeout(12000)});}catch{throw new Error('Odds provider could not be reached. Saved prices were preserved.');}
   const header=response.headers.get('x-requests-remaining');if(header!==null)remaining=Number(header);
   if(!response.ok)throw new Error('Odds provider HTTP '+response.status+'. Check subscription and remaining credits.');
   try{return await response.json();}catch{throw new Error('Odds provider returned invalid data.');}
  }
  const events=await provider('events');if(!Array.isArray(events))throw new Error('Odds provider returned invalid events.');
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
  const day=(date)=>{const parts=formatter.formatToParts(date),get=k=>parts.find(p=>p.type===k)?.value;return get('year')+'-'+get('month')+'-'+get('day');};
  const selected=events.filter(e=>Date.parse(e.commence_time)>Date.now()&&projections.some(p=>((p.team===nflOUTeam_(e.away_team)&&p.opponent===nflOUTeam_(e.home_team))||(p.team===nflOUTeam_(e.home_team)&&p.opponent===nflOUTeam_(e.away_team)))&&p.detail.game_date===day(new Date(e.commence_time))));
  if(!selected.length)throw new Error('No upcoming games match the selected research week. Saved prices were preserved.');
  const markets=[...Object.keys(NFL_OU_MARKETS),'player_anytime_td','player_tds_over'];
  if(remaining!==null&&remaining<selected.length*markets.length)throw new Error('Not enough credits for a complete seven-market refresh. Upgrade the plan or use the scheduled script.');
  const quotes=[];
  for(const event of selected){if(Date.now()-started>55000)throw new Error('Odds refresh timed out; saved prices were preserved.');const e=await provider('events/'+encodeURIComponent(event.id)+'/odds?bookmakers=draftkings&markets='+markets.join(',')+'&oddsFormat=american');e._fetched_at=new Date().toISOString();quotes.push(e);}
  const joined=nflOUJoinQuotes_(projections.map(p=>({...p,quote:null,detail:{...p.detail}})),quotes,Date.now());
  const ou=joined.rows.filter(p=>p.quote).map(p=>({player:p.player,team:p.team,market_key:p.market_key,quote:p.quote}));
  const atd=nflOUATDQuotes_([...identities.values()],quotes,season,week,Date.now()),pairedATD=atd.rows,unmatched=joined.unmatched+atd.unmatched;
  const {data:saved,error:saveError}=await sb.rpc('refresh_nfl_ou_quotes',{p_season:season,p_week:week,p_quotes:ou,p_atd:pairedATD});if(saveError)throw new Error('Could not save refreshed odds.');
  await sb.rpc('finish_nfl_odds_refresh',{p_id:runId,p_status:'success',p_message:'DraftKings refreshed',p_remaining:remaining});
  return reply({ok:true,...saved,remaining,unmatched,two_td_prices:pairedATD.filter(r=>r.quote.two_td).length,message:'DraftKings odds refreshed.'});
 }catch(error){
  const message=error instanceof Error?error.message:'Odds refresh failed.';
  if(runId)await sb.rpc('finish_nfl_odds_refresh',{p_id:runId,p_status:'error',p_message:message,p_remaining:remaining});
  return reply({error:message},502);
 }
});
