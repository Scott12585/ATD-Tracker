-- Immutable pregame observations; authenticated users may read shared research.
create table public.nfl_ou_observations (
 snapshot_id bigint generated always as identity primary key,
 season integer not null, week integer not null check(week between 1 and 18),
 player text not null, team text not null, opponent text not null,
 position text not null check(position in ('QB','RB','WR','TE')),
 market text not null, market_key text not null, model text not null,
 projection numeric not null check(projection>=0),
 quote jsonb not null, detail jsonb not null, availability text not null, role text not null,
 event_id text not null, snapshot_at timestamptz not null, kickoff timestamptz not null,
 promoted boolean not null, received_at timestamptz not null default now(),
 unique(season,week,event_id,player,team,market_key,snapshot_at),
 check(snapshot_at<kickoff)
);
create index nfl_ou_observations_scope on public.nfl_ou_observations(season,week,event_id,player,team,market_key,snapshot_at desc);
create table public.nfl_ou_results (
 season integer not null, week integer not null check(week between 1 and 18),
 event_id text not null, player text not null, team text not null, market_key text not null,
 actual numeric not null, source text not null, graded_at timestamptz not null default now(),
 primary key(season,week,event_id,player,team,market_key)
);
create table public.nfl_ou_backtests (
 season integer not null, market text not null, model text not null,
 samples integer not null check(samples>0), mae numeric not null, bias numeric not null,
 recent_baseline_mae numeric not null, evaluated_through_week integer not null,
 source text not null, updated_at timestamptz not null default now(),
 primary key(season,market,model)
);
alter table public.nfl_ou_observations enable row level security;
alter table public.nfl_ou_results enable row level security;
alter table public.nfl_ou_backtests enable row level security;
revoke all on public.nfl_ou_observations,public.nfl_ou_results,public.nfl_ou_backtests from anon,authenticated;
grant select on public.nfl_ou_observations,public.nfl_ou_results,public.nfl_ou_backtests to authenticated;
grant all on public.nfl_ou_observations,public.nfl_ou_results,public.nfl_ou_backtests to service_role;
grant usage,select on sequence public.nfl_ou_observations_snapshot_id_seq to service_role;
create policy authenticated_read_ou_observations on public.nfl_ou_observations for select to authenticated using(true);
create policy authenticated_read_ou_results on public.nfl_ou_results for select to authenticated using(true);
create policy authenticated_read_ou_backtests on public.nfl_ou_backtests for select to authenticated using(true);
create function public.capture_nfl_ou_observation() returns trigger language plpgsql security invoker set search_path='' as $$
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
   and gap>=minimum_gap and relative_gap>=0.10;
 insert into public.nfl_ou_observations(season,week,player,team,opponent,position,market,market_key,model,projection,quote,detail,availability,role,event_id,snapshot_at,kickoff,promoted)
 values(new.season,new.week,new.player,new.team,new.opponent,new.position,new.market,new.market_key,new.model,new.projection,q,new.detail,new.availability,new.role,q->>'event_id',ts,start_at,coalesce(eligible,false)) on conflict do nothing;
 return new;
end; $$;
revoke all on function public.capture_nfl_ou_observation() from public,anon,authenticated;
create trigger capture_nfl_ou_observation after insert on public.nfl_player_ou for each row execute function public.capture_nfl_ou_observation();

-- Latest observation first, THEN candidate filter: no cherry-picking earlier gaps.
create view public.nfl_ou_latest_observations with(security_invoker=true) as
 select distinct on(season,week,event_id,player,team,market_key) * from public.nfl_ou_observations
 order by season,week,event_id,player,team,market_key,snapshot_at desc,snapshot_id desc;
revoke all on public.nfl_ou_latest_observations from anon,authenticated;
grant select on public.nfl_ou_latest_observations to authenticated,service_role;
create function public.nfl_ou_pending(p_season integer) returns jsonb language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from public.nfl_ou_latest_observations s
 where s.season=p_season and s.kickoff<now();
$$;
revoke all on function public.nfl_ou_pending(integer) from public,anon,authenticated;
grant execute on function public.nfl_ou_pending(integer) to service_role;
create function public.save_nfl_ou_results(p_rows jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>2500 then raise exception 'Invalid results array'; end if;
 if exists(select 1 from jsonb_array_elements(p_rows) r where not exists(select 1 from public.nfl_ou_observations s where s.season=(r->>'season')::integer and s.week=(r->>'week')::integer and s.event_id=r->>'event_id' and s.player=r->>'player' and s.team=r->>'team' and s.market_key=r->>'market_key' and s.kickoff<now())) then raise exception 'Result without completed-time observation'; end if;
 insert into public.nfl_ou_results select * from jsonb_populate_recordset(null::public.nfl_ou_results,p_rows)
 on conflict(season,week,event_id,player,team,market_key) do update set actual=excluded.actual,source=excluded.source,graded_at=excluded.graded_at;
 return jsonb_build_object('results',jsonb_array_length(p_rows));
end; $$;
revoke all on function public.save_nfl_ou_results(jsonb) from public,anon,authenticated;
grant execute on function public.save_nfl_ou_results(jsonb) to service_role;
create function public.save_nfl_ou_backtests(p_rows jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>100 then raise exception 'Invalid backtest array'; end if;
 insert into public.nfl_ou_backtests select * from jsonb_populate_recordset(null::public.nfl_ou_backtests,p_rows)
 on conflict(season,market,model) do update set samples=excluded.samples,mae=excluded.mae,bias=excluded.bias,recent_baseline_mae=excluded.recent_baseline_mae,evaluated_through_week=excluded.evaluated_through_week,source=excluded.source,updated_at=excluded.updated_at;
 return jsonb_build_object('backtests',jsonb_array_length(p_rows));
end; $$;
revoke all on function public.save_nfl_ou_backtests(jsonb) from public,anon,authenticated;
grant execute on function public.save_nfl_ou_backtests(jsonb) to service_role;
-- Preserve existing observations using the same insert trigger and promotion rules.
do $$ declare scoped record; begin
 for scoped in select season,week,jsonb_agg(to_jsonb(p)) as rows from public.nfl_player_ou p group by season,week loop
  perform public.replace_nfl_player_ou(scoped.season,scoped.week,scoped.rows);
 end loop;
end; $$;
