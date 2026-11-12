'use client';

// Halaman crew: login, lalu scan QR passport peserta untuk memberi poin station atau menukar hadiah.

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { configured, rpc, supabase } from '@/lib/supabase';
import { prettyCode, type EventData, type FlashMsg } from '@/lib/types';
import { Flash, NotConfigured, RewardPic, Shell } from '@/lib/ui';

type StaffEvent = { id: string; slug: string; name: string; role: 'admin' | 'crew' };
type Found = { qr_code: string; code: string; name: string; points: number; completed: boolean; claimed: number; redeemed: Record<string, number> };
type Stats = {
  participants: number; active: number; eligible: number; redeemers: number; completed: number; claims: number; avg_earned: number;
  stations: { id: string; name: string; claims: number }[];
  rewards: { id: string; name: string; stock_initial: number; stock_remaining: number }[];
};

function Scanner({ onScan }: { onScan: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const cb = useRef(onScan);
  cb.current = onScan;
  const [error, setError] = useState('');

  useEffect(() => {
    let scanner: any = null, stopped = false, last = '', lastAt = 0;
    import('qr-scanner').then(({ default: QrScanner }) => {
      if (stopped || !video.current) return;
      scanner = new QrScanner(video.current, (r: { data: string }) => {
        const now = Date.now();
        if (r.data === last && now - lastAt < 4000) return; // QR yang sama tidak diproses berulang
        last = r.data; lastAt = now;
        cb.current(r.data);
      }, { preferredCamera: 'environment', highlightScanRegion: true, maxScansPerSecond: 5 });
      scanner.start().catch(() => setError('Kamera tidak bisa dibuka. Izinkan akses kamera di browser, atau ketik kode passport di bawah.'));
    });
    return () => { stopped = true; if (scanner) { scanner.stop(); scanner.destroy(); } };
  }, []);

  return (
    <>
      <div className="cam"><video ref={video} muted playsInline /></div>
      {error ? <p className="note">{error}</p> : null}
    </>
  );
}

export default function CrewPage() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [events, setEvents] = useState<StaffEvent[] | null>(null);
  const [eventId, setEventId] = useState('');
  const [event, setEvent] = useState<EventData | null>(null);
  const [tab, setTab] = useState<'station' | 'redeem' | 'data'>('station');
  const [stationId, setStationId] = useState('');
  const [checked, setChecked] = useState(false);
  const [flash, setFlash] = useState<FlashMsg>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setUser(data.session?.user.email ?? null); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user.email ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setEvents(null); setEvent(null); setEventId(''); return; }
    rpc<StaffEvent[]>('staff_events').then((list) => {
      setEvents(list);
      let saved = ''; try { saved = localStorage.getItem('jp:crew:event') || ''; } catch {}
      const pick = list.find((e) => e.id === saved) || list[0];
      if (pick) setEventId(pick.id);
    }).catch(() => setEvents([]));
  }, [user]);

  const current = events?.find((e) => e.id === eventId) || null;
  const loadEvent = useCallback(async () => {
    if (!current) return;
    const ev = await rpc<EventData | null>('public_event', { p_slug: current.slug });
    setEvent(ev);
  }, [current?.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!current) return;
    try { localStorage.setItem('jp:crew:event', current.id); } catch {}
    setFound(null); setFlash(null); setStats(null);
    loadEvent().catch(() => {});
  }, [current?.id, loadEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  const crewStations = event ? event.stations.filter((s) => s.mode === 'crew') : [];
  const station = crewStations.find((s) => s.id === stationId) || crewStations[0] || null;

  useEffect(() => {
    if (tab !== 'data' || !current) return;
    const load = () => rpc<Stats & { status: string }>('event_stats', { p_event: current.id }).then((s) => { if (s.status === 'ok') setStats(s); }).catch(() => {});
    load();
    const t = window.setInterval(load, 20000);
    return () => window.clearInterval(t);
  }, [tab, current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: String(f.get('email') || ''), password: String(f.get('password') || '') });
    setBusy(false);
    setFlash(error ? { type: 'bad', text: 'Login gagal', sub: 'Periksa email dan kata sandi crew.' } : null);
  }

  // Dipanggil dari kamera maupun dari kode yang diketik.
  const handleCode = async (code: string) => {
    if (!current || busy || !code.trim()) return;
    setBusy(true);
    try {
      if (tab === 'station') {
        if (!station) return;
        if (station.requires_check && !checked) {
          setFlash({ type: 'warn', text: 'Verifikasi dulu', sub: 'Centang kotak verifikasi sebelum scan passport.' });
          return;
        }
        const r = await rpc<any>('staff_claim', { p_station: station.id, p_qr: code, p_checked: checked });
        if (r.status === 'ok') setFlash({ type: 'good', text: 'Valid, +' + r.points + ' poin', sub: r.name + ' mendapat poin dari ' + r.station + '.' + (r.bonus ? ' Semua station selesai: bonus ' + r.bonus + ' poin.' : '') + ' Saldo ' + r.balance + '.' });
        else if (r.status === 'already') setFlash({ type: 'bad', text: 'Sudah klaim', sub: r.name + ' sudah mendapat poin di ' + r.station + '.' });
        else if (r.status === 'not_found') setFlash({ type: 'bad', text: 'Passport tidak dikenali', sub: 'QR ini bukan passport event ini. Minta peserta membuka halaman passportnya.' });
        else if (r.status === 'need_check') setFlash({ type: 'warn', text: 'Verifikasi dulu', sub: 'Centang kotak verifikasi sebelum scan passport.' });
        else setFlash({ type: 'bad', text: 'Tidak diizinkan', sub: 'Akun ini tidak terdaftar sebagai crew station tersebut.' });
        setChecked(false);
      } else {
        const r = await rpc<any>('staff_lookup', { p_event: current.id, p_qr: code });
        if (r.status === 'ok') { setFound(r); setFlash(null); await loadEvent(); }
        else { setFound(null); setFlash({ type: 'bad', text: r.status === 'not_found' ? 'Passport tidak dikenali' : 'Tidak diizinkan', sub: r.status === 'not_found' ? 'QR ini bukan passport event ini.' : 'Akun ini tidak terdaftar sebagai crew event ini.' }); }
      }
    } catch {
      setFlash({ type: 'bad', text: 'Tidak bisa terhubung', sub: 'Periksa koneksi internet lalu scan ulang.' });
    } finally { setBusy(false); setManual(''); }
  };

  async function redeem(rewardId: string) {
    if (!found || !current) return;
    setBusy(true);
    try {
      const r = await rpc<any>('staff_redeem', { p_reward: rewardId, p_qr: found.qr_code });
      if (r.status === 'ok') setFlash({ type: 'good', text: 'Valid, serahkan ' + r.reward, sub: 'Sisa poin ' + r.name + ': ' + r.balance + '.' });
      else if (r.status === 'limit') setFlash({ type: 'bad', text: 'Batas tukar tercapai', sub: r.name + ' sudah menukar ' + r.reward + '. Maksimal ' + r.limit + ' per orang.' });
      else if (r.status === 'not_enough') setFlash({ type: 'bad', text: 'Poin kurang', sub: r.name + ' punya ' + r.balance + ' poin, ' + r.reward + ' butuh ' + r.cost + '.' });
      else if (r.status === 'out_of_stock') setFlash({ type: 'warn', text: 'Stok habis', sub: r.reward + ' sudah habis. Tawarkan hadiah lain.' });
      else setFlash({ type: 'bad', text: 'Tidak bisa menukar', sub: 'Scan ulang passport peserta.' });
      const again = await rpc<any>('staff_lookup', { p_event: current.id, p_qr: found.qr_code });
      if (again.status === 'ok') setFound(again);
      await loadEvent();
    } catch {
      setFlash({ type: 'bad', text: 'Tidak bisa terhubung', sub: 'Periksa koneksi. Cek saldo peserta sebelum mencoba lagi.' });
    } finally { setBusy(false); }
  }

  if (!configured) return <Shell event={null} tag="Crew"><NotConfigured /></Shell>;
  if (!ready) return <Shell event={null} tag="Crew"><p className="note">Memuat…</p></Shell>;

  if (!user) {
    return (
      <Shell event={null} tag="Crew">
        <section className="card">
          <h2>Login crew</h2>
          <form className="stack" onSubmit={login}>
            <label htmlFor="crew-email">Email<input type="email" id="crew-email" name="email" autoComplete="username" required /></label>
            <label htmlFor="crew-pass">Kata sandi<input type="password" id="crew-pass" name="password" autoComplete="current-password" required /></label>
            <Flash msg={flash} />
            <button type="submit" disabled={busy}>{busy ? 'Memproses…' : 'Masuk'}</button>
          </form>
        </section>
      </Shell>
    );
  }

  const logout = <button className="ghost small" onClick={() => supabase?.auth.signOut()}>Keluar ({user})</button>;
  if (events && events.length === 0) {
    return <Shell event={null} tag="Crew"><section className="card"><h2>Akun belum ditugaskan</h2><p className="note">Akun {user} belum terdaftar sebagai crew di event mana pun. Minta admin menambahkannya.</p></section>{logout}</Shell>;
  }
  if (!current || !event) return <Shell event={null} tag="Crew"><p className="note">Memuat event…</p>{logout}</Shell>;

  const n = stats?.participants || 0;
  const pct = (v: number) => (n ? Math.min(100, (v / n) * 100) : 0) + '%';

  return (
    <Shell event={event} tag={current.role === 'admin' ? 'Admin' : 'Crew'}>
      {events && events.length > 1 ? (
        <label htmlFor="crew-event">Event<select id="crew-event" value={eventId} onChange={(e) => setEventId(e.target.value)}>{events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      ) : null}
      <div className="tabs">
        {(['station', 'redeem', 'data'] as const).map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => { setTab(t); setFlash(null); setFound(null); }}>{t === 'station' ? 'Station' : t === 'redeem' ? 'Tukar' : 'Data'}</button>
        ))}
      </div>

      {tab !== 'data' ? (
        <section className="card">
          <h2>{tab === 'station' ? 'Scan passport, beri poin' : 'Scan passport, tukar hadiah'}</h2>
          {tab === 'station' ? (
            crewStations.length ? (
              <>
                <label htmlFor="crew-station">Station saya<select id="crew-station" value={station?.id || ''} onChange={(e) => { setStationId(e.target.value); setChecked(false); setFlash(null); }}>{crewStations.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.points} poin)</option>)}</select></label>
                {station?.requires_check ? <label className="check" htmlFor="crew-check"><input type="checkbox" id="crew-check" checked={checked} onChange={(e) => setChecked(e.target.checked)} /><span>Sudah saya verifikasi (misalnya postingan Instagram: tag akun event dan hashtag sesuai).</span></label> : null}
              </>
            ) : <p className="note">Event ini belum punya station dengan validasi crew scan.</p>
          ) : null}
          <Scanner onScan={handleCode} />
          <Flash msg={flash} />
          <form className="inline" onSubmit={(e) => { e.preventDefault(); handleCode(manual); }}>
            <input type="text" id="crew-manual" aria-label="Kode passport" placeholder="Atau ketik kode passport, mis. A1B2-C3D4" value={manual} onChange={(e) => setManual(e.target.value)} maxLength={24} autoCapitalize="characters" />
            <button type="submit" disabled={busy || !manual.trim()}>Cari</button>
          </form>
        </section>
      ) : null}

      {tab === 'redeem' && found ? (
        <section className="card">
          <div className="row">
            <div className="grow"><div className="t">{found.name}</div><div className="s">{prettyCode(found.code)} · {found.claimed}/{event.stations.length} station{found.completed ? ' · masuk undian' : ''}</div></div>
            <span className="num" style={{ fontSize: 24 }}>{found.points}</span>
          </div>
          <div>
            {event.rewards.map((r) => {
              const taken = found.redeemed[r.id] || 0;
              const off = busy || r.stock_remaining <= 0 || found.points < r.cost || taken >= r.limit_per_person;
              return (
                <div className="row" key={r.id}>
                  <RewardPic reward={r} className="thumb" />
                  <div className="grow"><div className="t">{r.name}</div><div className="s"><span className="num">{r.cost}</span> poin · stok <span className="num">{r.stock_remaining}</span> · diambil <span className="num">{taken}/{r.limit_per_person}</span></div></div>
                  <button disabled={off} onClick={() => redeem(r.id)}>Tukar</button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {tab === 'data' ? (
        stats ? (
          <>
            <div className="tiles">
              <div className="tile"><b>{stats.participants}</b><span>Passport aktif</span></div>
              <div className="tile"><b>{stats.claims}</b><span>Klaim station</span></div>
              <div className="tile"><b>{stats.avg_earned}</b><span>Rata-rata poin diperoleh</span></div>
              <div className="tile"><b>{stats.completed}</b><span>Peserta undian</span></div>
            </div>
            <section className="card"><h2>Traffic per station</h2><div className="stack">
              {stats.stations.map((s) => <div className="bar" key={s.id}><span>{s.name}</span><span className="track"><i style={{ width: pct(s.claims) }} /></span><span className="v num">{s.claims}</span></div>)}
            </div></section>
            <section className="card"><h2>Funnel peserta</h2><div className="stack">
              {([['Daftar', stats.participants], ['Main 1+ station', stats.active], ['Poin cukup untuk hadiah', stats.eligible], ['Tukar hadiah', stats.redeemers]] as [string, number][]).map(([label, v]) => <div className="bar" key={label}><span>{label}</span><span className="track"><i style={{ width: pct(v) }} /></span><span className="v num">{v}</span></div>)}
            </div></section>
            <section className="card"><h2>Stok merchandise</h2><div>
              {stats.rewards.map((r) => (
                <div className="row" key={r.id}>
                  <div className="grow"><div className="t">{r.name}</div><div className="s">Keluar <span className="num">{r.stock_initial - r.stock_remaining}</span> · sisa <span className="num">{r.stock_remaining}</span> dari <span className="num">{r.stock_initial}</span></div></div>
                  {r.stock_remaining <= 0 ? <span className="pill bad">Habis</span> : r.stock_remaining < r.stock_initial * 0.2 ? <span className="pill warn">Menipis</span> : <span className="pill good">Aman</span>}
                </div>
              ))}
            </div></section>
            <p className="note">Angka diperbarui otomatis tiap 20 detik.</p>
          </>
        ) : <p className="note">Memuat data…</p>
      ) : null}
      {logout}
    </Shell>
  );
}
