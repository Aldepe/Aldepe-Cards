-- Aldepe Forge schema for Supabase.
-- Run this in Supabase SQL Editor after creating a project.
-- Then enable Auth -> Sign In / Providers -> Anonymous sign-ins.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  is_admin boolean not null default false,
  last_pack_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
add column if not exists last_pack_opened_at timestamptz;

create table if not exists public.packs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 48),
  cover_url text not null,
  color text not null default '#ff6f61',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.packs
add column if not exists color text not null default '#ff6f61';

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid,
  name text not null check (char_length(name) between 1 and 48),
  description text not null default '',
  rarity text not null check (rarity in ('comun', 'rara', 'epica', 'legendaria')),
  image_url text not null,
  weight integer not null default 10 check (weight > 0 and weight <= 200),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cards
add column if not exists pack_id uuid;

create table if not exists public.user_cards (
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  copies integer not null default 0 check (copies >= 0),
  holo_copies integer not null default 0 check (holo_copies >= 0),
  first_found_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

alter table public.user_cards
add column if not exists holo_copies integer not null default 0 check (holo_copies >= 0);

create table if not exists public.pack_opens (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  pack_id uuid,
  card_id uuid not null references public.cards(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.pack_opens
add column if not exists pack_id uuid;

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references public.profiles(id) on delete cascade,
  to_user_id uuid not null references public.profiles(id) on delete cascade,
  offer_card_id uuid not null references public.cards(id) on delete cascade,
  request_card_id uuid not null references public.cards(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_user_id <> to_user_id),
  check (offer_card_id <> request_card_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cards_pack_fkey'
  ) then
    alter table public.cards
    add constraint cards_pack_fkey
    foreign key (pack_id) references public.packs(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'user_cards_user_profile_fkey'
  ) then
    alter table public.user_cards
    add constraint user_cards_user_profile_fkey
    foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'pack_opens_pack_fkey'
  ) then
    alter table public.pack_opens
    add constraint pack_opens_pack_fkey
    foreign key (pack_id) references public.packs(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'pack_opens_user_profile_fkey'
  ) then
    alter table public.pack_opens
    add constraint pack_opens_user_profile_fkey
    foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists cards_set_updated_at on public.cards;
create trigger cards_set_updated_at
before update on public.cards
for each row execute function public.set_updated_at();

drop trigger if exists packs_set_updated_at on public.packs;
create trigger packs_set_updated_at
before update on public.packs
for each row execute function public.set_updated_at();

drop trigger if exists user_cards_set_updated_at on public.user_cards;
create trigger user_cards_set_updated_at
before update on public.user_cards
for each row execute function public.set_updated_at();

drop trigger if exists trades_set_updated_at on public.trades;
create trigger trades_set_updated_at
before update on public.trades
for each row execute function public.set_updated_at();

create or replace function public.keep_admin_flag_server_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' then
    if tg_op = 'INSERT' then
      new.is_admin = false;
    elsif tg_op = 'UPDATE' then
      new.is_admin = old.is_admin;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_keep_admin_flag_server_only on public.profiles;
create trigger profiles_keep_admin_flag_server_only
before insert or update on public.profiles
for each row execute function public.keep_admin_flag_server_only();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select profiles.is_admin from public.profiles where profiles.id = auth.uid()),
    false
  );
$$;

drop function if exists public.open_pack(integer);
drop function if exists public.open_pack(uuid, integer);

