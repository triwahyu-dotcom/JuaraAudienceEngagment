'use client';

// Panel admin: membuat dan mengatur event, station, hadiah, QR, tim, dan mengunduh data peserta.
// Hanya akun berperan admin di sebuah event yang bisa membuka dan mengubah event itu.

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { configured, rpc, supabase } from '@/lib/supabase';
import type { FlashMsg } from '@/lib/types';
import { Flash, NotConfigured } from '@/lib/ui';

type StaffEvent = { id: string; slug: string; name: string; role: 'admin' | 'crew' };
type EventRow = { id: string; slug: string; name: string; logo_url: string | null; poster_url: string | null; accent_color: string | null; bonus_points: number; is_open: boolean };
type StationRow = { id: string; event_id: string; name: string; mode: 'crew' | 'quiz'; points: number; sort: number; requires_check: boolean; quiz_question: string | null; quiz_options: string[] | null; quiz_answer: number | null; qr_secret: string; is_active: boolean };
type RewardRow = { id: string; event_id: string; name: string; description: string | null; photo_url: string | null; cost: number; stock_initial: number; stock_remaining: number; limit_per_person: number; sort: number; is_active: boolean };
type StaffRow = { user_id: string; email: string; role: 'admin' | 'crew'; me: boolean };
type Tab = 'event' | 'station' | 'reward' | 'qr' | 'team' | 'people';

const TABS: [Tab, string][] = [['event', 'Event'], ['station', 'Station'], ['reward', 'Hadiah'], ['qr', 'QR'], ['team', 'Tim'], ['people', 'Peserta']];
const int = (v: string, min: number, max: number, fallback: number) => { const n = parseInt(v, 10); return isNaN(n) ? fallback : Math.min(max, Math.max(min, n)); };
const SAVE_FAIL: FlashMsg = { type: 'bad', text: 'Gagal menyimpan', sub: 'Periksa koneksi dan isian, lalu coba lagi.' };

/** Mengecilkan gambar di HP sebelum diunggah, supaya ringan dibuka peserta. */
function shrink(file: File, max: number, type: 'image/png' | 'image/jpeg'): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
      cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob((b) => resolve(b), type, 0.85);
    };
    img.src = url;
  });
}

async function uploadImage(eventId: string, kind: string, file: File, max: number, png: boolean): Promise<string | null> {
  if (!supabase) return null;
  const blob = await shrink(file, max, png ? 'image/png' : 'image/jpeg');
  if (!blob) return null;
  const path = eventId + '/' + kind + '-' + Date.now() + (png ? '.png' : '.jpg');
  const { error } = await supabase.storage.from('event-assets').upload(path, blob, { contentType: blob.type, cacheControl: '31536000' });
  if (error) return null;
  return supabase.storage.from('event-assets').getPublicUrl(path).data.publicUrl;
}

function ImageField({ id, label, url, hint, onPick, onClear }: { id: string; label: string; url: string | null; hint: string; onPick: (f: File) => Promise<void>; onClear: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="stack">
      <label htmlFor={id}>{label}
        <input type="file" id={id} accept="image/*" disabled={busy} onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setBusy(true); await onPick(f); setBusy(false); }} />
      </label>
      <div className="imgrow">
        {busy ? <span className="note">Mengunggah…</span> : url ? <><img className="prev" src={url} alt="" /><button type="button" className="ghost small" onClick={onClear}>Hapus gambar</button></> : <span className="note">{hint}</span>}
      </div>
    </div>
  );
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="app">
      <header><div className="brand"><h1>{title}</h1><span>Admin</span></div></header>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Station
// ---------------------------------------------------------------------------

