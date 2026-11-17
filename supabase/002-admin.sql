-- JUARA Audience Engagement Passport
-- Tambahan untuk panel admin. Jalankan SETELAH schema.sql, satu kali, di SQL Editor.
-- Semua fungsi di sini hanya bisa dipanggil akun yang login dan berperan admin di event terkait.

-- Membuat event baru. Hanya untuk akun yang sudah menjadi admin di minimal satu event.
create or replace function public.admin_create_event(p_slug text, p_name text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_slug text := lower(trim(coalesce(p_slug, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_id uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.event_staff where user_id = auth.uid() and role = 'admin') then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if v_slug !~ '^[a-z0-9-]{3,40}$' or char_length(v_name) < 1 or char_length(v_name) > 60 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if exists (select 1 from public.events where slug = v_slug) then
    return jsonb_build_object('status', 'slug_taken');
  end if;
  insert into public.events (slug, name) values (v_slug, v_name) returning id into v_id;
  insert into public.event_staff (event_id, user_id, role) values (v_id, auth.uid(), 'admin');
  return jsonb_build_object('status', 'ok', 'id', v_id, 'slug', v_slug);
end;
$$;

-- Mengubah stok awal sebuah hadiah. Sisa stok ikut bergeser sebesar selisihnya,
-- sehingga hadiah yang sudah keluar tetap terhitung.
create or replace function public.admin_set_stock(p_reward uuid, p_initial integer)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_r public.rewards;
begin
  select * into v_r from public.rewards where id = p_reward for update;
  if v_r.id is null or not public.is_staff(v_r.event_id, true) then return jsonb_build_object('status', 'forbidden'); end if;
  if p_initial is null or p_initial < 0 then return jsonb_build_object('status', 'invalid'); end if;
  update public.rewards
     set stock_remaining = greatest(0, stock_remaining + (p_initial - stock_initial)),
         stock_initial = p_initial
   where id = v_r.id
   returning * into v_r;
  return jsonb_build_object('status', 'ok', 'stock_initial', v_r.stock_initial, 'stock_remaining', v_r.stock_remaining);
end;
$$;

-- Menghapus station hanya bila belum ada klaim. Kalau sudah ada, nonaktifkan saja supaya riwayat tidak hilang.
create or replace function public.admin_delete_station(p_station uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_event uuid;
begin
  select event_id into v_event from public.stations where id = p_station;
  if v_event is null or not public.is_staff(v_event, true) then return jsonb_build_object('status', 'forbidden'); end if;
  if exists (select 1 from public.claims where station_id = p_station) then return jsonb_build_object('status', 'in_use'); end if;
  delete from public.stations where id = p_station;
  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.admin_delete_reward(p_reward uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_event uuid;
begin
  select event_id into v_event from public.rewards where id = p_reward;
  if v_event is null or not public.is_staff(v_event, true) then return jsonb_build_object('status', 'forbidden'); end if;
  if exists (select 1 from public.redemptions where reward_id = p_reward) then return jsonb_build_object('status', 'in_use'); end if;
  delete from public.rewards where id = p_reward;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Daftar akun crew dan admin sebuah event.
create or replace function public.admin_staff_list(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff(p_event, true) then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object('status', 'ok', 'staff', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'email', u.email, 'role', s.role, 'me', s.user_id = auth.uid()) order by s.role, u.email)
    from public.event_staff s join auth.users u on u.id = s.user_id
    where s.event_id = p_event), '[]'::jsonb));
end;
$$;

-- Menambah, mengubah peran, atau mencabut akun dari sebuah event. p_role: 'admin', 'crew', atau null untuk mencabut.
-- Akunnya harus sudah dibuat lebih dulu di Supabase (Authentication > Users).
create or replace function public.admin_staff_set(p_event uuid, p_email text, p_role text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.is_staff(p_event, true) then return jsonb_build_object('status', 'forbidden'); end if;
  if p_role is not null and p_role not in ('admin', 'crew') then return jsonb_build_object('status', 'invalid'); end if;
  select id into v_user from auth.users where lower(email) = lower(trim(coalesce(p_email, ''))) limit 1;
  if v_user is null then return jsonb_build_object('status', 'no_account'); end if;
  if v_user = auth.uid() and p_role is distinct from 'admin' then
    return jsonb_build_object('status', 'self');  -- mencegah admin mengunci dirinya sendiri
  end if;
  if p_role is null then
    delete from public.event_staff where event_id = p_event and user_id = v_user;
  else
    insert into public.event_staff (event_id, user_id, role) values (p_event, v_user, p_role)
    on conflict (event_id, user_id) do update set role = excluded.role;
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Data peserta untuk diunduh sebagai laporan. Token rahasia passport tidak ikut.
create or replace function public.admin_participants(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff(p_event, true) then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object('status', 'ok', 'participants', coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', p.code, 'name', p.name, 'wa', p.wa, 'points', p.points, 'earned', p.earned, 'completed', p.bonus_awarded,
      'stations', (select count(*) from public.claims c where c.participant_id = p.id),
      'redemptions', (select count(*) from public.redemptions r where r.participant_id = p.id),
      'registered_at', p.created_at) order by p.created_at)
    from public.participants p where p.event_id = p_event), '[]'::jsonb));
end;
$$;

revoke execute on function public.admin_create_event(text, text)        from public, anon;
revoke execute on function public.admin_set_stock(uuid, integer)        from public, anon;
revoke execute on function public.admin_delete_station(uuid)            from public, anon;
revoke execute on function public.admin_delete_reward(uuid)             from public, anon;
revoke execute on function public.admin_staff_list(uuid)                from public, anon;
revoke execute on function public.admin_staff_set(uuid, text, text)     from public, anon;
revoke execute on function public.admin_participants(uuid)              from public, anon;

grant execute on function public.admin_create_event(text, text)        to authenticated;
grant execute on function public.admin_set_stock(uuid, integer)        to authenticated;
grant execute on function public.admin_delete_station(uuid)            to authenticated;
grant execute on function public.admin_delete_reward(uuid)             to authenticated;
grant execute on function public.admin_staff_list(uuid)                to authenticated;
grant execute on function public.admin_staff_set(uuid, text, text)     to authenticated;
grant execute on function public.admin_participants(uuid)              to authenticated;
