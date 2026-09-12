-- Vyara production-ready Supabase foundation.
-- Run once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  unique(sender_id, receiver_id),
  check(sender_id <> receiver_id)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'direct' check (kind in ('direct','group')),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key(conversation_id,user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check(length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists conversation_members_user_idx on public.conversation_members(user_id);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id,created_at);
create index if not exists friend_requests_receiver_status_idx on public.friend_requests(receiver_id,status);

-- Existing accounts created before this schema are backfilled safely.
do $$
declare
  u record;
  base text;
  candidate text;
  n integer;
begin
  for u in select id,email,raw_user_meta_data from auth.users loop
    if not exists(select 1 from public.profiles where user_id=u.id) then
      base := lower(regexp_replace(coalesce(u.raw_user_meta_data->>'username',split_part(coalesce(u.email,''),'@',1)),'[^a-z0-9._-]','','g'));
      if base='' then base:='user'; end if;
      candidate:=base; n:=0;
      while exists(select 1 from public.profiles where username=candidate) loop
        n:=n+1; candidate:=base||'.'||n;
      end loop;
      insert into public.profiles(user_id,username,display_name)
      values(u.id,candidate,coalesce(u.raw_user_meta_data->>'display_name',candidate));
    end if;
  end loop;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
declare base text; candidate text; n integer:=0;
begin
  base:=lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username',split_part(coalesce(new.email,''),'@',1)),'[^a-z0-9._-]','','g'));
  if base='' then base:='user'; end if;
  candidate:=base;
  while exists(select 1 from public.profiles where username=candidate) loop n:=n+1; candidate:=base||'.'||n; end loop;
  insert into public.profiles(user_id,username,display_name)
  values(new.id,candidate,coalesce(new.raw_user_meta_data->>'display_name',candidate)) on conflict(user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- is_conversation_member is referenced by RLS policies, so remove those policies first.
drop policy if exists conversations_select_member on public.conversations;
drop policy if exists conversation_members_select_member on public.conversation_members;
drop policy if exists messages_select_member on public.messages;
drop policy if exists messages_insert_member on public.messages;

drop function if exists public.is_conversation_member(uuid,uuid);
create function public.is_conversation_member(p_conversation_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path=public
set row_security=off
as $$
  select exists(
    select 1 from public.conversation_members cm
    where cm.conversation_id=p_conversation_id
      and cm.user_id=p_user_id
  );
$$;

create or replace function public.are_connected(a uuid, b uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(select 1 from public.friend_requests fr where fr.status='accepted' and ((fr.sender_id=a and fr.receiver_id=b) or (fr.sender_id=b and fr.receiver_id=a)));
$$;

drop function if exists public.get_or_create_direct_conversation(uuid);

create function public.get_or_create_direct_conversation(p_other_user uuid)
returns uuid language plpgsql security definer set search_path=public
as $$
declare me uuid:=auth.uid(); cid uuid;
begin
  if me is null or p_other_user is null or me=p_other_user then raise exception 'Invalid conversation participants'; end if;
  if not public.are_connected(me,p_other_user) then raise exception 'Users must be connected before messaging'; end if;
  select cm1.conversation_id into cid
  from public.conversation_members cm1 join public.conversation_members cm2 on cm2.conversation_id=cm1.conversation_id
  join public.conversations c on c.id=cm1.conversation_id
  where cm1.user_id=me and cm2.user_id=p_other_user and c.kind='direct' limit 1;
  if cid is null then
    insert into public.conversations(kind) values('direct') returning id into cid;
    insert into public.conversation_members(conversation_id,user_id) values(cid,me),(cid,p_other_user);
  end if;
  return cid;
end $$;

create or replace function public.touch_conversation()
returns trigger language plpgsql security definer set search_path=public
as $$ begin update public.conversations set updated_at=now() where id=new.conversation_id; return new; end $$;
drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation after insert on public.messages for each row execute procedure public.touch_conversation();

alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated on public.profiles for select to authenticated using(true);
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles for insert to authenticated with check(auth.uid()=user_id);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);

drop policy if exists friend_requests_select_own on public.friend_requests;
create policy friend_requests_select_own on public.friend_requests for select to authenticated using(auth.uid()=sender_id or auth.uid()=receiver_id);
drop policy if exists friend_requests_insert_sender on public.friend_requests;
create policy friend_requests_insert_sender on public.friend_requests for insert to authenticated with check(auth.uid()=sender_id);
drop policy if exists friend_requests_update_receiver on public.friend_requests;
create policy friend_requests_update_receiver on public.friend_requests for update to authenticated using(auth.uid()=receiver_id) with check(auth.uid()=receiver_id);

drop policy if exists conversations_select_member on public.conversations;
create policy conversations_select_member on public.conversations for select to authenticated using(public.is_conversation_member(id));
drop policy if exists conversation_members_select_member on public.conversation_members;
create policy conversation_members_select_member on public.conversation_members for select to authenticated using(public.is_conversation_member(conversation_id));

drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages for select to authenticated using(public.is_conversation_member(conversation_id));
drop policy if exists messages_insert_member on public.messages;
create policy messages_insert_member on public.messages for insert to authenticated with check(auth.uid()=sender_id and public.is_conversation_member(conversation_id));
drop policy if exists messages_update_sender on public.messages;
create policy messages_update_sender on public.messages for update to authenticated using(auth.uid()=sender_id) with check(auth.uid()=sender_id);
drop policy if exists messages_delete_sender on public.messages;
create policy messages_delete_sender on public.messages for delete to authenticated using(auth.uid()=sender_id);

-- Storage: private profile-avatar bucket. Object paths are <auth.uid()>/avatar.ext
insert into storage.buckets(id,name,public) values('vyara-avatars','vyara-avatars',false) on conflict(id) do nothing;

drop policy if exists vyara_avatar_select on storage.objects;
create policy vyara_avatar_select on storage.objects for select to authenticated using(bucket_id='vyara-avatars');
drop policy if exists vyara_avatar_insert_own on storage.objects;
create policy vyara_avatar_insert_own on storage.objects for insert to authenticated with check(bucket_id='vyara-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists vyara_avatar_update_own on storage.objects;
create policy vyara_avatar_update_own on storage.objects for update to authenticated using(bucket_id='vyara-avatars' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='vyara-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists vyara_avatar_delete_own on storage.objects;
create policy vyara_avatar_delete_own on storage.objects for delete to authenticated using(bucket_id='vyara-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

revoke all on function public.get_or_create_direct_conversation(uuid) from public;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;

-- Realtime for actual message delivery. Safe to rerun.
do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
-- ============================================================
-- ANVAYA CHAT FEATURES MIGRATION
-- Run AFTER the existing Anvaya Supabase schema.
-- No API keys required.
-- ============================================================

-- Message feature columns
alter table public.messages add column if not exists parent_message_id uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists attachment_url text;
alter table public.messages add column if not exists attachment_name text;
alter table public.messages add column if not exists attachment_type text;
alter table public.messages add column if not exists location_lat double precision;
alter table public.messages add column if not exists location_lng double precision;
alter table public.messages add column if not exists poll_id uuid;

create index if not exists messages_parent_idx on public.messages(parent_message_id);
create index if not exists messages_poll_idx on public.messages(poll_id);

-- Reactions
create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null,
  created_at timestamptz not null default now(),
  unique(message_id,user_id,reaction)
);
create index if not exists message_reactions_message_idx on public.message_reactions(message_id);

-- Pinned messages
create table if not exists public.message_pins (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  pinned_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(conversation_id,message_id)
);

-- Per-conversation read state
create table if not exists public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key(conversation_id,user_id)
);

-- Per-message delivery/read receipts
create table if not exists public.message_deliveries (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  primary key(message_id,user_id)
);

-- Polls
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

-- RLS helper for poll/conversation access
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

-- RLS
alter table public.message_reactions enable row level security;
alter table public.message_pins enable row level security;
alter table public.conversation_reads enable row level security;
alter table public.message_deliveries enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

-- Reactions
 drop policy if exists message_reactions_select_member on public.message_reactions;
create policy message_reactions_select_member on public.message_reactions for select to authenticated using(public.is_message_in_user_conversation(message_id));
drop policy if exists message_reactions_insert_own on public.message_reactions;
create policy message_reactions_insert_own on public.message_reactions for insert to authenticated with check(auth.uid()=user_id and public.is_message_in_user_conversation(message_id));
drop policy if exists message_reactions_delete_own on public.message_reactions;
create policy message_reactions_delete_own on public.message_reactions for delete to authenticated using(auth.uid()=user_id);

-- Pins
 drop policy if exists message_pins_select_member on public.message_pins;
create policy message_pins_select_member on public.message_pins for select to authenticated using(public.is_conversation_member(conversation_id));
drop policy if exists message_pins_insert_member on public.message_pins;
create policy message_pins_insert_member on public.message_pins for insert to authenticated with check(auth.uid()=pinned_by and public.is_conversation_member(conversation_id));
drop policy if exists message_pins_delete_member on public.message_pins;
create policy message_pins_delete_member on public.message_pins for delete to authenticated using(public.is_conversation_member(conversation_id));

-- Reads
 drop policy if exists conversation_reads_select_own on public.conversation_reads;
create policy conversation_reads_select_own on public.conversation_reads for select to authenticated using(auth.uid()=user_id);
drop policy if exists conversation_reads_insert_own on public.conversation_reads;
create policy conversation_reads_insert_own on public.conversation_reads for insert to authenticated with check(auth.uid()=user_id and public.is_conversation_member(conversation_id));
drop policy if exists conversation_reads_update_own on public.conversation_reads;
create policy conversation_reads_update_own on public.conversation_reads for update to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id and public.is_conversation_member(conversation_id));

-- Delivery receipts
 drop policy if exists message_deliveries_select_member on public.message_deliveries;
create policy message_deliveries_select_member on public.message_deliveries for select to authenticated using(public.is_message_in_user_conversation(message_id));
drop policy if exists message_deliveries_insert_own on public.message_deliveries;
create policy message_deliveries_insert_own on public.message_deliveries for insert to authenticated with check(auth.uid()=user_id and public.is_message_in_user_conversation(message_id));
drop policy if exists message_deliveries_update_own on public.message_deliveries;
create policy message_deliveries_update_own on public.message_deliveries for update to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id and public.is_message_in_user_conversation(message_id));

-- Polls
 drop policy if exists polls_select_member on public.polls;
create policy polls_select_member on public.polls for select to authenticated using(public.is_conversation_member(conversation_id));
drop policy if exists polls_insert_member on public.polls;
create policy polls_insert_member on public.polls for insert to authenticated with check(auth.uid()=creator_id and public.is_conversation_member(conversation_id));

-- Poll options are readable/creatable only when their poll belongs to a member conversation.
drop policy if exists poll_options_select_member on public.poll_options;
create policy poll_options_select_member on public.poll_options for select to authenticated using(exists(select 1 from public.polls p where p.id=poll_id and public.is_conversation_member(p.conversation_id)));
drop policy if exists poll_options_insert_member on public.poll_options;
create policy poll_options_insert_member on public.poll_options for insert to authenticated with check(exists(select 1 from public.polls p where p.id=poll_id and p.creator_id=auth.uid() and public.is_conversation_member(p.conversation_id)));

-- Votes
drop policy if exists poll_votes_select_member on public.poll_votes;
create policy poll_votes_select_member on public.poll_votes for select to authenticated using(exists(select 1 from public.polls p where p.id=poll_id and public.is_conversation_member(p.conversation_id)));
drop policy if exists poll_votes_insert_own on public.poll_votes;
create policy poll_votes_insert_own on public.poll_votes for insert to authenticated with check(auth.uid()=user_id and exists(select 1 from public.polls p where p.id=poll_id and public.is_conversation_member(p.conversation_id)));
drop policy if exists poll_votes_update_own on public.poll_votes;
create policy poll_votes_update_own on public.poll_votes for update to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);

-- Chat media bucket. Private; objects are stored as <user_id>/<conversation_id>/filename.
insert into storage.buckets(id,name,public) values('anvaya-chat-media','anvaya-chat-media',false) on conflict(id) do nothing;

drop policy if exists anvaya_chat_media_select on storage.objects;
create policy anvaya_chat_media_select on storage.objects for select to authenticated using(bucket_id='anvaya-chat-media' and ((storage.foldername(name))[1]=auth.uid()::text or public.is_conversation_member(((storage.foldername(name))[2])::uuid)));
drop policy if exists anvaya_chat_media_insert on storage.objects;
create policy anvaya_chat_media_insert on storage.objects for insert to authenticated with check(bucket_id='anvaya-chat-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists anvaya_chat_media_update on storage.objects;
create policy anvaya_chat_media_update on storage.objects for update to authenticated using(bucket_id='anvaya-chat-media' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='anvaya-chat-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists anvaya_chat_media_delete on storage.objects;
create policy anvaya_chat_media_delete on storage.objects for delete to authenticated using(bucket_id='anvaya-chat-media' and (storage.foldername(name))[1]=auth.uid()::text);

-- Realtime for feature tables. Safe to rerun.
do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='message_reactions') then alter publication supabase_realtime add table public.message_reactions; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='message_pins') then alter publication supabase_realtime add table public.message_pins; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='conversation_reads') then alter publication supabase_realtime add table public.conversation_reads; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='message_deliveries') then alter publication supabase_realtime add table public.message_deliveries; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='poll_votes') then alter publication supabase_realtime add table public.poll_votes; end if;
end $$;
