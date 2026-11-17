import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/** false bila anon key belum diisi; halaman menampilkan petunjuk alih-alih error. */
export const configured = Boolean(url && key);
export const supabase: SupabaseClient | null = configured ? createClient(url, key) : null;

export async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi');
  let res;
  try { res = await supabase.rpc(fn, args); } catch (e) { throw new NetworkError(String(e)); }
  const { data, error } = res;
  // Galat dari database selalu punya kode; tanpa kode berarti permintaannya tidak sampai.
  if (error) throw error.code ? new Error(error.message) : new NetworkError(error.message);
  return data as T;
}

/** Permintaan tidak sampai ke server: koneksi lambat, putus, atau server tidak menjawab. */
export class NetworkError extends Error {}
export function isNetworkError(e: unknown): boolean {
  return e instanceof NetworkError || (typeof navigator !== 'undefined' && navigator.onLine === false);
}
