create table public.nfl_player_ou (
 season integer not null, week integer not null check(week between 1 and 18),
 player text not null, team text not null, opponent text not null,
 position text not null check(position in ('QB','RB','WR','TE')),
 market text not null, market_key text not null,
 projection numeric not null check(projection>=0 and projection<10000),
 availability text not null, role text not null, model text not null,
 detail jsonb not null check(jsonb_typeof(detail)='object'),
 quote jsonb check(quote is null or jsonb_typeof(quote)='object'),
 updated_at timestamptz not null default now(),
 primary key(season,week,player,team,market_key)
);
alter table public.nfl_player_ou enable row level security;
revoke all on public.nfl_player_ou from anon,authenticated;
grant select on public.nfl_player_ou to authenticated;
grant all on public.nfl_player_ou to service_role;
create policy authenticated_read_nfl_player_ou on public.nfl_player_ou for select to authenticated using(true);
create function public.replace_nfl_player_ou(p_season integer,p_week integer,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>2500 then raise exception 'Invalid O/U array'; end if;
 if exists(select 1 from jsonb_array_elements(p_rows) r where (r->>'season')::integer is distinct from p_season or (r->>'week')::integer is distinct from p_week) then raise exception 'Invalid O/U scope'; end if;
 perform pg_advisory_xact_lock(p_season,p_week);
 delete from public.nfl_player_ou where season=p_season and week=p_week;
 insert into public.nfl_player_ou select * from jsonb_populate_recordset(null::public.nfl_player_ou,p_rows);
 return jsonb_build_object('ou_projections',jsonb_array_length(p_rows));
end; $$;
revoke all on function public.replace_nfl_player_ou(integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.replace_nfl_player_ou(integer,integer,jsonb) to service_role;
