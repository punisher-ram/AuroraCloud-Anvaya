-- ============================================================
-- ANVAYA CHAT FEATURES — REPAIR / MIGRATION
-- Run this file ONCE in Supabase SQL Editor AFTER the original
-- Anvaya base schema has already been installed.
--
-- IMPORTANT:
--   • Do NOT rerun supabase_schema.sql if the base schema exists.
--   • This file is safe to rerun.
--   • It does NOT drop/recreate is_conversation_member().
--   • The first section fixes the exact errors:
--       messages.parent_message_id does not exist
--       messages.location_lat does not exist
-- ============================================================

-- ------------------------------------------------------------
-- 1. Add all chat-feature columns to messages
-- ------------------------------------------------------------
alter table public.messages add column if not exists parent_message_id uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists attachment_url text;
alter table public.messages add column if not exists attachment_name text;
alter table public.messages add column if not exists attachment_type text;
alter table public.messages add column if not exists location_lat double precision;
alter table public.messages add column if not exists location_lng double precision;
alter table public.messages add column if not exists poll_id uuid;

create index if not exists messages_parent_idx on public.messages(parent_message_id);
create index if not exists messages_poll_idx on public.messages(poll_id);

-- ------------------------------------------------------------
-- 2. Feature tables
-- ------------------------------------------------------------
create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null,
  created_at timestamptz not null default now(),
  unique(message_id,user_id,reaction)
);
create index if not exists message_reactions_message_idx on public.message_reactions(message_id);

create table if not exists public.message_pins (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  pinned_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(conversation_id,message_id)
);

create table if not exists public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key(conversation_id,user_id)
);

create table if not exists public.message_deliveries (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  primary key(message_id,user_id)
);

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  allow_multiple boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(poll_id,user_id)
);

create index if not exists poll_options_poll_idx on public.poll_options(poll_id);
create index if not exists poll_votes_poll_idx on public.poll_votes(poll_id);