function StationCard({ row, onChanged, notify }: { row: StationRow; onChanged: () => void; notify: (m: FlashMsg) => void }) {
  const [f, setF] = useState(row);
  const [opts, setOpts] = useState<string[]>([0, 1, 2].map((i) => row.quiz_options?.[i] ?? ''));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(row); setOpts([0, 1, 2].map((i) => row.quiz_options?.[i] ?? '')); }, [row]);
  const id = 'st-' + row.id;

  async function save() {
    if (!supabase) return;
    const patch: Partial<StationRow> = { name: f.name.trim() || 'Station', mode: f.mode, points: f.points, sort: f.sort, requires_check: f.mode === 'crew' && f.requires_check, is_active: f.is_active };
    if (f.mode === 'quiz') {
      const filled = opts.map((o) => o.trim());
      if (!(f.quiz_question || '').trim() || filled.filter(Boolean).length < 2 || !filled[f.quiz_answer ?? 0]) {
        notify({ type: 'bad', text: 'Kuis belum lengkap', sub: 'Isi pertanyaan, minimal dua pilihan, dan pilih jawaban benar yang terisi.' });
        return;
      }
      // Pilihan kosong dibuang; nomor jawaban benar digeser mengikuti urutan baru.
      const answerText = filled[f.quiz_answer ?? 0];
      const kept = filled.filter(Boolean);
      Object.assign(patch, { quiz_question: (f.quiz_question || '').trim(), quiz_options: kept, quiz_answer: kept.indexOf(answerText) });
    } else {
      Object.assign(patch, { quiz_question: null, quiz_options: null, quiz_answer: null });
    }
    setBusy(true);
    const { error } = await supabase.from('stations').update(patch).eq('id', row.id);
    setBusy(false);
    if (error) { notify(SAVE_FAIL); return; }
    notify({ type: 'good', text: 'Station tersimpan', sub: patch.name });
    onChanged();
  }
  async function remove() {
    setBusy(true);
    const r = await rpc<{ status: string }>('admin_delete_station', { p_station: row.id }).catch(() => ({ status: 'error' }));
    setBusy(false);
    if (r.status === 'ok') { notify({ type: 'good', text: 'Station dihapus', sub: row.name }); onChanged(); }
    else if (r.status === 'in_use') notify({ type: 'warn', text: 'Station sudah punya klaim', sub: 'Tidak bisa dihapus supaya riwayat poin tidak hilang. Nonaktifkan saja: hilangkan centang "Tampil di passport".' });
    else notify(SAVE_FAIL);
  }

  return (
    <div className="edit">
      <div className="grid-st">
        <label htmlFor={id + '-name'}>Nama station<input type="text" id={id + '-name'} maxLength={40} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label htmlFor={id + '-pts'}>Poin<input type="number" id={id + '-pts'} min={1} max={999} value={f.points} onChange={(e) => setF({ ...f, points: int(e.target.value, 1, 999, f.points) })} /></label>
      </div>
      <div className="grid-st">
        <label htmlFor={id + '-mode'}>Cara validasi<select id={id + '-mode'} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as 'crew' | 'quiz' })}><option value="crew">Crew scan passport peserta</option><option value="quiz">Peserta scan QR station + kuis</option></select></label>
        <label htmlFor={id + '-sort'}>Urutan<input type="number" id={id + '-sort'} min={0} max={999} value={f.sort} onChange={(e) => setF({ ...f, sort: int(e.target.value, 0, 999, f.sort) })} /></label>
      </div>
      {f.mode === 'quiz' ? (
        <>
          <label htmlFor={id + '-q'}>Pertanyaan kuis<input type="text" id={id + '-q'} maxLength={140} value={f.quiz_question || ''} onChange={(e) => setF({ ...f, quiz_question: e.target.value })} /></label>
          {[0, 1, 2].map((i) => <label key={i} htmlFor={id + '-o' + i}>Pilihan {i + 1}<input type="text" id={id + '-o' + i} maxLength={40} value={opts[i]} onChange={(e) => setOpts(opts.map((o, k) => (k === i ? e.target.value : o)))} /></label>)}
          <label htmlFor={id + '-ans'}>Jawaban benar<select id={id + '-ans'} value={f.quiz_answer ?? 0} onChange={(e) => setF({ ...f, quiz_answer: int(e.target.value, 0, 2, 0) })}>{[0, 1, 2].map((i) => <option key={i} value={i}>Pilihan {i + 1}</option>)}</select></label>
        </>
      ) : (
        <label className="check" htmlFor={id + '-chk'}><input type="checkbox" id={id + '-chk'} checked={f.requires_check} onChange={(e) => setF({ ...f, requires_check: e.target.checked })} /><span>Crew wajib mencentang verifikasi sebelum memberi poin (misalnya cek postingan Instagram).</span></label>
      )}
      <label className="check" htmlFor={id + '-act'}><input type="checkbox" id={id + '-act'} checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /><span>Tampil di passport peserta</span></label>
      <div className="inline"><button disabled={busy} onClick={save}>Simpan station</button><button className="ghost" disabled={busy} onClick={remove}>Hapus</button></div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hadiah
