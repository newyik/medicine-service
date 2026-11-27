-- 2026-11-27：吃药服务迁到小家控共用的 together-list 项目（ref xwzovuseugyneqsmlnry）。
-- 等于把 000-schema.sql + preserve-visits.sql 合起来执行一次，可以重复执行。
-- together-list 项目的新表要单独 grant 给 authenticated，否则网页会收到 403。
create table if not exists public.medicine_journals (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  data jsonb not null default '{"medicines":[],"records":[]}'::jsonb,
  revision bigint not null default 0,
  constraint journal_shape check (jsonb_typeof(data->'medicines') = 'array' and jsonb_typeof(data->'records') = 'array')
);
alter table public.medicine_journals enable row level security;
revoke all on public.medicine_journals from anon, authenticated;
grant select, insert, update on public.medicine_journals to authenticated;
drop policy if exists "Own journal only" on public.medicine_journals;
create policy "Own journal only" on public.medicine_journals
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.save_medicine_journal(expected_revision bigint, new_data jsonb)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
begin
  update public.medicine_journals
    set data = case when new_data ? 'visits' then new_data
      else jsonb_set(new_data, '{visits}', coalesce(data->'visits', '[]'::jsonb)) end,
      revision = revision + 1
    where user_id = (select auth.uid()) and revision = expected_revision;
  return found;
end;
$$;
revoke all on function public.save_medicine_journal(bigint, jsonb) from public, anon;
grant execute on function public.save_medicine_journal(bigint, jsonb) to authenticated;