-- ------------------------------------------------------------
-- 3. Helper for feature-table RLS
-- ------------------------------------------------------------
-- The base schema already owns is_conversation_member(uuid,uuid).
-- We intentionally do NOT replace it here.
create or replace function public.is_message_in_user_conversation(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
set row_security=off
as $$
  select exists(
    select 1
    from public.messages m
    where m.id=p_message_id
      and public.is_conversation_member(m.conversation_id,auth.uid())
  );
$$;

-- ------------------------------------------------------------
-- 4. Enable RLS
-- ------------------------------------------------------------
alter table public.message_reactions enable row level security;
alter table public.message_pins enable row level security;
alter table public.conversation_reads enable row level security;
alter table public.message_deliveries enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

-- ------------------------------------------------------------
-- 5. Reactions
-- ------------------------------------------------------------
drop policy if exists message_reactions_select_member on public.message_reactions;
create policy message_reactions_select_member
on public.message_reactions for select to authenticated
using(public.is_message_in_user_conversation(message_id));

drop policy if exists message_reactions_insert_own on public.message_reactions;
create policy message_reactions_insert_own
on public.message_reactions for insert to authenticated
with check(auth.uid()=user_id and public.is_message_in_user_conversation(message_id));

drop policy if exists message_reactions_delete_own on public.message_reactions;
create policy message_reactions_delete_own
on public.message_reactions for delete to authenticated
using(auth.uid()=user_id);

-- ------------------------------------------------------------
-- 6. Pins
-- ------------------------------------------------------------
drop policy if exists message_pins_select_member on public.message_pins;
create policy message_pins_select_member
on public.message_pins for select to authenticated
using(public.is_conversation_member(conversation_id));

drop policy if exists message_pins_insert_member on public.message_pins;
create policy message_pins_insert_member
on public.message_pins for insert to authenticated
with check(auth.uid()=pinned_by and public.is_conversation_member(conversation_id));

drop policy if exists message_pins_delete_member on public.message_pins;
create policy message_pins_delete_member
on public.message_pins for delete to authenticated
using(public.is_conversation_member(conversation_id));

-- ------------------------------------------------------------
-- 7. Read state
-- ------------------------------------------------------------
drop policy if exists conversation_reads_select_own on public.conversation_reads;
create policy conversation_reads_select_own
on public.conversation_reads for select to authenticated
using(auth.uid()=user_id);

drop policy if exists conversation_reads_insert_own on public.conversation_reads;
create policy conversation_reads_insert_own
on public.conversation_reads for insert to authenticated
with check(auth.uid()=user_id and public.is_conversation_member(conversation_id));

drop policy if exists conversation_reads_update_own on public.conversation_reads;
create policy conversation_reads_update_own
on public.conversation_reads for update to authenticated
using(auth.uid()=user_id)
with check(auth.uid()=user_id and public.is_conversation_member(conversation_id));

-- ------------------------------------------------------------
-- 8. Delivery/read receipts
-- ------------------------------------------------------------
drop policy if exists message_deliveries_select_member on public.message_deliveries;
create policy message_deliveries_select_member
on public.message_deliveries for select to authenticated
using(public.is_message_in_user_conversation(message_id));

drop policy if exists message_deliveries_insert_own on public.message_deliveries;
create policy message_deliveries_insert_own
on public.message_deliveries for insert to authenticated
with check(auth.uid()=user_id and public.is_message_in_user_conversation(message_id));

drop policy if exists message_deliveries_update_own on public.message_deliveries;
create policy message_deliveries_update_own
on public.message_deliveries for update to authenticated
using(auth.uid()=user_id)
with check(auth.uid()=user_id and public.is_message_in_user_conversation(message_id));

-- ------------------------------------------------------------
-- 9. Polls
-- ------------------------------------------------------------
drop policy if exists polls_select_member on public.polls;
create policy polls_select_member
on public.polls for select to authenticated
using(public.is_conversation_member(conversation_id));

drop policy if exists polls_insert_member on public.polls;
create policy polls_insert_member
on public.polls for insert to authenticated
with check(auth.uid()=creator_id and public.is_conversation_member(conversation_id));

drop policy if exists poll_options_select_member on public.poll_options;
create policy poll_options_select_member
on public.poll_options for select to authenticated
using(exists(
  select 1 from public.polls p
  where p.id=poll_id
    and public.is_conversation_member(p.conversation_id)
));

drop policy if exists poll_options_insert_member on public.poll_options;
create policy poll_options_insert_member
on public.poll_options for insert to authenticated
with check(exists(
  select 1 from public.polls p
  where p.id=poll_id
    and p.creator_id=auth.uid()
    and public.is_conversation_member(p.conversation_id)
));

drop policy if exists poll_votes_select_member on public.poll_votes;
create policy poll_votes_select_member
on public.poll_votes for select to authenticated
using(exists(
  select 1 from public.polls p
  where p.id=poll_id
    and public.is_conversation_member(p.conversation_id)
));

drop policy if exists poll_votes_insert_own on public.poll_votes;
create policy poll_votes_insert_own
on public.poll_votes for insert to authenticated
with check(auth.uid()=user_id and exists(
  select 1 from public.polls p
  where p.id=poll_id
    and public.is_conversation_member(p.conversation_id)
));

drop policy if exists poll_votes_update_own on public.poll_votes;
create policy poll_votes_update_own
on public.poll_votes for update to authenticated
using(auth.uid()=user_id)
with check(auth.uid()=user_id);

-- ------------------------------------------------------------
-- 10. Private chat media storage
-- ------------------------------------------------------------
insert into storage.buckets(id,name,public)
values('anvaya-chat-media','anvaya-chat-media',false)
on conflict(id) do nothing;

drop policy if exists anvaya_chat_media_select on storage.objects;
create policy anvaya_chat_media_select
on storage.objects for select to authenticated
using(
  bucket_id='anvaya-chat-media'
  and (
    (storage.foldername(name))[1]=auth.uid()::text
    or public.is_conversation_member(((storage.foldername(name))[2])::uuid)
  )
);

drop policy if exists anvaya_chat_media_insert on storage.objects;
create policy anvaya_chat_media_insert
on storage.objects for insert to authenticated
with check(bucket_id='anvaya-chat-media' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists anvaya_chat_media_update on storage.objects;
create policy anvaya_chat_media_update
on storage.objects for update to authenticated
using(bucket_id='anvaya-chat-media' and (storage.foldername(name))[1]=auth.uid()::text)
with check(bucket_id='anvaya-chat-media' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists anvaya_chat_media_delete on storage.objects;
create policy anvaya_chat_media_delete
on storage.objects for delete to authenticated
using(bucket_id='anvaya-chat-media' and (storage.foldername(name))[1]=auth.uid()::text);

-- ------------------------------------------------------------
-- 11. Realtime
-- ------------------------------------------------------------
do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='message_reactions') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='message_pins') then
    alter publication supabase_realtime add table public.message_pins;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='conversation_reads') then
    alter publication supabase_realtime add table public.conversation_reads;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='message_deliveries') then
    alter publication supabase_realtime add table public.message_deliveries;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='poll_votes') then
    alter publication supabase_realtime add table public.poll_votes;
  end if;
end $$;

-- Force PostgREST to refresh its schema cache immediately after the DDL.
notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 12. Verification: these should all return true / 1 row.
-- ------------------------------------------------------------
select
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='messages' and column_name='parent_message_id') as parent_message_id_ready,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='messages' and column_name='location_lat') as location_lat_ready,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='messages' and column_name='location_lng') as location_lng_ready,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='messages' and column_name='attachment_url') as attachment_url_ready,
  exists(select 1 from information_schema.tables where table_schema='public' and table_name='message_reactions') as reactions_ready,
  exists(select 1 from information_schema.tables where table_schema='public' and table_name='polls') as polls_ready;


