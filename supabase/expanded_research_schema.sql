alter table public.nfl_best_plays add column if not exists position text,
  add column if not exists availability text,
  add column if not exists research_model text,
  add column if not exists score_basis text;
alter table public.nfl_game_best_plays add column if not exists position text,
  add column if not exists availability text,
  add column if not exists research_model text,
  add column if not exists score_basis text;
create table public.nfl_player_props (
 id bigint generated always as identity primary key,
 season integer not null, week integer not null check (week between 1 and 18),
 position text not null check(position in ('QB','RB','TE')),
 player text not null, team text not null, opponent text not null, game_id text,
 market text not null check(market in ('Passing TD','Passing Yards','Rushing TD','Rushing Yards','Receiving TD','Receiving Yards')),
 research_score numeric not null check(research_score between 0 and 100),
 availability text not null default 'Unverified', score_basis text, notes text,
 updated_at timestamptz not null default now(),
 unique(season,week,player,team,market)
);
alter table public.nfl_player_props enable row level security;
revoke all on public.nfl_player_props from anon,authenticated;
grant select on public.nfl_player_props to authenticated;
grant all on public.nfl_player_props to service_role;
grant usage,select on sequence public.nfl_player_props_id_seq to service_role;
create policy authenticated_read_nfl_player_props on public.nfl_player_props for select to authenticated using(true);
-- Dedicated route authenticates its writer token against this hash.
-- Clients have no grants; the stored value is a hash, never the token.
create table public.nfl_research_sync_config (
 name text primary key, token_hash text not null
);
alter table public.nfl_research_sync_config enable row level security;
revoke all on public.nfl_research_sync_config from public,anon,authenticated;
grant select,insert,update on public.nfl_research_sync_config to service_role;

create or replace function public.replace_nfl_expanded_research(p_season integer,p_week integer,p_best jsonb,p_games jsonb,p_props jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
 if p_season < 2020 or p_season > 2100 or p_week < 1 or p_week > 18 then raise exception 'Invalid season/week'; end if;
 if jsonb_typeof(p_best) is distinct from 'array' or jsonb_typeof(p_games) is distinct from 'array' or jsonb_typeof(p_props) is distinct from 'array' then raise exception 'All datasets must be arrays'; end if;
 if jsonb_array_length(p_best)>2000 or jsonb_array_length(p_games)>2000 or jsonb_array_length(p_props)>2000 then raise exception 'Too many rows'; end if;
 if exists(select 1 from jsonb_array_elements(p_best||p_games||p_props) r where (r->>'season')::integer is distinct from p_season or (r->>'week')::integer is distinct from p_week) then raise exception 'Mixed season/week snapshot'; end if;
 perform pg_advisory_xact_lock(p_season,p_week);
 delete from public.nfl_best_plays where season=p_season and week=p_week;
 delete from public.nfl_game_best_plays where season=p_season and week=p_week;
 delete from public.nfl_player_props where season=p_season and week=p_week;
 insert into public.nfl_best_plays (season,week,rank,player,team,opponent,home_away,play_type,confidence,matchup_score,usage_score,td_rz_score,defense_score,coverage_score,season_td,last3_td,targets_per_game,target_share,inside10_targets,weakest_cb,cb_weakness,key_reason,position,availability,research_model,score_basis,updated_at) select season,week,rank,player,team,opponent,home_away,play_type,confidence,matchup_score,usage_score,td_rz_score,defense_score,coverage_score,season_td,last3_td,targets_per_game,target_share,inside10_targets,weakest_cb,cb_weakness,key_reason,position,availability,research_model,score_basis,coalesce(updated_at,now()) from jsonb_populate_recordset(null::public.nfl_best_plays,p_best);
 insert into public.nfl_game_best_plays (season,week,game_id,game_date,game_time,away_team,home_team,game_label,play_rank,player,player_team,opponent,home_away,play_type,confidence,matchup_score,usage_score,td_rz_score,defense_score,coverage_score,targets_per_game,target_share,inside10_targets,weakest_cb,cb_weakness,key_reason,position,availability,research_model,score_basis,updated_at) select season,week,game_id,game_date,game_time,away_team,home_team,game_label,play_rank,player,player_team,opponent,home_away,play_type,confidence,matchup_score,usage_score,td_rz_score,defense_score,coverage_score,targets_per_game,target_share,inside10_targets,weakest_cb,cb_weakness,key_reason,position,availability,research_model,score_basis,coalesce(updated_at,now()) from jsonb_populate_recordset(null::public.nfl_game_best_plays,p_games);
 insert into public.nfl_player_props (season,week,position,player,team,opponent,game_id,market,research_score,availability,score_basis,notes,updated_at) select season,week,position,player,team,opponent,game_id,market,research_score,availability,score_basis,notes,coalesce(updated_at,now()) from jsonb_populate_recordset(null::public.nfl_player_props,p_props);
 return jsonb_build_object('best_plays',jsonb_array_length(p_best),'game_best_plays',jsonb_array_length(p_games),'player_props',jsonb_array_length(p_props));
end; $$;
revoke all on function public.replace_nfl_expanded_research(integer,integer,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.replace_nfl_expanded_research(integer,integer,jsonb,jsonb,jsonb) to service_role;
