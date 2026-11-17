-- JUARA Audience Engagement Passport
-- Skema database. Jalankan seluruh file ini sekali di Supabase: SQL Editor > New query > Run.
--
-- Prinsip keamanan:
--   * Semua tabel memakai Row Level Security. Peserta (tanpa login) tidak bisa membaca tabel apa pun.
--   * Peserta hanya berinteraksi lewat fungsi publik di bawah, dengan token rahasia passport miliknya.
--   * Crew dan admin login lewat Supabase Auth, dan hanya bisa bekerja di event tempat mereka terdaftar.
--   * Poin, bonus, stok, dan batas tukar dihitung di database, bukan di HP, jadi tidak bisa diakali dari browser.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tabel
-- ---------------------------------------------------------------------------

create table public.events (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name          text not null check (char_length(name) between 1 and 60),
  logo_url      text,
  poster_url    text,
  accent_color  text check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$'),
  bonus_points  integer not null default 20 check (bonus_points >= 0),
  is_open       boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.stations (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events on delete cascade,
  name            text not null check (char_length(name) between 1 and 40),
  mode            text not null check (mode in ('crew', 'quiz')),
  points          integer not null check (points > 0),
  sort            integer not null default 0,
  requires_check  boolean not null default false,
  quiz_question   text,
  quiz_options    text[],
  quiz_answer     integer,
  qr_secret       text not null default encode(extensions.gen_random_bytes(9), 'hex'),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint quiz_complete check (
    mode <> 'quiz'
    or (quiz_question is not null and array_length(quiz_options, 1) between 2 and 4
        and quiz_answer between 0 and array_length(quiz_options, 1) - 1)
  )
);
create index stations_event_idx on public.stations (event_id);

create table public.rewards (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.events on delete cascade,
  name              text not null check (char_length(name) between 1 and 40),
  description       text,
  photo_url         text,
  cost              integer not null check (cost > 0),
  stock_initial     integer not null check (stock_initial >= 0),
  stock_remaining   integer not null check (stock_remaining >= 0),
  limit_per_person  integer not null default 1 check (limit_per_person > 0),
  sort              integer not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);
create index rewards_event_idx on public.rewards (event_id);

create table public.participants (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events on delete cascade,
  code           text not null,                 -- kode pendek yang terlihat, mis. A1B2-C3D4
  name           text not null check (char_length(name) between 1 and 40),
  wa             text not null check (wa ~ '^[0-9]{9,15}$'),
  token          uuid not null unique default gen_random_uuid(),   -- rahasia, hanya di HP peserta
  qr_code        text not null unique default encode(extensions.gen_random_bytes(10), 'hex'),  -- isi QR passport
  points         integer not null default 0 check (points >= 0),   -- saldo
  earned         integer not null default 0,                       -- total yang pernah diperoleh
  bonus_awarded  boolean not null default false,
  consent_at     timestamptz not null,
  created_at     timestamptz not null default now(),
  unique (event_id, wa),
  unique (event_id, code)
);

create table public.claims (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events on delete cascade,
  participant_id  uuid not null references public.participants on delete cascade,
  station_id      uuid not null references public.stations on delete cascade,
  points          integer not null,
  staff_id        uuid,                          -- null untuk station kuis
  created_at      timestamptz not null default now(),
  unique (participant_id, station_id)
);
create index claims_event_idx on public.claims (event_id);
create index claims_station_idx on public.claims (station_id);

create table public.redemptions (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events on delete cascade,
  participant_id  uuid not null references public.participants on delete cascade,
  reward_id       uuid not null references public.rewards on delete cascade,
  cost            integer not null,
  staff_id        uuid not null,
  created_at      timestamptz not null default now()
);
create index redemptions_event_idx on public.redemptions (event_id);
create index redemptions_participant_idx on public.redemptions (participant_id);

create table public.event_staff (
  event_id  uuid not null references public.events on delete cascade,
  user_id   uuid not null references auth.users on delete cascade,
  role      text not null check (role in ('admin', 'crew')),
  primary key (event_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.events        enable row level security;
alter table public.stations      enable row level security;
alter table public.rewards       enable row level security;
alter table public.participants  enable row level security;
alter table public.claims        enable row level security;
alter table public.redemptions   enable row level security;
alter table public.event_staff   enable row level security;

create or replace function public.is_staff(p_event uuid, p_admin_only boolean default false)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.event_staff s
    where s.event_id = p_event and s.user_id = auth.uid()
      and (not p_admin_only or s.role = 'admin')
  );
$$;

-- Admin event mengelola event, station, dan hadiah miliknya langsung dari aplikasi.
create policy events_admin_select on public.events for select to authenticated using (public.is_staff(id, true));
create policy events_admin_update on public.events for update to authenticated using (public.is_staff(id, true)) with check (public.is_staff(id, true));

create policy stations_admin_all on public.stations for all to authenticated
  using (public.is_staff(event_id, true)) with check (public.is_staff(event_id, true));

create policy rewards_admin_all on public.rewards for all to authenticated
  using (public.is_staff(event_id, true)) with check (public.is_staff(event_id, true));

create policy staff_own_rows on public.event_staff for select to authenticated using (user_id = auth.uid());

-- participants, claims, redemptions sengaja tanpa policy: hanya bisa disentuh lewat fungsi di bawah.

-- ---------------------------------------------------------------------------
-- Fungsi internal
-- ---------------------------------------------------------------------------

-- Memberi poin satu station ke satu peserta, plus bonus bila semua station aktif selesai.
create or replace function public._award(p_participant uuid, p_station uuid, p_staff uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_p public.participants;
  v_s public.stations;
  v_e public.events;
  v_new uuid;
  v_done integer;
  v_total integer;
  v_bonus integer := 0;
begin
  select * into v_p from public.participants where id = p_participant for update;
  select * into v_s from public.stations where id = p_station;
  select * into v_e from public.events where id = v_s.event_id;

  insert into public.claims (event_id, participant_id, station_id, points, staff_id)
  values (v_s.event_id, v_p.id, v_s.id, v_s.points, p_staff)
  on conflict (participant_id, station_id) do nothing
  returning id into v_new;

  if v_new is null then
    return jsonb_build_object('status', 'already', 'name', v_p.name, 'station', v_s.name, 'balance', v_p.points);
  end if;

  if not v_p.bonus_awarded then
    select count(*) into v_total from public.stations where event_id = v_s.event_id and is_active;
    select count(*) into v_done
      from public.claims c join public.stations s on s.id = c.station_id
      where c.participant_id = v_p.id and s.is_active;
    if v_total > 0 and v_done >= v_total then
      v_bonus := v_e.bonus_points;
    end if;
  end if;

  update public.participants
     set points = points + v_s.points + v_bonus,
         earned = earned + v_s.points + v_bonus,
         bonus_awarded = bonus_awarded or v_bonus > 0 or (v_total > 0 and v_done >= v_total)
   where id = v_p.id
   returning * into v_p;

  return jsonb_build_object('status', 'ok', 'name', v_p.name, 'station', v_s.name,
                            'points', v_s.points, 'bonus', v_bonus, 'completed', v_p.bonus_awarded,
                            'balance', v_p.points);
end;
$$;

-- Mencari peserta dari isi QR passport atau dari kode pendek yang diketik crew.
create or replace function public._find_participant(p_event uuid, p_qr text)
returns public.participants
language sql stable security definer set search_path = public
as $$
  select p.* from public.participants p
  where p.event_id = p_event
    and (p.qr_code = lower(trim(p_qr))
         or p.code = upper(replace(replace(trim(p_qr), '-', ''), ' ', '')))
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Fungsi publik (peserta, tanpa login)
-- ---------------------------------------------------------------------------

-- Data event yang boleh dilihat siapa saja. Jawaban kuis dan rahasia QR station tidak ikut.
create or replace function public.public_event(p_slug text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', e.id, 'slug', e.slug, 'name', e.name, 'logo_url', e.logo_url, 'poster_url', e.poster_url,
    'accent_color', e.accent_color, 'bonus_points', e.bonus_points, 'is_open', e.is_open,
    'stations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'mode', s.mode, 'points', s.points, 'requires_check', s.requires_check,
        'quiz_question', s.quiz_question, 'quiz_options', s.quiz_options) order by s.sort, s.created_at)
      from public.stations s where s.event_id = e.id and s.is_active), '[]'::jsonb),
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'description', r.description, 'photo_url', r.photo_url, 'cost', r.cost,
        'stock_remaining', r.stock_remaining, 'limit_per_person', r.limit_per_person) order by r.sort, r.cost)
      from public.rewards r where r.event_id = e.id and r.is_active), '[]'::jsonb)
  )
  from public.events e where e.slug = lower(p_slug);
