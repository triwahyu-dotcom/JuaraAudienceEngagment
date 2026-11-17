# JUARA Audience Engagement Passport

Passport digital untuk event: penonton scan QR di gate, mengumpulkan poin di tiap station, lalu menukarnya dengan merchandise.

Aplikasi ini berupa halaman statis (Next.js static export) yang berbicara langsung ke Supabase. Tidak ada server sendiri, sehingga bisa berjalan di paket gratis Supabase dan Cloudflare Pages.

## Halaman

| Alamat | Untuk siapa | Isi |
|---|---|---|
| `/?e=<slug event>` | Peserta | Daftar, passport dengan QR, daftar station, katalog hadiah |
| `/s/?e=..&s=..&k=..` | Peserta | Kuis station, terbuka saat scan QR yang terpasang di station |
| `/crew/` | Crew dan admin | Login, scan passport untuk memberi poin, booth redemption, dashboard |
| `/admin/` | Admin | Membuat event, mengatur station dan hadiah, unggah gambar, QR cetak, tim, unduh data peserta |

## 1. Siapkan database (sekali saja)

1. Buka proyek di Supabase, masuk ke **SQL Editor > New query**.
2. Tempel seluruh isi `supabase/schema.sql`, klik **Run**.
3. Tempel isi `supabase/seed.sql`, klik **Run**. Ini membuat event contoh `rockets-rollers` dengan 6 station dan 3 hadiah.
4. Tempel isi `supabase/002-admin.sql`, klik **Run**. Ini menambah fungsi untuk panel admin.
5. Tempel isi `supabase/003-storage.sql`, klik **Run**. Ini membuat tempat penyimpanan logo, poster, dan foto hadiah.

Masing-masing file cukup dijalankan satu kali. Bila database sudah terpasang sebelumnya, jalankan hanya file yang belum pernah dijalankan.

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

Untuk build produksi, alamat proyek dan publishable key sudah ada di `.env.production`, jadi tidak ada yang perlu diisi.

Untuk menjalankan di komputer (`npm run dev`), salin `.env.production` menjadi `.env.local`. Bila pindah proyek Supabase, ganti nilainya dengan Project URL dan **publishable key** (atau anon public key) dari **Project Settings > API Keys**.

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
3. Deploy. Environment variables tidak perlu diisi karena sudah ada di `.env.production`.

Tanpa GitHub: jalankan `npm run build`, lalu di Cloudflare pilih **Pages > Upload assets** dan unggah isi folder `out`. Alamatnya berakhiran `.pages.dev`.

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

## Panel admin

Buka `/admin/` dan login dengan akun berperan `admin`. Akun admin pertama ditugaskan lewat SQL di langkah 2; setelah itu semuanya bisa dari panel.

- **Event:** nama, warna, bonus, logo, poster, dan buka/tutup event. Tombol "Event baru" membuat event lain di situs yang sama.
- **Station:** tambah, ubah, urutkan, nonaktifkan. Station yang sudah punya klaim tidak bisa dihapus, hanya dinonaktifkan.
- **Hadiah:** harga, stok, batas per orang, deskripsi, foto. Mengubah stok awal menggeser sisa stok sebesar selisihnya.
- **QR:** QR gate dan QR tiap station kuis, siap diunduh sebagai PNG. Link mengikuti alamat situs tempat panel dibuka, jadi unduh QR dari situs yang sudah tayang, bukan dari localhost.
- **Tim:** menugaskan atau mencabut akun crew dan admin. Akunnya sendiri tetap dibuat di Supabase (Authentication > Users).
- **Peserta:** unduh data peserta sebagai CSV.

## Cara kerja keamanan

- Semua tabel memakai Row Level Security. Peserta tidak bisa membaca tabel apa pun secara langsung.
- Peserta dikenali lewat token rahasia yang tersimpan di browser HP-nya. QR passport berisi kode lain yang hanya berguna bagi crew yang sudah login.
- Poin, bonus, stok, dan batas tukar dihitung di database (fungsi di `schema.sql`), jadi tidak bisa diubah dari browser.
- Satu nomor WhatsApp hanya untuk satu passport per event. Tanpa OTP, nomor tidak diverifikasi.

## Saat koneksi lambat atau putus

- **Passport peserta tetap terbuka.** Halaman dan data terakhir tersimpan di HP, jadi QR passport tetap bisa ditunjukkan ke crew. Poin diperbarui saat koneksi kembali.
- **Scan crew di station masuk antrean.** Scan yang tidak sampai ke server disimpan di HP crew dan dikirim otomatis saat koneksi kembali (atau lewat tombol "Kirim sekarang"). Aman dikirim ulang karena server hanya menerima satu klaim per peserta per station. Poin peserta baru masuk setelah antrean terkirim.
- **Penukaran hadiah sengaja tetap butuh koneksi**, karena saldo dan stok harus dicek langsung.
- **Pendaftaran dan station kuis butuh koneksi.**
- Antrean tersimpan di browser HP crew. Jangan hapus data browser sebelum antrean kosong. QR yang di-scan saat offline belum divalidasi; yang bukan passport event akan tercatat "ditolak" saat dikirim.
- Halaman baru tersimpan untuk offline setelah dibuka satu kali dalam keadaan online. Minta crew membuka `/crew/` dan login sebelum gate dibuka.

## Batasan saat ini

- Akun crew baru masih dibuat di dashboard Supabase; panel admin hanya menugaskannya ke event.
- Peserta yang menghapus data browser kehilangan passportnya. Pemulihan lewat crew belum ada.
- Undian, leaderboard, dan QR berputar belum ada.
- Paket gratis Supabase menjeda proyek setelah satu minggu tanpa aktivitas. Buka dashboard Supabase sebelum event untuk mengaktifkannya lagi.
