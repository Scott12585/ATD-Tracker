create table public.nfl_defense_weekly_tds (
 season integer not null, target_week integer not null check(target_week between 1 and 18),
 game_week integer not null check(game_week>0 and game_week<target_week),
 defense text not null, opponent text not null,
 tds jsonb not null check(jsonb_typeof(tds)='object'),
 updated_at timestamptz not null default now(),
 primary key(season,target_week,defense,game_week)
);
alter table public.nfl_defense_weekly_tds enable row level security;
revoke all on public.nfl_defense_weekly_tds from anon,authenticated;
grant select on public.nfl_defense_weekly_tds to authenticated;
grant all on public.nfl_defense_weekly_tds to service_role;
create policy authenticated_read_defense_weekly_tds on public.nfl_defense_weekly_tds for select to authenticated using(true);
create function public.replace_nfl_expanded_research_full(p_season integer,p_week integer,p_best jsonb,p_games jsonb,p_props jsonb,p_details jsonb,p_defense_weeks jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if jsonb_typeof(p_defense_weeks) is distinct from 'array' or jsonb_array_length(p_defense_weeks)>2000 then raise exception 'Invalid defense week array'; end if;
 if exists(select 1 from jsonb_array_elements(p_defense_weeks) r where (r->>'season')::integer is distinct from p_season or (r->>'target_week')::integer is distinct from p_week or jsonb_typeof(r->'tds') is distinct from 'object') then raise exception 'Invalid defense week scope'; end if;
 perform pg_advisory_xact_lock(p_season,p_week);
 result:=public.replace_nfl_expanded_research_with_details(p_season,p_week,p_best,p_games,p_props,p_details);
 delete from public.nfl_defense_weekly_tds where season=p_season and target_week=p_week;
 insert into public.nfl_defense_weekly_tds(season,target_week,game_week,defense,opponent,tds,updated_at)
 select season,target_week,game_week,defense,opponent,tds,coalesce(updated_at,now()) from jsonb_populate_recordset(null::public.nfl_defense_weekly_tds,p_defense_weeks);
 return result||jsonb_build_object('defense_weeks',jsonb_array_length(p_defense_weeks));
end; $$;
revoke all on function public.replace_nfl_expanded_research_full(integer,integer,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.replace_nfl_expanded_research_full(integer,integer,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
