-- 可重复执行。给吃药服务加「历史版本」：每次保存前，数据库自动把上一版完整存一份。
-- 误删、被别的设备覆盖或页面出 bug 时，都能从这里找回任意旧版本。
-- 只能看自己账号的历史；网页不能改、不能删历史（只有数据库管理员能处理）。
create table if not exists public.medicine_journal_history (
  id bigserial primary key,
  user_id uuid not null,
  revision bigint not null,
  data jsonb not null,
  saved_at timestamptz not null default now()
);
create index if not exists medicine_journal_history_user_idx on public.medicine_journal_history (user_id, revision desc);
alter table public.medicine_journal_history enable row level security;
drop policy if exists "own history readable" on public.medicine_journal_history;
create policy "own history readable" on public.medicine_journal_history
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.medicine_journal_history from public, anon, authenticated;
grant select on public.medicine_journal_history to authenticated;

create or replace function public.keep_medicine_journal_history()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.data is distinct from new.data then
    insert into public.medicine_journal_history (user_id, revision, data)
      values (old.user_id, old.revision, old.data);
  end if;
  return new;
end;
$$;
revoke all on function public.keep_medicine_journal_history() from public, anon, authenticated;
drop trigger if exists keep_history on public.medicine_journals;
create trigger keep_history before update on public.medicine_journals
  for each row execute function public.keep_medicine_journal_history();