$$;

create or replace function public.register_participant(p_slug text, p_name text, p_wa text, p_consent boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_e public.events;
  v_name text := trim(coalesce(p_name, ''));
  v_wa text := regexp_replace(coalesce(p_wa, ''), '[^0-9]', '', 'g');
  v_token uuid;
  v_try integer := 0;
begin
  select * into v_e from public.events where slug = lower(p_slug);
  if v_e.id is null then return jsonb_build_object('status', 'no_event'); end if;
  if not v_e.is_open then return jsonb_build_object('status', 'closed'); end if;
  if not coalesce(p_consent, false) then return jsonb_build_object('status', 'no_consent'); end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 or v_wa !~ '^[0-9]{9,15}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if exists (select 1 from public.participants where event_id = v_e.id and wa = v_wa) then
    -- Tidak mengembalikan passport lama: tanpa OTP, itu akan membiarkan orang lain mengambil alih passport.
    return jsonb_build_object('status', 'wa_taken');
  end if;

  loop
    v_try := v_try + 1;
    begin
      insert into public.participants (event_id, code, name, wa, consent_at)
      values (v_e.id, upper(encode(extensions.gen_random_bytes(4), 'hex')), v_name, v_wa, now())
      returning token into v_token;
      exit;
    exception when unique_violation then
      if exists (select 1 from public.participants where event_id = v_e.id and wa = v_wa) then
        return jsonb_build_object('status', 'wa_taken');
      end if;
      if v_try >= 5 then raise; end if;
    end;
  end loop;

  return jsonb_build_object('status', 'ok', 'token', v_token);
end;
$$;

create or replace function public.get_passport(p_token uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'code', p.code, 'name', p.name, 'qr_code', p.qr_code, 'points', p.points, 'earned', p.earned,
    'completed', p.bonus_awarded,
    'claimed', coalesce((select jsonb_agg(c.station_id) from public.claims c where c.participant_id = p.id), '[]'::jsonb),
    'redeemed', coalesce((
      select jsonb_object_agg(x.reward_id, x.n)
      from (select reward_id, count(*) as n from public.redemptions where participant_id = p.id group by reward_id) x),
      '{}'::jsonb)
  )
  from public.participants p where p.token = p_token;
$$;

-- Klaim station kuis: peserta harus memegang rahasia dari QR yang terpasang di station dan menjawab benar.
create or replace function public.claim_quiz(p_token uuid, p_station uuid, p_secret text, p_answer integer)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_p public.participants;
  v_s public.stations;
begin
  select * into v_p from public.participants where token = p_token;
  if v_p.id is null then return jsonb_build_object('status', 'no_passport'); end if;
  select * into v_s from public.stations where id = p_station and event_id = v_p.event_id and is_active and mode = 'quiz';
  if v_s.id is null or v_s.qr_secret <> coalesce(p_secret, '') then
    return jsonb_build_object('status', 'invalid_station');
  end if;
  if not (select is_open from public.events where id = v_p.event_id) then
    return jsonb_build_object('status', 'closed');
  end if;
  if exists (select 1 from public.claims where participant_id = v_p.id and station_id = v_s.id) then
    return jsonb_build_object('status', 'already', 'station', v_s.name);
  end if;
  if p_answer is distinct from v_s.quiz_answer then
    return jsonb_build_object('status', 'wrong', 'station', v_s.name);
  end if;
  return public._award(v_p.id, v_s.id, null);
end;
$$;

-- Info station untuk halaman kuis: hanya keluar bila rahasia QR-nya cocok.
create or replace function public.station_from_qr(p_station uuid, p_secret text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'points', s.points,
                            'quiz_question', s.quiz_question, 'quiz_options', s.quiz_options)
  from public.stations s
  where s.id = p_station and s.qr_secret = coalesce(p_secret, '') and s.is_active and s.mode = 'quiz';
$$;

-- ---------------------------------------------------------------------------
-- Fungsi crew dan admin (wajib login)
-- ---------------------------------------------------------------------------

create or replace function public.staff_events()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'slug', e.slug, 'name', e.name, 'role', s.role) order by e.created_at desc), '[]'::jsonb)
  from public.event_staff s join public.events e on e.id = s.event_id
  where s.user_id = auth.uid();
