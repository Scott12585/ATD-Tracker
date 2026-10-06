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
    const {season,week,best_plays,game_best_plays,player_props}=body;
    if(!Number.isInteger(season)||season<2020||season>2100||!Number.isInteger(week)||week<1||week>18) return reply({error:"Invalid season/week"},400);
    for(const rows of [best_plays,game_best_plays,player_props]) {
      if(!Array.isArray(rows)||rows.length>2000) return reply({error:"Invalid dataset array"},400);
      if(rows.some(r=>!r||r.season!==season||r.week!==week)) return reply({error:"Mixed season/week snapshot"},400);
    }
    if(!best_plays.length) return reply({error:"Refusing an empty Best Plays snapshot"},400);
    if(best_plays.some(r=>!['QB','RB','WR','TE'].includes(r.position)||!r.availability||r.confidence==null||!Number.isFinite(Number(r.confidence))||Number(r.confidence)<0||Number(r.confidence)>100)) return reply({error:"Invalid Best Plays metadata or score"},400);
    if(best_plays.some(r=>r.position!=='WR'&&r.play_type!==r.position+' Anytime TD')) return reply({error:"Best Plays must contain ATD markets only"},400);
    const now=new Date().toISOString();
    const stamp=(rows:Record<string,unknown>[])=>rows.map(r=>({...r,updated_at:now}));
    const {data,error}=await supabase.rpc("replace_nfl_expanded_research",{p_season:season,p_week:week,p_best:stamp(best_plays),p_games:stamp(game_best_plays),p_props:stamp(player_props)});
    if(error) throw error;
    return reply({ok:true,season,week,...data});
  } catch(error) {
    console.error(error);
    return reply({error:error instanceof Error?error.message:String(error)},500);
  }
});