-- ============================================================
-- ANVAYA CHAT v4 ADDITIONS: GROUPS, ATOMIC POLLS, PRIVACY
-- Safe to rerun. Adds only requested capabilities.
-- ============================================================

alter table public.profiles add column if not exists read_receipts_enabled boolean not null default true;
alter table public.profiles add column if not exists last_seen_enabled boolean not null default true;
alter table public.profiles add column if not exists last_seen_at timestamptz;

-- Atomic group creation: creates the group and all members in one server-side call.
create or replace function public.create_group(p_title text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path=public
set row_security=off
as $$
declare
  me uuid := auth.uid();
  cid uuid;
  member_id uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if length(trim(coalesce(p_title,''))) < 1 then raise exception 'Group name is required'; end if;
  if coalesce(array_length(p_member_ids,1),0) < 1 then raise exception 'Select at least one person'; end if;
  insert into public.conversations(kind,title) values('group',left(trim(p_title),80)) returning id into cid;
  insert into public.conversation_members(conversation_id,user_id) values(cid,me);
  foreach member_id in array p_member_ids loop
    if member_id is not null and member_id <> me then
      if not exists(
        select 1 from public.friend_requests fr
        where fr.status='accepted'
          and ((fr.sender_id=me and fr.receiver_id=member_id) or (fr.sender_id=member_id and fr.receiver_id=me))
      ) then
        delete from public.conversations where id=cid;
        raise exception 'All group members must be accepted connections';
      end if;
      insert into public.conversation_members(conversation_id,user_id) values(cid,member_id) on conflict do nothing;
    end if;
  end loop;
  if (select count(*) from public.conversation_members where conversation_id=cid) < 2 then
    delete from public.conversations where id=cid;
    raise exception 'Select at least one other person';
  end if;
  return cid;
end $$;

revoke all on function public.create_group(text,uuid[]) from public;
grant execute on function public.create_group(text,uuid[]) to authenticated;

-- Atomic poll creation fixes partial poll records and RLS ordering problems.
create or replace function public.create_poll(p_conversation_id uuid,p_question text,p_options text[],p_allow_multiple boolean default false)
returns uuid
language plpgsql
security definer
set search_path=public
set row_security=off
as $$
declare
  me uuid := auth.uid();
  pid uuid;
  mid uuid;
  opt text;
  clean text[] := array(
    select trim(x) from unnest(coalesce(p_options,array[]::text[])) x
    where length(trim(x))>0
  );
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if not public.is_conversation_member(p_conversation_id,me) then raise exception 'You are not a member of this conversation'; end if;
  if length(trim(coalesce(p_question,''))) < 1 then raise exception 'Poll question is required'; end if;
  if coalesce(array_length(clean,1),0) < 2 then raise exception 'A poll needs at least two options'; end if;
  insert into public.polls(conversation_id,creator_id,question,allow_multiple)
  values(p_conversation_id,me,left(trim(p_question),500),coalesce(p_allow_multiple,false)) returning id into pid;
  foreach opt in array clean loop
    insert into public.poll_options(poll_id,label) values(pid,left(opt,200));
  end loop;
  insert into public.messages(conversation_id,sender_id,body,poll_id)
  values(p_conversation_id,me,'📊 Poll: '||left(trim(p_question),500),pid) returning id into mid;
  return pid;
end $$;

revoke all on function public.create_poll(uuid,text,text[],boolean) from public;
grant execute on function public.create_poll(uuid,text,text[],boolean) to authenticated;

notify pgrst, 'reload schema';

select
  exists(select 1 from information_schema.tables where table_schema='public' and table_name='conversations') as conversations_ready,
  exists(select 1 from information_schema.tables where table_schema='public' and table_name='conversation_members') as conversation_members_ready,
  exists(select 1 from information_schema.tables where table_schema='public' and table_name='polls') as polls_ready,
  exists(select 1 from information_schema.tables where table_schema='public' and table_name='poll_options') as poll_options_ready,
  exists(select 1 from information_schema.tables where table_schema='public' and table_name='poll_votes') as poll_votes_ready,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='read_receipts_enabled') as read_receipts_ready,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='last_seen_enabled') as last_seen_ready;


-- ------------------------------------------------------------
-- 14. Account deletion
-- ------------------------------------------------------------
-- Deletes only the currently authenticated user's account.
-- auth.users cascades remove the user's profile, messages,
-- reactions, pins, reads, deliveries, polls and memberships.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path=public,auth
set row_security=off
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not authenticated'; end if;
  delete from auth.users where id=me;
end $$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- 15. Robust conversation/group/poll RPCs
-- These functions are additive and do not replace the base
-- is_conversation_member() helper.
-- ============================================================

