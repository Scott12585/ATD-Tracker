create table if not exists public.nfl_player_research_details (
 id bigint generated always as identity primary key,
 season integer not null check(season between 2020 and 2100),
 week integer not null check(week between 1 and 18),
 player text not null, team text not null, opponent text not null,
 position text not null check(position in ('QB','RB','WR','TE')),
 detail jsonb not null check(jsonb_typeof(detail)='object'),
 updated_at timestamptz not null default now(),
 unique(season,week,player,team)
);
alter table public.nfl_player_research_details enable row level security;
revoke all on public.nfl_player_research_details from anon,authenticated;
grant select on public.nfl_player_research_details to authenticated;
grant all on public.nfl_player_research_details to service_role;
grant usage,select on sequence public.nfl_player_research_details_id_seq to service_role;
create policy authenticated_read_player_research_details on public.nfl_player_research_details for select to authenticated using(true);
create or replace function public.replace_nfl_expanded_research_with_details(p_season integer,p_week integer,p_best jsonb,p_games jsonb,p_props jsonb,p_details jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
 if jsonb_typeof(p_details) is distinct from 'array' or jsonb_array_length(p_details)>2000 then raise exception 'Invalid player detail array'; end if;
 if exists(select 1 from jsonb_array_elements(p_details) r where (r->>'season')::integer is distinct from p_season or (r->>'week')::integer is distinct from p_week or jsonb_typeof(r->'detail') is distinct from 'object') then raise exception 'Invalid detail scope'; end if;
 perform pg_advisory_xact_lock(p_season,p_week);
 result := public.replace_nfl_expanded_research(p_season,p_week,p_best,p_games,p_props);
 delete from public.nfl_player_research_details where season=p_season and week=p_week;
 insert into public.nfl_player_research_details(season,week,player,team,opponent,position,detail,updated_at)
 select season,week,player,team,opponent,position,detail,coalesce(updated_at,now()) from jsonb_populate_recordset(null::public.nfl_player_research_details,p_details);
 return result || jsonb_build_object('player_details',jsonb_array_length(p_details));
end; $$;
revoke all on function public.replace_nfl_expanded_research_with_details(integer,integer,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.replace_nfl_expanded_research_with_details(integer,integer,jsonb,jsonb,jsonb,jsonb) to service_role;
