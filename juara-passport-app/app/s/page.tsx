'use client';

// Halaman yang terbuka saat peserta scan QR yang terpasang di station kuis.
// Alamatnya: /s/?e=<slug event>&s=<id station>&k=<rahasia QR station>

import { useEffect, useState } from 'react';
import { configured, rpc } from '@/lib/supabase';
import { getToken, type EventData, type FlashMsg } from '@/lib/types';
import { Flash, NotConfigured, Shell } from '@/lib/ui';

type QuizStation = { id: string; name: string; points: number; quiz_question: string; quiz_options: string[] };

export default function StationPage() {
  const [event, setEvent] = useState<EventData | null>(null);
  const [station, setStation] = useState<QuizStation | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'no_passport' | 'done' | 'error'>('loading');
  const [flash, setFlash] = useState<FlashMsg>(null);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useState({ slug: '', id: '', secret: '', token: '' });

  useEffect(() => {
    if (!configured) return;
    const q = new URLSearchParams(window.location.search);
    const slug = (q.get('e') || '').toLowerCase(), id = q.get('s') || '', secret = q.get('k') || '';
    const token = getToken(slug) || '';
    setParams({ slug, id, secret, token });
    (async () => {
      const ev = await rpc<EventData | null>('public_event', { p_slug: slug });
      if (ev) setEvent(ev);
      const st = /^[0-9a-f-]{36}$/i.test(id) ? await rpc<QuizStation | null>('station_from_qr', { p_station: id, p_secret: secret }) : null;
      if (!ev || !st) { setState('invalid'); return; }
      setStation(st);
      if (!token) {
        try { sessionStorage.setItem('jp:pending', window.location.pathname + window.location.search); } catch {}
        setState('no_passport');
        return;
      }
      setState('ready');
    })().catch(() => setState('error'));
  }, []);

  async function answer(i: number) {
    setBusy(true);
    try {
      const res = await rpc<any>('claim_quiz', { p_token: params.token, p_station: params.id, p_secret: params.secret, p_answer: i });
      if (res.status === 'ok') {
        setFlash({ type: 'good', text: 'Benar, +' + res.points + ' poin', sub: (res.bonus ? 'Semua station selesai: bonus ' + res.bonus + ' poin dan Anda masuk undian. ' : '') + 'Saldo Anda sekarang ' + res.balance + ' poin.' });
        setState('done');
      } else if (res.status === 'already') {
        setFlash({ type: 'warn', text: 'Station ini sudah selesai', sub: 'Poin station hanya bisa diklaim satu kali.' });
        setState('done');
      } else if (res.status === 'wrong') {
        setFlash({ type: 'bad', text: 'Jawaban belum tepat', sub: 'Coba lagi, jawabannya ada di station.' });
      } else if (res.status === 'no_passport') {
        setState('no_passport');
      } else if (res.status === 'closed') {
        setFlash({ type: 'warn', text: 'Event sudah ditutup', sub: 'Poin tidak lagi bisa diklaim.' });
      } else {
        setState('invalid');
      }
    } catch {
      setFlash({ type: 'bad', text: 'Tidak bisa terhubung', sub: 'Periksa koneksi internet lalu coba lagi.' });
    } finally { setBusy(false); }
  }

  const home = '/?e=' + encodeURIComponent(params.slug);
  if (!configured) return <Shell event={null} tag="Station"><NotConfigured /></Shell>;

  return (
    <Shell event={event} tag="Station">
      {state === 'loading' ? <p className="note">Memuat station…</p> : null}
      {state === 'error' ? <section className="card"><h2>Tidak bisa memuat station</h2><p className="note">Periksa koneksi internet, lalu scan ulang QR station.</p></section> : null}
      {state === 'invalid' ? <section className="card"><h2>QR station tidak dikenali</h2><p className="note">Scan ulang QR yang terpasang di station, atau tanyakan ke crew.</p><a className="btn ghost" href={home}>Buka passport</a></section> : null}
      {state === 'no_passport' ? (
        <section className="card">
          <h2>Buat passport dulu</h2>
          <p className="note">Anda perlu passport digital untuk mengumpulkan poin di {station ? station.name : 'station ini'}. Setelah passport aktif, Anda bisa langsung melanjutkan kuis ini.</p>
          <a className="btn" href={home}>Buat passport</a>
        </section>
      ) : null}
      {station && (state === 'ready' || state === 'done') ? (
        <section className="card">
          <h2>{station.name} <span className="pill"><span className="num">{station.points}</span> poin</span></h2>
          {state === 'ready' ? (
            <>
              <p style={{ margin: 0, fontWeight: 600 }}>{station.quiz_question}</p>
              <div className="opts">
                {station.quiz_options.map((o, i) => <button key={i} className="ghost" disabled={busy} onClick={() => answer(i)}>{o}</button>)}
              </div>
            </>
          ) : null}
          <Flash msg={flash} />
          {state === 'done' ? <a className="btn" href={home}>Kembali ke passport</a> : null}
        </section>
      ) : null}
    </Shell>
  );
}