create or replace function public.open_pack(pack_uuid uuid, draw_count integer default 3)
returns table (
  id uuid,
  pack_id uuid,
  name text,
  description text,
  rarity text,
  image_url text,
  weight integer,
  copy_count integer,
  is_holo boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  selected_card public.cards%rowtype;
  draws integer := least(greatest(coalesce(draw_count, 3), 1), 10);
  new_copies integer;
  last_open timestamptz;
  holo_roll boolean;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if pack_uuid is null or not exists (
    select 1 from public.packs where packs.id = pack_uuid and packs.active = true
  ) then
    raise exception 'Pack not found';
  end if;

  select profiles.last_pack_opened_at
  into last_open
  from public.profiles
  where profiles.id = current_user_id
  for update;

  if last_open is not null and last_open > now() - interval '8 hours' then
    raise exception 'Next pack available at %', last_open + interval '8 hours';
  end if;

  if not exists (
    select 1 from public.cards
    where active = true and weight > 0 and cards.pack_id = pack_uuid
  ) then
    raise exception 'No active cards';
  end if;

  update public.profiles
  set last_pack_opened_at = now()
  where id = current_user_id;

  for draw_index in 1..draws loop
    select cards.*
    into selected_card
    from public.cards
    where cards.active = true and cards.weight > 0 and cards.pack_id = pack_uuid
    order by (-ln(greatest(random(), 0.000001)) / cards.weight)
    limit 1;

    holo_roll := random() < 0.025;

    if holo_roll then
      insert into public.user_cards (user_id, card_id, copies, holo_copies)
      values (current_user_id, selected_card.id, 0, 1)
      on conflict (user_id, card_id)
      do update set
        holo_copies = public.user_cards.holo_copies + 1,
        updated_at = now()
      returning holo_copies into new_copies;
    else
      insert into public.user_cards (user_id, card_id, copies, holo_copies)
      values (current_user_id, selected_card.id, 1, 0)
      on conflict (user_id, card_id)
      do update set
        copies = public.user_cards.copies + 1,
        updated_at = now()
      returning copies into new_copies;
    end if;

    insert into public.pack_opens (user_id, pack_id, card_id)
    values (current_user_id, pack_uuid, selected_card.id);

    id := selected_card.id;
    pack_id := selected_card.pack_id;
    name := selected_card.name;
    description := selected_card.description;
    rarity := selected_card.rarity;
    image_url := selected_card.image_url;
    weight := selected_card.weight;
    copy_count := new_copies;
    is_holo := holo_roll;
    return next;
  end loop;
end;
$$;

create or replace function public.accept_trade(trade_uuid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  trade_row public.trades%rowtype;
  offer_copies integer;
  request_copies integer;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select *
  into trade_row
  from public.trades
  where id = trade_uuid and status = 'pending'
  for update;

  if not found then
    raise exception 'Trade not found';
  end if;

  if trade_row.to_user_id <> current_user_id then
    raise exception 'Only the receiving player can accept this trade';
  end if;

  select copies
  into offer_copies
  from public.user_cards
  where user_id = trade_row.from_user_id and card_id = trade_row.offer_card_id
  for update;

  select copies
  into request_copies
  from public.user_cards
  where user_id = trade_row.to_user_id and card_id = trade_row.request_card_id
  for update;

  if coalesce(offer_copies, 0) <= 0 or coalesce(request_copies, 0) <= 0 then
    raise exception 'A card is no longer available';
  end if;

  update public.user_cards
  set copies = copies - 1, updated_at = now()
  where user_id = trade_row.from_user_id and card_id = trade_row.offer_card_id;

  delete from public.user_cards
  where user_id = trade_row.from_user_id and card_id = trade_row.offer_card_id and copies <= 0 and holo_copies <= 0;

  insert into public.user_cards (user_id, card_id, copies)
  values (trade_row.to_user_id, trade_row.offer_card_id, 1)
  on conflict (user_id, card_id)
  do update set copies = public.user_cards.copies + 1, updated_at = now();

  update public.user_cards
  set copies = copies - 1, updated_at = now()
  where user_id = trade_row.to_user_id and card_id = trade_row.request_card_id;

  delete from public.user_cards
  where user_id = trade_row.to_user_id and card_id = trade_row.request_card_id and copies <= 0 and holo_copies <= 0;

  insert into public.user_cards (user_id, card_id, copies)
  values (trade_row.from_user_id, trade_row.request_card_id, 1)
  on conflict (user_id, card_id)
  do update set copies = public.user_cards.copies + 1, updated_at = now();

  update public.trades
  set status = 'accepted', updated_at = now()
  where id = trade_row.id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.packs enable row level security;
alter table public.cards enable row level security;
alter table public.user_cards enable row level security;
alter table public.pack_opens enable row level security;
alter table public.trades enable row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated
on public.profiles for select to authenticated
using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles for insert to authenticated
with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists packs_read_authenticated on public.packs;
create policy packs_read_authenticated
on public.packs for select to authenticated
using (active = true or public.is_admin());

drop policy if exists packs_insert_admin on public.packs;
create policy packs_insert_admin
on public.packs for insert to authenticated
with check (public.is_admin());

drop policy if exists packs_update_admin on public.packs;
create policy packs_update_admin
on public.packs for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists packs_delete_admin on public.packs;
create policy packs_delete_admin
on public.packs for delete to authenticated
using (public.is_admin());

drop policy if exists cards_read_authenticated on public.cards;
create policy cards_read_authenticated
on public.cards for select to authenticated
using (
  public.is_admin()
  or (
    active = true
    and exists (
      select 1 from public.packs where packs.id = cards.pack_id and packs.active = true
    )
  )
);

drop policy if exists cards_insert_admin on public.cards;
create policy cards_insert_admin
on public.cards for insert to authenticated
with check (public.is_admin());

drop policy if exists cards_update_admin on public.cards;
create policy cards_update_admin
on public.cards for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists cards_delete_admin on public.cards;
create policy cards_delete_admin
on public.cards for delete to authenticated
using (public.is_admin());

drop policy if exists user_cards_select_own on public.user_cards;
create policy user_cards_select_own
on public.user_cards for select to authenticated
using (true);

drop policy if exists pack_opens_select_authenticated on public.pack_opens;
create policy pack_opens_select_authenticated
on public.pack_opens for select to authenticated
using (true);

drop policy if exists trades_select_participants on public.trades;
create policy trades_select_participants
on public.trades for select to authenticated
using (public.is_admin() or from_user_id = auth.uid() or to_user_id = auth.uid());

drop policy if exists trades_insert_own on public.trades;
create policy trades_insert_own
on public.trades for insert to authenticated
with check (from_user_id = auth.uid() and status = 'pending');

drop policy if exists trades_update_participants on public.trades;
create policy trades_update_participants
on public.trades for update to authenticated
using (
  status = 'pending'
  and (
    public.is_admin()
    or from_user_id = auth.uid()
    or to_user_id = auth.uid()
  )
)
with check (
  from_user_id = from_user_id
  and to_user_id = to_user_id
  and offer_card_id = offer_card_id
  and request_card_id = request_card_id
);

grant usage on schema public to anon, authenticated;
revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant insert (id, username) on public.profiles to authenticated;
grant update (username) on public.profiles to authenticated;
grant select, insert, update, delete on public.packs to authenticated;
grant select, insert, update, delete on public.cards to authenticated;
grant select on public.user_cards to authenticated;
grant select on public.pack_opens to authenticated;
grant select, insert on public.trades to authenticated;
grant update (status) on public.trades to authenticated;
grant execute on function public.open_pack(uuid, integer) to authenticated;
grant execute on function public.accept_trade(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-images',
  'card-images',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists card_images_public_read on storage.objects;
create policy card_images_public_read
on storage.objects for select to public
using (bucket_id = 'card-images');

drop policy if exists card_images_admin_insert on storage.objects;
create policy card_images_admin_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'card-images' and public.is_admin());

drop policy if exists card_images_admin_update on storage.objects;
create policy card_images_admin_update
on storage.objects for update to authenticated
using (bucket_id = 'card-images' and public.is_admin())
with check (bucket_id = 'card-images' and public.is_admin());

drop policy if exists card_images_admin_delete on storage.objects;
create policy card_images_admin_delete
on storage.objects for delete to authenticated
using (bucket_id = 'card-images' and public.is_admin());

-- After your first login, promote yourself with your exact player name:
-- update public.profiles set is_admin = true where username = 'TU_NOMBRE';
