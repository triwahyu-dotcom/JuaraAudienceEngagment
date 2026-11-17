-- Data contoh: event Rockets Rollers dengan 6 station dan 3 hadiah.
-- Jalankan SETELAH schema.sql. Angka dan nama di sini contoh, silakan ubah.

with e as (
  insert into public.events (slug, name, accent_color, bonus_points)
  values ('rockets-rollers', 'Rockets Rollers', '#1F31AB', 20)
  returning id
), s as (
  insert into public.stations (event_id, name, mode, points, sort, requires_check, quiz_question, quiz_options, quiz_answer)
  select e.id, v.name, v.mode, v.points, v.sort, v.requires_check, v.q, v.opts, v.ans
  from e, (values
    ('Photo spot',          'quiz', 10, 1, false, 'Apa nama event ini?', array['Roller Fest', 'Rockets Rollers', 'Skate Day'], 1),
    ('Kuis brand',          'quiz', 10, 2, false, 'Ada berapa station di passport ini?', array['4', '6', '8'], 1),
    ('Game 1: Slalom cone', 'crew', 20, 3, false, null, null, null),
    ('Game 2: Speed lap',   'crew', 20, 4, false, null, null, null),
    ('Coba roller skate',   'crew', 20, 5, false, null, null, null),
    ('Post Instagram',      'crew', 30, 6, true,  null, null, null)
  ) as v(name, mode, points, sort, requires_check, q, opts, ans)
  returning 1
)
insert into public.rewards (event_id, name, description, cost, stock_initial, stock_remaining, limit_per_person, sort)
select e.id, v.name, v.description, v.cost, v.stock, v.stock, v.lim, v.sort
from e, (values
  ('Stiker',  'Stiker pack isi 3 desain event. Tahan air, cocok untuk helm dan botol minum.',          30, 320, 2, 1),
  ('Totebag', 'Totebag kanvas dengan sablon logo event. Ukuran 35 x 40 cm.',                           60, 240, 1, 2),
  ('Kaos',    'Kaos event edisi terbatas, katun combed 30s. Ukuran M, L, dan XL selama stok ada.',    100, 160, 1, 3)
) as v(name, description, cost, stock, lim, sort);
