-- Aggregate in the database so a full-season report is not truncated at 1,000 rows.
create function public.nfl_ou_performance(p_season integer)
returns table(market text,tracked bigint,wins bigint,losses bigint,pushes bigint,pending bigint,graded bigint,net numeric)
language sql stable security invoker set search_path='' as $$
 select s.market,count(*),
 count(*) filter(where r.actual>(s.quote->>'line')::numeric),
 count(*) filter(where r.actual<(s.quote->>'line')::numeric),
 count(*) filter(where r.actual=(s.quote->>'line')::numeric),
 count(*) filter(where r.actual is null),count(r.actual),
 coalesce(sum(case when r.actual is null then 0 when r.actual>(s.quote->>'line')::numeric then case when (s.quote->>'over_odds')::numeric>0 then (s.quote->>'over_odds')::numeric/100 else 100/abs((s.quote->>'over_odds')::numeric) end when r.actual<(s.quote->>'line')::numeric then -1 else 0 end),0)
 from public.nfl_ou_latest_observations s left join public.nfl_ou_results r
 using(season,week,event_id,player,team,market_key)
 where s.season=p_season and s.promoted group by s.market order by s.market;
$$;
revoke all on function public.nfl_ou_performance(integer) from public,anon;
grant execute on function public.nfl_ou_performance(integer) to authenticated,service_role;
create or replace function public.nfl_ou_pending(p_season integer) returns jsonb language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from public.nfl_ou_latest_observations s
 left join public.nfl_ou_results r using(season,week,event_id,player,team,market_key)
 where s.season=p_season and s.kickoff<now() and (r.actual is null or s.kickoff>now()-interval '14 days');
$$;