// ---------------------------------------------------------------------------

function RewardCard({ row, onChanged, notify }: { row: RewardRow; onChanged: () => void; notify: (m: FlashMsg) => void }) {
  const [f, setF] = useState(row);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(row), [row]);
  const id = 'rw-' + row.id;

  async function save() {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.from('rewards').update({ name: f.name.trim() || 'Hadiah', description: (f.description || '').trim() || null, photo_url: f.photo_url, cost: f.cost, limit_per_person: f.limit_per_person, sort: f.sort, is_active: f.is_active }).eq('id', row.id);
    let stockOk = true;
    if (!error && f.stock_initial !== row.stock_initial) {
      const r = await rpc<{ status: string }>('admin_set_stock', { p_reward: row.id, p_initial: f.stock_initial }).catch(() => ({ status: 'error' }));
      stockOk = r.status === 'ok';
    }
    setBusy(false);
    if (error || !stockOk) { notify(SAVE_FAIL); return; }
    notify({ type: 'good', text: 'Hadiah tersimpan', sub: f.name });
    onChanged();
  }
  async function remove() {
    setBusy(true);
    const r = await rpc<{ status: string }>('admin_delete_reward', { p_reward: row.id }).catch(() => ({ status: 'error' }));
    setBusy(false);
    if (r.status === 'ok') { notify({ type: 'good', text: 'Hadiah dihapus', sub: row.name }); onChanged(); }
    else if (r.status === 'in_use') notify({ type: 'warn', text: 'Hadiah sudah pernah ditukar', sub: 'Tidak bisa dihapus supaya riwayat tidak hilang. Nonaktifkan saja: hilangkan centang "Tampil di katalog".' });
    else notify(SAVE_FAIL);
  }

  return (
    <div className="edit">
      <label htmlFor={id + '-name'}>Nama hadiah<input type="text" id={id + '-name'} maxLength={40} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <div className="trio">
        <label htmlFor={id + '-cost'}>Harga (poin)<input type="number" id={id + '-cost'} min={1} max={9999} value={f.cost} onChange={(e) => setF({ ...f, cost: int(e.target.value, 1, 9999, f.cost) })} /></label>
        <label htmlFor={id + '-stock'}>Stok awal<input type="number" id={id + '-stock'} min={0} max={99999} value={f.stock_initial} onChange={(e) => setF({ ...f, stock_initial: int(e.target.value, 0, 99999, f.stock_initial) })} /></label>
        <label htmlFor={id + '-lim'}>Maks/orang<input type="number" id={id + '-lim'} min={1} max={99} value={f.limit_per_person} onChange={(e) => setF({ ...f, limit_per_person: int(e.target.value, 1, 99, f.limit_per_person) })} /></label>
      </div>
      <p className="note">Sisa stok sekarang <span className="num">{row.stock_remaining}</span>, sudah keluar <span className="num">{row.stock_initial - row.stock_remaining}</span>.</p>
      <label htmlFor={id + '-desc'}>Deskripsi<textarea id={id + '-desc'} maxLength={240} value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <ImageField id={id + '-img'} label="Foto hadiah" url={f.photo_url} hint="Belum ada foto."
        onPick={async (file) => { const url = await uploadImage(row.event_id, 'reward', file, 800, false); if (url) setF((x) => ({ ...x, photo_url: url })); else notify({ type: 'bad', text: 'Gambar gagal diunggah', sub: 'Pakai file JPG atau PNG, lalu coba lagi.' }); }}
        onClear={() => setF({ ...f, photo_url: null })} />
      <div className="grid-st">
        <label className="check" htmlFor={id + '-act'}><input type="checkbox" id={id + '-act'} checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /><span>Tampil di katalog</span></label>
        <label htmlFor={id + '-sort'}>Urutan<input type="number" id={id + '-sort'} min={0} max={999} value={f.sort} onChange={(e) => setF({ ...f, sort: int(e.target.value, 0, 999, f.sort) })} /></label>
      </div>
      <div className="inline"><button disabled={busy} onClick={save}>Simpan hadiah</button><button className="ghost" disabled={busy} onClick={remove}>Hapus</button></div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QR
// ---------------------------------------------------------------------------

function QrCard({ title, sub, link, file }: { title: string; sub: string; link: string; file: string }) {
  const [src, setSrc] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { QRCode.toDataURL(link, { margin: 2, width: 1024, errorCorrectionLevel: 'M' }).then(setSrc).catch(() => setSrc('')); }, [link]);
  return (
    <div className="edit">
      <div className="row"><div className="grow"><div className="t">{title}</div><div className="s">{sub}</div></div></div>
      {src ? <img className="qrbig" src={src} alt={'QR ' + title} /> : null}
      <p className="note link">{link}</p>
      <div className="inline">
        {src ? <a className="btn" href={src} download={file + '.png'}>Unduh PNG</a> : null}
        <button className="ghost" onClick={() => navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {})}>{copied ? 'Tersalin' : 'Salin link'}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Halaman
// ---------------------------------------------------------------------------

export default function AdminPage() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [events, setEvents] = useState<StaffEvent[] | null>(null);
  const [eventId, setEventId] = useState('');
  const [tab, setTab] = useState<Tab>('event');
  const [ev, setEv] = useState<EventRow | null>(null);
  const [stations, setStations] = useState<StationRow[]>([]);
  const [rewards, setRewards] = useState<RewardRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [flash, setFlash] = useState<FlashMsg>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user.email ?? null)).finally(() => setReady(true));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user.email ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadEvents = useCallback(async (pick?: string) => {
    const list = (await rpc<StaffEvent[]>('staff_events')).filter((e) => e.role === 'admin');
    setEvents(list);
    let saved = ''; try { saved = localStorage.getItem('jp:admin:event') || ''; } catch {}
    const chosen = list.find((e) => e.id === (pick || saved)) || list[0];
    setEventId(chosen ? chosen.id : '');
  }, []);

  useEffect(() => {
    if (!user) { setEvents(null); setEventId(''); return; }
    loadEvents().catch(() => setEvents([]));
  }, [user, loadEvents]);

  const load = useCallback(async () => {
    if (!supabase || !eventId) return;
    const [e, s, r] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).single(),
      supabase.from('stations').select('*').eq('event_id', eventId).order('sort').order('created_at'),
      supabase.from('rewards').select('*').eq('event_id', eventId).order('sort').order('cost'),
    ]);
    if (e.error || s.error || r.error) { setFlash({ type: 'bad', text: 'Tidak bisa memuat event', sub: 'Periksa koneksi internet, lalu muat ulang halaman.' }); return; }
    setEv(e.data as EventRow); setStations(s.data as StationRow[]); setRewards(r.data as RewardRow[]);
  }, [eventId]);

  const loadStaff = useCallback(async () => {
    if (!eventId) return;
    const r = await rpc<{ status: string; staff: StaffRow[] }>('admin_staff_list', { p_event: eventId }).catch(() => null);
    if (r && r.status === 'ok') setStaff(r.staff);
  }, [eventId]);

  useEffect(() => {
    if (!eventId) { setEv(null); return; }
    try { localStorage.setItem('jp:admin:event', eventId); } catch {}
    setFlash(null);
    load(); loadStaff();
  }, [eventId, load, loadStaff]);

  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: String(f.get('email') || ''), password: String(f.get('password') || '') });
    setBusy(false);
    setFlash(error ? { type: 'bad', text: 'Login gagal', sub: 'Periksa email dan kata sandi.' } : null);
  }

  async function createEvent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const r = await rpc<{ status: string; id?: string }>('admin_create_event', { p_slug: String(f.get('slug') || ''), p_name: String(f.get('name') || '') }).catch(() => ({ status: 'error' } as { status: string; id?: string }));
    setBusy(false);
    if (r.status === 'ok' && r.id) { setCreating(false); setTab('event'); await loadEvents(r.id); setFlash({ type: 'good', text: 'Event dibuat', sub: 'Lanjutkan dengan menambah station dan hadiah.' }); }
    else if (r.status === 'slug_taken') setFlash({ type: 'bad', text: 'Alamat event sudah dipakai', sub: 'Pilih alamat lain, misalnya tambahkan tahun.' });
    else if (r.status === 'invalid') setFlash({ type: 'bad', text: 'Isian belum sesuai', sub: 'Alamat event: 3 sampai 40 huruf kecil, angka, atau tanda hubung. Nama event wajib diisi.' });
    else if (r.status === 'forbidden') setFlash({ type: 'bad', text: 'Tidak diizinkan', sub: 'Hanya akun admin yang bisa membuat event.' });
    else setFlash(SAVE_FAIL);
  }

  async function saveEvent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase || !ev) return;
    setBusy(true);
    const { error } = await supabase.from('events').update({ name: ev.name.trim() || 'Event', accent_color: ev.accent_color, bonus_points: ev.bonus_points, is_open: ev.is_open, logo_url: ev.logo_url, poster_url: ev.poster_url }).eq('id', ev.id);
    setBusy(false);
    if (error) { setFlash(SAVE_FAIL); return; }
    setFlash({ type: 'good', text: 'Event tersimpan', sub: ev.name });
    loadEvents(ev.id).catch(() => {});
  }

  async function addStation() {
    if (!supabase || !ev) return;
    const sort = stations.reduce((m, s) => Math.max(m, s.sort), 0) + 1;
    const { error } = await supabase.from('stations').insert({ event_id: ev.id, name: 'Station baru', mode: 'crew', points: 10, sort });
    if (error) setFlash(SAVE_FAIL); else { setFlash({ type: 'good', text: 'Station ditambahkan', sub: 'Ada di urutan terakhir. Atur nama, poin, dan cara validasinya.' }); load(); }
  }
  async function addReward() {
    if (!supabase || !ev) return;
    const sort = rewards.reduce((m, r) => Math.max(m, r.sort), 0) + 1;
    const { error } = await supabase.from('rewards').insert({ event_id: ev.id, name: 'Hadiah baru', cost: 50, stock_initial: 100, stock_remaining: 100, limit_per_person: 1, sort });
    if (error) setFlash(SAVE_FAIL); else { setFlash({ type: 'good', text: 'Hadiah ditambahkan', sub: 'Ada di urutan terakhir. Atur nama, harga, stok, dan fotonya.' }); load(); }
  }

  async function setStaffRole(email: string, role: 'admin' | 'crew' | null) {
    const r = await rpc<{ status: string }>('admin_staff_set', { p_event: eventId, p_email: email, p_role: role }).catch(() => ({ status: 'error' }));
    if (r.status === 'ok') { setFlash({ type: 'good', text: role ? 'Akun ditugaskan' : 'Akun dicabut', sub: email }); loadStaff(); return true; }
    if (r.status === 'no_account') setFlash({ type: 'bad', text: 'Akun belum ada', sub: 'Buat dulu akunnya di Supabase: Authentication > Users > Add user, lalu tambahkan di sini.' });
    else if (r.status === 'self') setFlash({ type: 'warn', text: 'Tidak bisa mengubah akun sendiri', sub: 'Minta admin lain bila peran Anda perlu diubah.' });
    else setFlash(SAVE_FAIL);
    return false;
  }

  async function exportCsv() {
    setBusy(true);
    const r = await rpc<{ status: string; participants: Record<string, unknown>[] }>('admin_participants', { p_event: eventId }).catch(() => null);
    setBusy(false);
    if (!r || r.status !== 'ok') { setFlash({ type: 'bad', text: 'Tidak bisa mengambil data', sub: 'Periksa koneksi internet lalu coba lagi.' }); return; }
    if (!r.participants.length) { setFlash({ type: 'warn', text: 'Belum ada peserta', sub: 'Data bisa diunduh setelah ada yang mendaftar.' }); return; }
    const cols: [string, string][] = [['code', 'Kode passport'], ['name', 'Nama'], ['wa', 'WhatsApp'], ['points', 'Saldo poin'], ['earned', 'Total poin diperoleh'], ['stations', 'Station selesai'], ['redemptions', 'Jumlah penukaran'], ['completed', 'Semua station selesai'], ['registered_at', 'Waktu daftar']];
    const cell = (v: unknown) => { const s = v === true ? 'Ya' : v === false ? 'Tidak' : String(v ?? ''); return '"' + s.replace(/"/g, '""') + '"'; };
    // Tanda petik di depan nomor WhatsApp mencegah spreadsheet membuang angka 0 di awal.
    const lines = [cols.map((c) => cell(c[1])).join(',')].concat(r.participants.map((p) => cols.map(([k]) => cell(k === 'wa' ? "'" + p[k] : p[k])).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'peserta-' + (ev?.slug || 'event') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setFlash({ type: 'good', text: r.participants.length + ' peserta diunduh', sub: 'File berisi data pribadi. Simpan dan bagikan sesuai persetujuan peserta.' });
  }

  if (!configured) return <Shell title="JUARA Passport"><NotConfigured /></Shell>;
  if (!ready) return <Shell title="JUARA Passport"><p className="note">Memuat…</p></Shell>;

  if (!user) {
    return (
      <Shell title="JUARA Passport">
        <section className="card">
          <h2>Login admin</h2>
          <form className="stack" onSubmit={login}>
            <label htmlFor="adm-email">Email<input type="email" id="adm-email" name="email" autoComplete="username" required /></label>
            <label htmlFor="adm-pass">Kata sandi<input type="password" id="adm-pass" name="password" autoComplete="current-password" required /></label>
            <Flash msg={flash} />
            <button type="submit" disabled={busy}>{busy ? 'Memproses…' : 'Masuk'}</button>
          </form>
        </section>
      </Shell>
    );
  }

  const logout = <button className="ghost small" onClick={() => supabase?.auth.signOut()}>Keluar ({user})</button>;
  if (!events) return <Shell title="JUARA Passport"><p className="note">Memuat event…</p>{logout}</Shell>;
  if (events.length === 0) {
    return <Shell title="JUARA Passport"><section className="card"><h2>Akun ini bukan admin</h2><p className="note">Akun {user} belum menjadi admin di event mana pun. Minta admin lain menambahkannya lewat tab Tim, atau gunakan halaman crew.</p><a className="btn ghost" href="/crew/">Buka halaman crew</a></section>{logout}</Shell>;
  }

  const quiz = stations.filter((s) => s.mode === 'quiz' && s.is_active);

  return (
    <Shell title={ev ? ev.name : 'JUARA Passport'}>
      <div className="inline">
        <label htmlFor="adm-event" style={{ flex: 1 }}>Event<select id="adm-event" value={eventId} onChange={(e) => { setEventId(e.target.value); setCreating(false); }}>{events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <button className="ghost" style={{ alignSelf: 'flex-end' }} onClick={() => { setCreating(!creating); setFlash(null); }}>{creating ? 'Batal' : 'Event baru'}</button>
      </div>

      {creating ? (
        <section className="card">
          <h2>Buat event baru</h2>
          <form className="stack" onSubmit={createEvent}>
            <label htmlFor="new-name">Nama event<input type="text" id="new-name" name="name" maxLength={60} required placeholder="Nama Event 2027" /></label>
            <label htmlFor="new-slug">Alamat event<input type="text" id="new-slug" name="slug" maxLength={40} required pattern="[a-z0-9-]{3,40}" placeholder="nama-event-2027" autoCapitalize="none" /></label>
            <p className="note">Alamat dipakai di link peserta: {origin}/?e=<b>alamat-event</b>. Huruf kecil, angka, dan tanda hubung saja. Tidak bisa diubah setelah dibuat.</p>
            <button type="submit" disabled={busy}>Buat event</button>
          </form>
        </section>
      ) : null}

      <div className="tabs">{TABS.map(([t, label]) => <button key={t} aria-pressed={tab === t} onClick={() => { setTab(t); setFlash(null); }}>{label}</button>)}</div>
      <Flash msg={flash} />

      {!ev ? <p className="note">Memuat event…</p> : null}

      {ev && tab === 'event' ? (
        <section className="card">
          <h2>Identitas event</h2>
          <form className="stack" onSubmit={saveEvent}>
            <label htmlFor="ev-name">Nama event<input type="text" id="ev-name" maxLength={60} value={ev.name} onChange={(e) => setEv({ ...ev, name: e.target.value })} /></label>
            <div className="pair">
              <label htmlFor="ev-color">Warna event<input type="color" id="ev-color" value={ev.accent_color || '#1F31AB'} onChange={(e) => setEv({ ...ev, accent_color: e.target.value })} /></label>
              <label htmlFor="ev-bonus">Bonus semua station<input type="number" id="ev-bonus" min={0} max={9999} value={ev.bonus_points} onChange={(e) => setEv({ ...ev, bonus_points: int(e.target.value, 0, 9999, ev.bonus_points) })} /></label>
            </div>
            <ImageField id="ev-logo" label="Logo event" url={ev.logo_url} hint="Belum ada logo. PNG transparan paling rapi."
              onPick={async (file) => { const url = await uploadImage(ev.id, 'logo', file, 400, true); if (url) setEv((x) => (x ? { ...x, logo_url: url } : x)); else setFlash({ type: 'bad', text: 'Gambar gagal diunggah', sub: 'Pakai file JPG atau PNG, lalu coba lagi.' }); }}
              onClear={() => setEv({ ...ev, logo_url: null })} />
            <ImageField id="ev-poster" label="Poster event" url={ev.poster_url} hint="Belum ada poster. Tampil di halaman daftar peserta."
              onPick={async (file) => { const url = await uploadImage(ev.id, 'poster', file, 1200, false); if (url) setEv((x) => (x ? { ...x, poster_url: url } : x)); else setFlash({ type: 'bad', text: 'Gambar gagal diunggah', sub: 'Pakai file JPG atau PNG, lalu coba lagi.' }); }}
              onClear={() => setEv({ ...ev, poster_url: null })} />
            <label className="check" htmlFor="ev-open"><input type="checkbox" id="ev-open" checked={ev.is_open} onChange={(e) => setEv({ ...ev, is_open: e.target.checked })} /><span>Event dibuka: peserta bisa mendaftar dan mengklaim poin kuis. Hilangkan centang setelah event selesai.</span></label>
            <p className="note">Gambar yang baru diunggah belum tampil ke peserta sampai Anda menekan Simpan.</p>
            <button type="submit" disabled={busy}>Simpan event</button>
          </form>
        </section>
      ) : null}

      {ev && tab === 'station' ? (
        <section className="card">
          <h2>Station <span className="num">{stations.length}</span></h2>
          <div>{stations.map((s) => <StationCard key={s.id} row={s} onChanged={load} notify={setFlash} />)}</div>
          {stations.length === 0 ? <p className="note">Belum ada station. Tambahkan yang pertama.</p> : null}
          <button onClick={addStation}>Tambah station</button>
          <p className="note">Perubahan poin berlaku untuk klaim berikutnya. Station kuis memerlukan QR cetak, lihat tab QR.</p>
        </section>
      ) : null}

      {ev && tab === 'reward' ? (
        <section className="card">
          <h2>Hadiah <span className="num">{rewards.length}</span></h2>
          <div>{rewards.map((r) => <RewardCard key={r.id} row={r} onChanged={load} notify={setFlash} />)}</div>
          {rewards.length === 0 ? <p className="note">Belum ada hadiah. Tambahkan yang pertama.</p> : null}
          <button onClick={addReward}>Tambah hadiah</button>
        </section>
      ) : null}

      {ev && tab === 'qr' ? (
        <section className="card">
          <h2>QR untuk dicetak</h2>
          <div>
            <QrCard title="QR gate" sub="Peserta scan untuk membuat passport" link={origin + '/?e=' + ev.slug} file={'qr-gate-' + ev.slug} />
            {quiz.map((s) => <QrCard key={s.id} title={s.name} sub={'Station kuis · ' + s.points + ' poin'} link={origin + '/s/?e=' + ev.slug + '&s=' + s.id + '&k=' + s.qr_secret} file={'qr-' + s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')} />)}
          </div>
          <p className="note">Station dengan validasi crew tidak memerlukan QR cetak. Cetak minimal 10 x 10 cm dan uji dengan HP sebelum dipasang. Siapa pun yang memegang link station kuis bisa membukanya, jadi beri station kuis poin kecil.</p>
        </section>
      ) : null}

      {ev && tab === 'team' ? (
        <section className="card">
          <h2>Tim <span className="num">{staff.length}</span></h2>
          <div>
            {staff.map((s) => (
              <div className="row" key={s.user_id}>
                <div className="grow"><div className="t">{s.email}</div><div className="s">{s.role === 'admin' ? 'Admin' : 'Crew'}{s.me ? ' · akun Anda' : ''}</div></div>
                {s.me ? null : <button className="ghost small" onClick={() => setStaffRole(s.email, null)}>Cabut</button>}
              </div>
            ))}
          </div>
          <form className="stack" onSubmit={async (e) => { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); if (await setStaffRole(String(f.get('email') || ''), f.get('role') === 'admin' ? 'admin' : 'crew')) form.reset(); }}>
            <div className="grid-st">
              <label htmlFor="tm-email">Email akun<input type="email" id="tm-email" name="email" required /></label>
              <label htmlFor="tm-role">Peran<select id="tm-role" name="role" defaultValue="crew"><option value="crew">Crew</option><option value="admin">Admin</option></select></label>
            </div>
            <button type="submit">Tugaskan ke event ini</button>
          </form>
          <p className="note">Akun baru dibuat di Supabase: Authentication &gt; Users &gt; Add user, centang Auto Confirm User. Setelah itu tugaskan emailnya di sini. Crew bisa memberi poin dan menukar hadiah; admin juga bisa mengubah pengaturan event.</p>
        </section>
      ) : null}

      {ev && tab === 'people' ? (
        <section className="card">
          <h2>Data peserta</h2>
          <p className="note">Unduh daftar peserta sebagai file CSV yang bisa dibuka di Excel atau Google Sheets: kode passport, nama, nomor WhatsApp, poin, station selesai, dan jumlah penukaran.</p>
          <button disabled={busy} onClick={exportCsv}>{busy ? 'Menyiapkan…' : 'Unduh CSV peserta'}</button>
          <p className="note">Angka ringkasan dan traffic per station ada di halaman crew, tab Data.</p>
        </section>
      ) : null}

      <div className="inline"><a className="btn ghost" href="/crew/">Halaman crew</a><a className="btn ghost" href={ev ? '/?e=' + ev.slug : '/'}>Lihat sebagai peserta</a></div>
      {logout}
    </Shell>
  );
}
