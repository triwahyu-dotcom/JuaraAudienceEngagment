// Simpanan lokal di HP: dipakai saat koneksi lambat atau putus.

export function cacheGet<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
export function cacheSet(key: string, value: unknown) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

/** Scan station yang belum terkirim ke server. */
export type QueuedScan = { station_id: string; station_name: string; qr: string; checked: boolean; at: number };
export const queueKey = (eventId: string) => 'jp:queue:' + eventId;
