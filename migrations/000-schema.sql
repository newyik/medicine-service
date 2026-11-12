create table if not exists public.medicine_journals (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  data jsonb not null default '{"medicines":[],"records":[]}'::jsonb,
  revision bigint not null default 0,
  constraint journal_shape check (jsonb_typeof(data->'medicines') = 'array' and jsonb_typeof(data->'records') = 'array')
);
alter table public.medicine_journals enable row level security;
revoke all on public.medicine_journals from anon, authenticated;
grant select, insert, update on public.medicine_journals to authenticated;
create policy "Own journal only" on public.medicine_journals
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.save_medicine_journal(expected_revision bigint, new_data jsonb)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
begin
  update public.medicine_journals
    set data = new_data, revision = revision + 1
    where user_id = (select auth.uid()) and revision = expected_revision;
  return found;
end;
$$;
revoke all on function public.save_medicine_journal(bigint, jsonb) from public, anon;
grant execute on function public.save_medicine_journal(bigint, jsonb) to authenticated;
