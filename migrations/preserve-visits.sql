-- Safe to re-apply. Changes the save function only, not existing account or journal data.
-- Old open tabs may save a journal without the new visits field.
-- Preserve the current visits array for those legacy writes.
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