$$;

create or replace function public.staff_claim(p_station uuid, p_qr text, p_checked boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_s public.stations;
  v_p public.participants;
begin
  select * into v_s from public.stations where id = p_station and is_active;
  if v_s.id is null or not public.is_staff(v_s.event_id) then return jsonb_build_object('status', 'forbidden'); end if;
  if v_s.mode <> 'crew' then return jsonb_build_object('status', 'not_crew_station'); end if;
  if v_s.requires_check and not coalesce(p_checked, false) then return jsonb_build_object('status', 'need_check'); end if;
  v_p := public._find_participant(v_s.event_id, p_qr);
  if v_p.id is null then return jsonb_build_object('status', 'not_found'); end if;
  return public._award(v_p.id, v_s.id, auth.uid());
end;
$$;

create or replace function public.staff_lookup(p_event uuid, p_qr text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_p public.participants;
begin
  if not public.is_staff(p_event) then return jsonb_build_object('status', 'forbidden'); end if;
  v_p := public._find_participant(p_event, p_qr);
  if v_p.id is null then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object(
    'status', 'ok', 'qr_code', v_p.qr_code, 'code', v_p.code, 'name', v_p.name, 'points', v_p.points,
    'completed', v_p.bonus_awarded,
    'claimed', (select count(*) from public.claims where participant_id = v_p.id),
    'redeemed', coalesce((
      select jsonb_object_agg(x.reward_id, x.n)
      from (select reward_id, count(*) as n from public.redemptions where participant_id = v_p.id group by reward_id) x),
      '{}'::jsonb));
end;
$$;

create or replace function public.staff_redeem(p_reward uuid, p_qr text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_r public.rewards;
  v_p public.participants;
  v_taken integer;
  v_left integer;
begin
  select * into v_r from public.rewards where id = p_reward and is_active;
  if v_r.id is null or not public.is_staff(v_r.event_id) then return jsonb_build_object('status', 'forbidden'); end if;
  v_p := public._find_participant(v_r.event_id, p_qr);
  if v_p.id is null then return jsonb_build_object('status', 'not_found'); end if;

  select * into v_p from public.participants where id = v_p.id for update;
  select count(*) into v_taken from public.redemptions where participant_id = v_p.id and reward_id = v_r.id;
  if v_taken >= v_r.limit_per_person then
    return jsonb_build_object('status', 'limit', 'name', v_p.name, 'reward', v_r.name, 'limit', v_r.limit_per_person);
  end if;
  if v_p.points < v_r.cost then
    return jsonb_build_object('status', 'not_enough', 'name', v_p.name, 'reward', v_r.name, 'balance', v_p.points, 'cost', v_r.cost);
  end if;

  update public.rewards set stock_remaining = stock_remaining - 1
   where id = v_r.id and stock_remaining > 0
   returning stock_remaining into v_left;
  if v_left is null then
    return jsonb_build_object('status', 'out_of_stock', 'reward', v_r.name);
  end if;

  update public.participants set points = points - v_r.cost where id = v_p.id returning * into v_p;
  insert into public.redemptions (event_id, participant_id, reward_id, cost, staff_id)
  values (v_r.event_id, v_p.id, v_r.id, v_r.cost, auth.uid());

  return jsonb_build_object('status', 'ok', 'name', v_p.name, 'reward', v_r.name, 'balance', v_p.points, 'stock_remaining', v_left);
end;
$$;

-- Ringkasan untuk dashboard.
create or replace function public.event_stats(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_min integer;
begin
  if not public.is_staff(p_event) then return jsonb_build_object('status', 'forbidden'); end if;
  select min(cost) into v_min from public.rewards where event_id = p_event and is_active;
  return jsonb_build_object(
    'status', 'ok',
    'participants', (select count(*) from public.participants where event_id = p_event),
    'active', (select count(distinct participant_id) from public.claims where event_id = p_event),
    'eligible', (select count(*) from public.participants where event_id = p_event and earned >= coalesce(v_min, 0) and v_min is not null),
    'redeemers', (select count(distinct participant_id) from public.redemptions where event_id = p_event),
    'completed', (select count(*) from public.participants where event_id = p_event and bonus_awarded),
    'claims', (select count(*) from public.claims where event_id = p_event),
    'avg_earned', (select coalesce(round(avg(earned)), 0) from public.participants where event_id = p_event),
    'stations', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name,
               'claims', (select count(*) from public.claims c where c.station_id = s.id)) order by s.sort, s.created_at)
      from public.stations s where s.event_id = p_event and s.is_active), '[]'::jsonb),
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'stock_initial', r.stock_initial,
               'stock_remaining', r.stock_remaining) order by r.sort, r.cost)
      from public.rewards r where r.event_id = p_event and r.is_active), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Hak akses fungsi
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.public_event(text)                               to anon, authenticated;
grant execute on function public.register_participant(text, text, text, boolean)  to anon, authenticated;
grant execute on function public.get_passport(uuid)                               to anon, authenticated;
grant execute on function public.claim_quiz(uuid, uuid, text, integer)            to anon, authenticated;
grant execute on function public.station_from_qr(uuid, text)                      to anon, authenticated;

grant execute on function public.is_staff(uuid, boolean)          to authenticated;
grant execute on function public.staff_events()                   to authenticated;
grant execute on function public.staff_claim(uuid, text, boolean) to authenticated;
grant execute on function public.staff_lookup(uuid, text)         to authenticated;
grant execute on function public.staff_redeem(uuid, text)         to authenticated;
grant execute on function public.event_stats(uuid)                to authenticated;
-- _award dan _find_participant sengaja tidak diberikan ke siapa pun: hanya dipanggil dari fungsi lain.
