# JUARA Audience Engagement Passport

Passport digital untuk event: penonton scan QR di gate, mengumpulkan poin di tiap station, lalu menukarnya dengan merchandise.

Aplikasi ini berupa halaman statis (Next.js static export) yang berbicara langsung ke Supabase. Tidak ada server sendiri, sehingga bisa berjalan di paket gratis Supabase dan Cloudflare Pages.

## Halaman

| Alamat | Untuk siapa | Isi |
|---|---|---|
| `/?e=<slug event>` | Peserta | Daftar, passport dengan QR, daftar station, katalog hadiah |
| `/s/?e=..&s=..&k=..` | Peserta | Kuis station, terbuka saat scan QR yang terpasang di station |
| `/crew/` | Crew dan admin | Login, scan passport untuk memberi poin, booth redemption, dashboard |

## 1. Siapkan database (sekali saja)

1. Buka proyek di Supabase, masuk ke **SQL Editor > New query**.
2. Tempel seluruh isi `supabase/schema.sql`, klik **Run**.
3. Tempel isi `supabase/seed.sql`, klik **Run**. Ini membuat event contoh `rockets-rollers` dengan 6 station dan 3 hadiah.

## 2. Buat akun crew

1. Di Supabase buka **Authentication > Users > Add user**. Isi email dan kata sandi, centang **Auto Confirm User**.
2. Daftarkan akun itu ke event lewat SQL Editor (ganti emailnya):

```sql
insert into public.event_staff (event_id, user_id, role)
select e.id, u.id, 'admin'          -- 'admin' atau 'crew'
from public.events e, auth.users u
where e.slug = 'rockets-rollers' and u.email = 'crew@contoh.id';
```

Satu akun bersama untuk semua crew sudah cukup untuk uji coba. Untuk event sungguhan, buat satu akun per station supaya tercatat siapa memberi poin.

Disarankan mematikan pendaftaran mandiri: **Authentication > Sign In / Providers > Email**, nonaktifkan "Allow new users to sign up". Akun tanpa baris di `event_staff` memang tidak bisa berbuat apa-apa, tapi lebih rapi bila tertutup.

## 3. Hubungkan aplikasi ke Supabase

Salin `.env.example` menjadi `.env.local`, lalu isi `NEXT_PUBLIC_SUPABASE_ANON_KEY` dengan **anon public key** dari **Project Settings > API**.

Jangan pernah memakai `service_role key` di aplikasi ini.

## 4. Jalankan di komputer

```bash
npm install
npm run dev
```

Buka `http://localhost:3000/?e=rockets-rollers`. Kamera crew butuh HTTPS atau `localhost`.

## 5. Tayangkan gratis di Cloudflare Pages

1. Di Cloudflare buka **Workers & Pages > Create > Pages > Connect to Git**, pilih repo ini.
2. Build command: `npm run build`. Output directory: `out`.
3. Tambahkan environment variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, dan `NEXT_PUBLIC_DEFAULT_EVENT`.
4. Deploy. Alamatnya berakhiran `.pages.dev`.

## 6. QR yang perlu dicetak

- **QR gate:** arahkan ke `https://<domain>/?e=rockets-rollers`.
- **QR station kuis:** tiap station punya rahasia sendiri. Ambil alamatnya lewat SQL Editor (ganti domainnya), lalu ubah jadi QR dengan pembuat QR mana pun:

```sql
select s.name,
       'https://DOMAIN-ANDA/s/?e=' || e.slug || '&s=' || s.id || '&k=' || s.qr_secret as alamat_qr
from public.stations s join public.events e on e.id = s.event_id
where e.slug = 'rockets-rollers' and s.mode = 'quiz';
```

Station dengan validasi crew tidak butuh QR cetak: crew yang scan passport peserta.

## Cara kerja keamanan

- Semua tabel memakai Row Level Security. Peserta tidak bisa membaca tabel apa pun secara langsung.
- Peserta dikenali lewat token rahasia yang tersimpan di browser HP-nya. QR passport berisi kode lain yang hanya berguna bagi crew yang sudah login.
- Poin, bonus, stok, dan batas tukar dihitung di database (fungsi di `schema.sql`), jadi tidak bisa diubah dari browser.
- Satu nomor WhatsApp hanya untuk satu passport per event. Tanpa OTP, nomor tidak diverifikasi.

## Batasan saat ini

- Membuat event, station, dan hadiah masih lewat SQL (`seed.sql` sebagai contoh). Halaman admin belum ada.
- Unggah logo, poster, dan foto hadiah belum ada. Kolom `logo_url`, `poster_url`, dan `photo_url` bisa diisi alamat gambar secara manual.
- Peserta yang menghapus data browser kehilangan passportnya. Pemulihan lewat crew belum ada.
- Undian, leaderboard, QR berputar, dan mode offline belum ada.
- Paket gratis Supabase menjeda proyek setelah satu minggu tanpa aktivitas. Buka dashboard Supabase sebelum event untuk mengaktifkannya lagi.
