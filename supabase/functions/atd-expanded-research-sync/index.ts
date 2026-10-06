import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.57.4";
const reply = (body: unknown,status=200) => new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
Deno.serve(async (req: Request) => {
  if(req.method!=="POST") return reply({error:"POST required"},405);
  try {
    const token=req.headers.get("x-research-sync-token")||"";
    if(token.length<32||token.length>256) return reply({error:"Invalid sync token"},401);
    const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
    const {data:config,error:configError}=await supabase.from("nfl_research_sync_config").select("token_hash").eq("name","expanded_research").single();
    if(configError||!config) throw new Error("Sync authentication configuration unavailable");
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token)))).map(b=>b.toString(16).padStart(2,"0")).join("");
    let difference=hash.length^config.token_hash.length;
    for(let i=0;i<hash.length;i++) difference |= hash.charCodeAt(i)^(config.token_hash.charCodeAt(i)||0);
    if(difference!==0) return reply({error:"Invalid sync token"},401);
    const body=await req.json();
    if(body.ou_projections!==undefined) {
      const {season,week,ou_projections}=body;
      if(!Number.isInteger(season)||season<2020||season>2100||!Number.isInteger(week)||week<1||week>18) return reply({error:"Invalid O/U season/week"},400);
      const allowed=['player_pass_yds','player_pass_tds','player_rush_yds','player_reception_yds','player_receptions'];
      if(!Array.isArray(ou_projections)||!ou_projections.length||ou_projections.length>2500) return reply({error:"Invalid O/U snapshot"},400);
      const seen=new Set();
      for(const r of ou_projections) {
        if(!r||r.season!==season||r.week!==week||!['QB','RB','WR','TE'].includes(r.position)||!allowed.includes(r.market_key)||!r.player||!r.team||!r.opponent||typeof r.projection!=='number'||!Number.isFinite(r.projection)||r.projection<0||r.projection>=10000||!r.availability||!r.role||!r.model||!r.detail||typeof r.detail!=='object'||Array.isArray(r.detail)||JSON.stringify(r).length>12000) return reply({error:"Invalid O/U projection"},400);
        const identity=r.player+'|'+r.team+'|'+r.market_key;
        if(seen.has(identity)) return reply({error:"Duplicate O/U projection"},400);seen.add(identity);
        if(r.quote!==null) {
          const q=r.quote;
          if(!q||q.bookmaker!=='draftkings'||!q.event_id||!Number.isFinite(Date.parse(q.commence_time))||typeof q.line!=='number'||!Number.isFinite(q.line)||q.line<0||q.line>=10000||[q.over_odds,q.under_odds].some(v=>typeof v!=='number'||!Number.isInteger(v)||Math.abs(v)<100)||!Number.isFinite(Date.parse(q.fetched_at))||q.last_update!==null&&!Number.isFinite(Date.parse(q.last_update))) return reply({error:"Invalid DraftKings quote"},400);
        }
      }
      const stamped=ou_projections.map(r=>({...r,updated_at:new Date().toISOString()}));
      const {data,error}=await supabase.rpc('replace_nfl_player_ou',{p_season:season,p_week:week,p_rows:stamped});
      if(error)throw error;
      return reply({ok:true,season,week,...data});
    }
    const {season,week,best_plays,game_best_plays,player_props,player_details,defense_weeks}=body;
    if(!Number.isInteger(season)||season<2020||season>2100||!Number.isInteger(week)||week<1||week>18) return reply({error:"Invalid season/week"},400);
    for(const rows of [best_plays,game_best_plays,player_props]) {
      if(!Array.isArray(rows)||rows.length>2000) return reply({error:"Invalid dataset array"},400);
      if(rows.some(r=>!r||r.season!==season||r.week!==week)) return reply({error:"Mixed season/week snapshot"},400);
    }
    if(!best_plays.length) return reply({error:"Refusing an empty Best Plays snapshot"},400);
    if(best_plays.some(r=>!['QB','RB','WR','TE'].includes(r.position)||!r.availability||r.confidence==null||!Number.isFinite(Number(r.confidence))||Number(r.confidence)<0||Number(r.confidence)>100)) return reply({error:"Invalid Best Plays metadata or score"},400);
    if(best_plays.some(r=>r.position!=='WR'&&r.play_type!==r.position+' Anytime TD')) return reply({error:"Best Plays must contain ATD markets only"},400);
    if(player_details!==undefined) {
      if(!Array.isArray(player_details)||player_details.length>2000||player_details.some(r=>!r||r.season!==season||r.week!==week||!['QB','RB','WR','TE'].includes(r.position)||typeof r.player!=='string'||!r.player||typeof r.team!=='string'||!r.team||typeof r.opponent!=='string'||!r.opponent||!r.detail||typeof r.detail!=='object'||Array.isArray(r.detail)||JSON.stringify(r.detail).length>32768)) return reply({error:"Invalid production details"},400);
    }
    if(defense_weeks!==undefined) {
      if(player_details===undefined||!Array.isArray(defense_weeks)||defense_weeks.length>2000||defense_weeks.some(r=>!r||r.season!==season||r.target_week!==week||!Number.isInteger(r.game_week)||r.game_week<1||r.game_week>=week||!r.defense||!r.opponent||!r.tds||typeof r.tds!=='object'||Array.isArray(r.tds)||Object.values(r.tds).some(v=>v!==null&&(!Number.isInteger(v)||Number(v)<0)))) return reply({error:"Invalid weekly defense touchdowns"},400);
    }
    const now=new Date().toISOString();
    const stamp=(rows:Record<string,unknown>[])=>rows.map(r=>({...r,updated_at:now}));
    const args:Record<string,unknown>={p_season:season,p_week:week,p_best:stamp(best_plays),p_games:stamp(game_best_plays),p_props:stamp(player_props)};
    if(player_details!==undefined)args.p_details=stamp(player_details);
    if(defense_weeks!==undefined)args.p_defense_weeks=stamp(defense_weeks);
    const {data,error}=await supabase.rpc(defense_weeks!==undefined?"replace_nfl_expanded_research_full":player_details===undefined?"replace_nfl_expanded_research":"replace_nfl_expanded_research_with_details",args);
    if(error) throw error;
    return reply({ok:true,season,week,...data});
  } catch(error) {
    console.error(error);
    return reply({error:error instanceof Error?error.message:String(error)},500);
  }
});
