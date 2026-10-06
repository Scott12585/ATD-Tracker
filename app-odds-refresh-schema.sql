create schema nfl_odds_private;
revoke all on schema nfl_odds_private from public,anon,authenticated;
grant usage on schema nfl_odds_private to service_role;
create table nfl_odds_private.config (
 id boolean primary key default true check(id), api_key text not null,
 owner_id uuid not null, remaining integer, connected_at timestamptz not null default now()
);
create table nfl_odds_private.refresh_runs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null,
 season integer not null, week integer not null,
 started_at timestamptz not null default now(), finished_at timestamptz,
 status text not null default 'running', message text, remaining integer
);
alter table nfl_odds_private.config enable row level security;
alter table nfl_odds_private.refresh_runs enable row level security;
revoke all on nfl_odds_private.config,nfl_odds_private.refresh_runs from public,anon,authenticated;
grant all on nfl_odds_private.config,nfl_odds_private.refresh_runs to service_role;
create table public.nfl_atd_odds (
 season integer not null,week integer not null check(week between 1 and 18),
 player text not null,team text not null,opponent text not null,position text not null,
 quote jsonb not null,updated_at timestamptz not null default now(),
 primary key(season,week,player,team)
);
alter table public.nfl_atd_odds enable row level security;
revoke all on public.nfl_atd_odds from anon,authenticated;
grant select on public.nfl_atd_odds to authenticated;
grant all on public.nfl_atd_odds to service_role;
create policy authenticated_read_atd_odds on public.nfl_atd_odds for select to authenticated using(true);
create function public.connect_nfl_odds_app(p_key text,p_season integer,p_week integer,p_games jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare owner uuid;
begin
 if length(p_key)<16 or length(p_key)>256 or p_key!~'^[A-Za-z0-9_-]+$' then raise exception 'Invalid provider key format'; end if;
 select owner_id into owner from nfl_odds_private.config where id;
 if owner is null then
  if (select count(*) from public.atd_settings)<>1 then raise exception 'Owner configuration required'; end if;
  select user_id into owner from public.atd_settings;
 end if;
 insert into nfl_odds_private.config(id,api_key,owner_id) values(true,p_key,owner)
 on conflict(id) do update set api_key=excluded.api_key,connected_at=now();
 update public.nfl_player_ou p set detail=p.detail||jsonb_build_object('game_date',g->>'date','projection_built_at',coalesce(p.detail->>'projection_built_at',p.updated_at::text))
 from jsonb_array_elements(p_games) g
 where p.season=p_season and p.week=p_week and ((p.team=g->>'away' and p.opponent=g->>'home') or (p.team=g->>'home' and p.opponent=g->>'away'));
 return jsonb_build_object('ok',true,'connected',true);
end; $$;
create function public.reserve_nfl_odds_refresh(p_user uuid,p_season integer,p_week integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare last_run nfl_odds_private.refresh_runs; run_id uuid; owner uuid;
begin
 perform pg_advisory_xact_lock(684235,1);
 select owner_id into owner from nfl_odds_private.config where id;
 if owner is null then return jsonb_build_object('error','Connect app odds refresh from Apps Script first.','code','not_connected'); end if;
 if owner<>p_user then return jsonb_build_object('error','Only the account owner can refresh the shared odds.','code','forbidden'); end if;
 select * into last_run from nfl_odds_private.refresh_runs where season=p_season and week=p_week order by started_at desc limit 1;
 if last_run.started_at>now()-interval '5 minutes' then
  return jsonb_build_object('cached',last_run.status='success','busy',last_run.status<>'success','retry_after',greatest(1,ceil(extract(epoch from last_run.started_at+interval '5 minutes'-now()))::integer));
 end if;
 if (select count(*) from nfl_odds_private.refresh_runs where (started_at at time zone 'America/New_York')::date=(now() at time zone 'America/New_York')::date)>=12 then return jsonb_build_object('error','App refresh daily limit reached. Scheduled refreshes still work.','code','daily_limit'); end if;
 insert into nfl_odds_private.refresh_runs(user_id,season,week) values(p_user,p_season,p_week) returning id into run_id;
 return jsonb_build_object('run_id',run_id);
end; $$;
create function public.get_nfl_odds_app_key() returns text language sql security invoker set search_path='' as $$ select api_key from nfl_odds_private.config where id; $$;
create function public.finish_nfl_odds_refresh(p_id uuid,p_status text,p_message text,p_remaining integer)
returns void language plpgsql security invoker set search_path='' as $$
begin
 update nfl_odds_private.refresh_runs set status=p_status,message=p_message,remaining=p_remaining,finished_at=now() where id=p_id;
 update nfl_odds_private.config set remaining=p_remaining where id;
end; $$;
create function public.refresh_nfl_ou_quotes(p_season integer,p_week integer,p_quotes jsonb,p_atd jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(p_season,p_week);
 if exists(select 1 from jsonb_array_elements(p_atd) r where (r->>'season')::integer<>p_season or (r->>'week')::integer<>p_week) then raise exception 'Invalid ATD scope'; end if;
 update public.nfl_player_ou p set detail=p.detail||jsonb_build_object('projection_built_at',coalesce(p.detail->>'projection_built_at',p.updated_at::text)),quote=null,updated_at=now() where season=p_season and week=p_week;
 update public.nfl_player_ou p set quote=case when q->'quote'='null'::jsonb then null else q->'quote' end,updated_at=now()
 from jsonb_array_elements(p_quotes) q where p.season=p_season and p.week=p_week and p.player=q->>'player' and p.team=q->>'team' and p.market_key=q->>'market_key';
 delete from public.nfl_atd_odds where season=p_season and week=p_week;
 insert into public.nfl_atd_odds select * from jsonb_populate_recordset(null::public.nfl_atd_odds,p_atd);
 return jsonb_build_object('paired_ou_lines',jsonb_array_length(p_quotes),'atd_prices',jsonb_array_length(p_atd));
end; $$;
drop trigger capture_nfl_ou_observation on public.nfl_player_ou;
create trigger capture_nfl_ou_observation after insert or update on public.nfl_player_ou for each row execute function public.capture_nfl_ou_observation();
revoke all on function public.connect_nfl_odds_app(text,integer,integer,jsonb),public.reserve_nfl_odds_refresh(uuid,integer,integer),public.get_nfl_odds_app_key(),public.finish_nfl_odds_refresh(uuid,text,text,integer),public.refresh_nfl_ou_quotes(integer,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.connect_nfl_odds_app(text,integer,integer,jsonb),public.reserve_nfl_odds_refresh(uuid,integer,integer),public.get_nfl_odds_app_key(),public.finish_nfl_odds_refresh(uuid,text,text,integer),public.refresh_nfl_ou_quotes(integer,integer,jsonb,jsonb) to service_role;
create function public.replace_nfl_ou_with_atd(p_season integer,p_week integer,p_rows jsonb,p_atd jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if exists(select 1 from jsonb_array_elements(p_atd) r where (r->>'season')::integer<>p_season or (r->>'week')::integer<>p_week) then raise exception 'Invalid ATD scope'; end if;
 result:=public.replace_nfl_player_ou(p_season,p_week,p_rows);
 delete from public.nfl_atd_odds where season=p_season and week=p_week;
 insert into public.nfl_atd_odds select * from jsonb_populate_recordset(null::public.nfl_atd_odds,p_atd);
 return result||jsonb_build_object('atd_prices',jsonb_array_length(p_atd));
end; $$;
revoke all on function public.replace_nfl_ou_with_atd(integer,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.replace_nfl_ou_with_atd(integer,integer,jsonb,jsonb) to service_role;

create or replace function public.capture_nfl_ou_observation() returns trigger language plpgsql security invoker set search_path='' as $$
declare q jsonb; ts timestamptz; start_at timestamptz; age interval; gap numeric; relative_gap numeric; minimum_gap numeric; eligible boolean;
begin
 q:=new.quote;
 if q is null or q='null'::jsonb then return new; end if;
 ts:=(q->>'fetched_at')::timestamptz; start_at:=(q->>'commence_time')::timestamptz;
 if ts>=start_at or ts>now()+interval '5 minutes' or q->>'bookmaker'<>'draftkings' then return new; end if;
 gap:=new.projection-(q->>'line')::numeric;
 relative_gap:=gap/greatest((q->>'line')::numeric,case when new.market_key in ('player_pass_tds','player_receptions') then 1 else 10 end);
 minimum_gap:=case when new.market_key='player_pass_tds' then 0.25 when new.market_key='player_receptions' then 0.5 else 2 end;
 age:=ts-(q->>'last_update')::timestamptz;
 eligible:=coalesce((new.detail->>'eligible')::boolean,false)
   and age between interval '-5 minutes' and interval '6 hours'
   and ts-(new.detail->>'context_checked_at')::timestamptz between interval '-5 minutes' and interval '24 hours'
   and ts-coalesce((new.detail->>'projection_built_at')::timestamptz,new.updated_at) between interval '-5 minutes' and interval '24 hours'
   and gap>=minimum_gap and relative_gap>=0.10;
 insert into public.nfl_ou_observations(season,week,player,team,opponent,position,market,market_key,model,projection,quote,detail,availability,role,event_id,snapshot_at,kickoff,promoted)
 values(new.season,new.week,new.player,new.team,new.opponent,new.position,new.market,new.market_key,new.model,new.projection,q,new.detail,new.availability,new.role,q->>'event_id',ts,start_at,coalesce(eligible,false)) on conflict do nothing;
 return new;
end; $$;