create or replace function public.get_my_conversations()
returns table(conversation_id uuid, kind text, title text, updated_at timestamptz)
language sql
stable
security definer
set search_path=public
set row_security=off
as $$
  select c.id,c.kind,c.title,c.updated_at
  from public.conversations c
  join public.conversation_members cm on cm.conversation_id=c.id
  where cm.user_id=auth.uid()
  order by c.updated_at desc;
$$;
revoke all on function public.get_my_conversations() from public;
grant execute on function public.get_my_conversations() to authenticated;

create or replace function public.start_direct_chat(p_other_user uuid)
returns uuid
language plpgsql
security definer
set search_path=public
set row_security=off
as $$
declare me uuid:=auth.uid(); cid uuid;
begin
  if me is null or p_other_user is null or me=p_other_user then raise exception 'Invalid conversation participants'; end if;
  if not exists(
    select 1 from public.friend_requests fr
    where fr.status='accepted'
      and ((fr.sender_id=me and fr.receiver_id=p_other_user) or (fr.sender_id=p_other_user and fr.receiver_id=me))
  ) then raise exception 'Users must be connected before messaging'; end if;
  select c.id into cid
  from public.conversations c
  where c.kind='direct'
    and exists(select 1 from public.conversation_members x where x.conversation_id=c.id and x.user_id=me)
    and exists(select 1 from public.conversation_members y where y.conversation_id=c.id and y.user_id=p_other_user)
  order by c.created_at asc limit 1;
  if cid is null then
    insert into public.conversations(kind) values('direct') returning id into cid;
    insert into public.conversation_members(conversation_id,user_id) values(cid,me),(cid,p_other_user);
  end if;
  return cid;
end $$;
revoke all on function public.start_direct_chat(uuid) from public;
grant execute on function public.start_direct_chat(uuid) to authenticated;

create or replace function public.create_group_v2(p_title text,p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path=public
set row_security=off
as $$
declare me uuid:=auth.uid(); cid uuid; member_id uuid; clean_ids uuid[];
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if length(trim(coalesce(p_title,'')))<1 then raise exception 'Group name is required'; end if;
  select coalesce(array_agg(distinct x order by x),array[]::uuid[]) into clean_ids
  from unnest(coalesce(p_member_ids,array[]::uuid[])) x
  where x is not null and x<>me;
  if coalesce(array_length(clean_ids,1),0)<1 then raise exception 'Select at least one other person'; end if;
  foreach member_id in array clean_ids loop
    if not exists(
      select 1 from public.friend_requests fr
      where fr.status='accepted'
        and ((fr.sender_id=me and fr.receiver_id=member_id) or (fr.sender_id=member_id and fr.receiver_id=me))
    ) then raise exception 'Every selected person must be an accepted connection'; end if;
  end loop;
  insert into public.conversations(kind,title) values('group',left(trim(p_title),80)) returning id into cid;
  insert into public.conversation_members(conversation_id,user_id) values(cid,me);
  insert into public.conversation_members(conversation_id,user_id)
    select cid,x from unnest(clean_ids) x on conflict do nothing;
  return cid;
end $$;
revoke all on function public.create_group_v2(text,uuid[]) from public;
grant execute on function public.create_group_v2(text,uuid[]) to authenticated;

create or replace function public.create_poll_v2(p_conversation_id uuid,p_question text,p_options text[],p_allow_multiple boolean default false)
returns uuid
language plpgsql
security definer
set search_path=public
set row_security=off
as $$
declare me uuid:=auth.uid(); pid uuid; opt text; clean text[];
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from public.conversation_members where conversation_id=p_conversation_id and user_id=me) then raise exception 'You are not a member of this conversation'; end if;
  if length(trim(coalesce(p_question,'')))<1 then raise exception 'Poll question is required'; end if;
  select coalesce(array_agg(left(trim(x),200)),array[]::text[]) into clean
  from unnest(coalesce(p_options,array[]::text[])) x
  where length(trim(x))>0;
  if coalesce(array_length(clean,1),0)<2 then raise exception 'A poll needs at least two options'; end if;
  insert into public.polls(conversation_id,creator_id,question,allow_multiple) values(p_conversation_id,me,left(trim(p_question),500),coalesce(p_allow_multiple,false)) returning id into pid;
  foreach opt in array clean loop insert into public.poll_options(poll_id,label) values(pid,opt); end loop;
  insert into public.messages(conversation_id,sender_id,body,poll_id) values(p_conversation_id,me,'📊 Poll: '||left(trim(p_question),500),pid);
  return pid;
end $$;
revoke all on function public.create_poll_v2(uuid,text,text[],boolean) from public;
grant execute on function public.create_poll_v2(uuid,text,text[],boolean) to authenticated;

notify pgrst, 'reload schema';
