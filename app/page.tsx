'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { configured, rpc } from '@/lib/supabase';
import { eventSlug, getToken, prettyCode, setToken, type EventData, type FlashMsg, type Passport, type Reward } from '@/lib/types';
import { Flash, NotConfigured, RewardPic, Shell } from '@/lib/ui';
import { cacheGet, cacheSet } from '@/lib/offline';

type Cached = { event: EventData; passport: Passport | null } | null;

const REGISTER_ERRORS: Record<string, { text: string; sub: string }> = {
  wa_taken: { text: 'Nomor sudah terdaftar', sub: 'Satu nomor hanya untuk satu passport. Bila passport Anda hilang, minta bantuan crew di booth informasi.' },
  invalid: { text: 'Data belum lengkap', sub: 'Isi nama dan nomor WhatsApp 9 sampai 15 angka.' },
  no_consent: { text: 'Persetujuan belum dicentang', sub: 'Centang persetujuan penggunaan data untuk melanjutkan.' },
  closed: { text: 'Pendaftaran ditutup', sub: 'Event ini sudah tidak menerima passport baru.' },
  no_event: { text: 'Event tidak ditemukan', sub: 'Scan ulang QR di gate.' },
};

export default function ParticipantPage() {
  const [slug, setSlug] = useState('');
  const [event, setEvent] = useState<EventData | null>(null);
  const [passport, setPassport] = useState<Passport | null>(null);
  const [qr, setQr] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [flash, setFlash] = useState<FlashMsg>(null);
  const [detail, setDetail] = useState<Reward | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async (s: string) => {
    const ev = await rpc<EventData | null>('public_event', { p_slug: s });
    if (!ev) { setState('missing'); return; }
    setEvent(ev);
    const token = getToken(s);
    let p: Passport | null = null;
    if (token) {
      p = await rpc<Passport | null>('get_passport', { p_token: token });
      if (p) setPassport(p); else { setToken(s, null); setPassport(null); }
    }
    cacheSet('jp:cache:' + s, { event: ev, passport: p });
    setOffline(false);
    setState('ready');
  }, []);

  useEffect(() => {
    if (!configured) return;
    const s = eventSlug();
    setSlug(s);
    try { setPending(sessionStorage.getItem('jp:pending')); } catch {}
    // Tampilkan data terakhir yang tersimpan lebih dulu, supaya QR passport muncul walau sinyal hilang.
    const cached = cacheGet<Cached>('jp:cache:' + s, null);
    if (cached && cached.event) {
      setEvent(cached.event);
      if (cached.passport && getToken(s)) setPassport(cached.passport);
      setState('ready');
    }
    const failed = () => { if (cached && cached.event) setOffline(true); else setState('error'); };
    refresh(s).catch(failed);
    // Poin dari crew masuk tanpa perlu memuat ulang halaman.
    const tick = () => { if (document.visibilityState === 'visible') refresh(s).catch(() => setOffline(true)); };
    const timer = window.setInterval(tick, 15000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [refresh]);

  useEffect(() => {
    if (!passport) { setQr(''); return; }
    QRCode.toDataURL(passport.qr_code, { margin: 1, width: 336, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
  }, [passport?.qr_code]); // eslint-disable-line react-hooks/exhaustive-deps

  async function register(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await rpc<{ status: string; token?: string }>('register_participant', {
        p_slug: slug, p_name: String(f.get('name') || ''), p_wa: String(f.get('wa') || ''), p_consent: f.get('consent') === 'on',
      });
      if (res.status === 'ok' && res.token) {
        setToken(slug, res.token);
        setFlash({ type: 'good', text: 'Passport aktif', sub: 'Kunjungi station untuk mengumpulkan poin.' });
        await refresh(slug);
      } else {
        const m = REGISTER_ERRORS[res.status] || { text: 'Pendaftaran gagal', sub: 'Coba lagi sebentar lagi.' };
        setFlash({ type: 'bad', ...m });
      }
    } catch {
      setFlash({ type: 'bad', text: 'Tidak bisa terhubung', sub: 'Periksa koneksi internet lalu coba lagi.' });
    } finally { setBusy(false); }
  }

  if (!configured) return <Shell event={null} tag="Passport"><NotConfigured /></Shell>;
  if (state === 'loading') return <Shell event={null} tag="Passport"><p className="note">Memuat passport…</p></Shell>;
  if (state === 'missing') return <Shell event={null} tag="Passport"><section className="card"><h2>Event tidak ditemukan</h2><p className="note">Alamat ini tidak cocok dengan event mana pun. Scan ulang QR di gate.</p></section></Shell>;
  if (state === 'error' || !event) return <Shell event={null} tag="Passport"><section className="card"><h2>Tidak bisa memuat event</h2><p className="note">Periksa koneksi internet, lalu muat ulang halaman.</p></section></Shell>;

  if (!passport) {
    return (
      <Shell event={event} tag="Passport">
        {event.poster_url
          ? <img className="poster" src={event.poster_url} alt={'Poster ' + event.name} />
          : <div className="poster ph"><b>{event.name}</b></div>}
        <section className="card">
          <h2>Buat passport digital</h2>
          <p className="note">Kumpulkan poin di tiap station, lalu tukar dengan merchandise.</p>
          <form className="stack" onSubmit={register}>
            <label htmlFor="reg-name">Nama<input type="text" id="reg-name" name="name" autoComplete="name" required maxLength={40} /></label>
            <label htmlFor="reg-wa">Nomor WhatsApp<input type="tel" id="reg-wa" name="wa" inputMode="numeric" required maxLength={18} placeholder="08xxxxxxxxxx" /></label>
            <label className="check" htmlFor="reg-ok"><input type="checkbox" id="reg-ok" name="consent" required /><span>Saya setuju nama dan nomor WhatsApp saya dipakai untuk program poin event ini.</span></label>
            <Flash msg={flash} />
            <button type="submit" disabled={busy || !event.is_open}>{busy ? 'Memproses…' : 'Aktifkan passport'}</button>
          </form>
        </section>
      </Shell>
    );
  }

  const done = event.stations.filter((s) => passport.claimed.includes(s.id)).length;
  const total = event.stations.length;
  const status = (r: Reward) => {
    if (r.stock_remaining <= 0) return <span className="pill warn">Habis</span>;
    if ((passport.redeemed[r.id] || 0) >= r.limit_per_person) return <span className="pill">Sudah ditukar</span>;
    if (passport.points >= r.cost) return <span className="pill good">Bisa ditukar</span>;
    return <span className="pill">Kurang {r.cost - passport.points}</span>;
  };

  return (
    <Shell event={event} tag="Passport">
      <section className="card pass">
        <div className="qr">{qr ? <img src={qr} alt="QR passport Anda" /> : null}</div>
        <div className="who">
          <span className="name">{passport.name}</span>
          <span className="code">{prettyCode(passport.code)}</span>
          <span className="pts">{passport.points}<small>poin</small></span>
        </div>
      </section>
      {offline ? <Flash msg={{ type: 'warn', text: 'Sedang offline', sub: 'QR passport tetap bisa di-scan crew. Poin diperbarui saat koneksi kembali.' }} /> : null}
      <Flash msg={flash} />
      {pending ? <a className="btn" href={pending} onClick={() => { try { sessionStorage.removeItem('jp:pending'); } catch {} }}>Lanjutkan kuis station yang tadi di-scan</a> : null}

      <section className="card">
        <h2>Station <span className="num">{done}/{total}</span></h2>
        <div className="progress"><i style={{ width: (total ? (done / total) * 100 : 0) + '%' }} /></div>
        <div>
          {event.stations.map((s) => (
            <div className="row" key={s.id}>
              <div className="grow">
                <div className="t">{s.name}</div>
                <div className="s">{s.mode === 'quiz' ? 'Scan QR di station, jawab kuis' : 'Tunjukkan QR passport ke crew'} · <span className="num">{s.points}</span> poin</div>
              </div>
              {passport.claimed.includes(s.id) ? <span className="pill good">Selesai</span> : <span className="pill">Belum</span>}
            </div>
          ))}
          <div className="row">
            <div className="grow"><div className="t">Bonus semua station</div><div className="s">Otomatis · <span className="num">{event.bonus_points}</span> poin dan masuk undian</div></div>
            {passport.completed ? <span className="pill good">Dapat</span> : <span className="pill">Belum</span>}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Katalog hadiah</h2>
        <div>
          {event.rewards.map((r) => (
            <div className="row" key={r.id}>
              <button className="rowbtn" onClick={() => setDetail(r)}>
                <RewardPic reward={r} className="thumb" />
                <span className="grow"><span className="t">{r.name}</span><br /><span className="s"><span className="num">{r.cost}</span> poin · <u>Lihat detail</u></span></span>
              </button>
              {status(r)}
            </div>
          ))}
        </div>
      </section>
      <p className="note">Passport ini tersimpan di browser HP Anda. Jangan hapus data browser sampai event selesai.</p>

      {detail ? (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
          <section className="card sheet" role="dialog" aria-modal="true" aria-labelledby="dt-title">
            <RewardPic reward={detail} className="photo" />
            <h2 id="dt-title">{detail.name}</h2>
            <div className="facts">
              <span className="pill"><span className="num">{detail.cost}</span> poin</span>
              {status(detail)}
              <span className="note">Sisa stok <span className="num">{Math.max(detail.stock_remaining, 0)}</span></span>
            </div>
            <p>{detail.description || 'Belum ada deskripsi.'}</p>
            <p className="note">Tukar di booth redemption dengan menunjukkan QR passport Anda. Maksimal {detail.limit_per_person} per orang.</p>
            <button onClick={() => setDetail(null)}>Tutup</button>
          </section>
        </div>
      ) : null}
    </Shell>
  );
}
