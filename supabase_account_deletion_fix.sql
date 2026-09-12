-- Anvaya account deletion: server-side, complete live-data wipe.
-- Run ONCE in Supabase SQL Editor.
-- The secret/service-role key is NOT placed in this SQL or in the browser.

create or replace function public.delete_account_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public,auth,storage
set row_security = off
as $$
declare
  c uuid;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  if not exists (select 1 from auth.users where id=p_user_id) then
    raise exception 'Account does not exist';
  end if;

  -- Remove files owned by the account from Anvaya buckets.
  delete from storage.objects
  where bucket_id in ('vyara-avatars','anvaya-chat-media')
    and (storage.foldername(name))[1] = p_user_id::text;

  -- Remove conversations where this account is the only member.
  -- Shared conversations remain for the other members, while the user's
  -- own membership/messages/data are removed by the auth.users cascade.
  for c in
    select cm.conversation_id
    from public.conversation_members cm
    where cm.user_id=p_user_id
      and not exists (
        select 1 from public.conversation_members other
        where other.conversation_id=cm.conversation_id
          and other.user_id<>p_user_id
      )
  loop
    delete from public.conversations where id=c;
  end loop;

  -- auth.users has ON DELETE CASCADE relationships to the account-owned
  -- profile, requests, memberships, messages and rich-chat records.
  delete from auth.users where id=p_user_id;

  if not found then
    raise exception 'Account no longer exists';
  end if;
end;
$$;

revoke all on function public.delete_account_admin(uuid) from public;
revoke all on function public.delete_account_admin(uuid) from anon;
revoke all on function public.delete_account_admin(uuid) from authenticated;
grant execute on function public.delete_account_admin(uuid) to service_role;

notify pgrst, 'reload schema';

select exists (
  select 1 from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='delete_account_admin' and p.pronargs=1
) as delete_account_admin_ready;
