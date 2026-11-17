-- JUARA Audience Engagement Passport
-- Tempat menyimpan logo, poster, dan foto hadiah. Jalankan SETELAH 002-admin.sql, satu kali.
-- Gambar bisa dilihat siapa saja (memang untuk tampil di aplikasi), tapi hanya admin event yang bisa mengunggah.
-- Berkas disimpan di folder bernama id event: <id event>/<nama berkas>.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-assets', 'event-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

create policy "event assets: admin upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'event-assets' and public.is_staff(((storage.foldername(name))[1])::uuid, true));

create policy "event assets: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'event-assets' and public.is_staff(((storage.foldername(name))[1])::uuid, true));
