-- 可重复执行。只改保存函数，不动已有账号和记录。
-- 旧版页面不认识 checkups（体检报告）字段，保存时会把它漏掉。
-- 这里改成：新数据里没带的顶层字段（visits、checkups，以及以后新增的字段）一律保留数据库里原来的值。
-- 新数据里带了的字段照常覆盖，所以新版页面的修改和删除不受影响。
create or replace function public.save_medicine_journal(expected_revision bigint, new_data jsonb)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
begin
  update public.medicine_journals
    set data = coalesce(data, '{}'::jsonb) || new_data,
      revision = revision + 1
    where user_id = (select auth.uid()) and revision = expected_revision;
  return found;
end;
$$;
revoke all on function public.save_medicine_journal(bigint, jsonb) from public, anon;
grant execute on function public.save_medicine_journal(bigint, jsonb) to authenticated;
