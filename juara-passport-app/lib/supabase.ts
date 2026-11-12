import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/** false bila anon key belum diisi; halaman menampilkan petunjuk alih-alih error. */
export const configured = Boolean(url && key);
export const supabase: SupabaseClient | null = configured ? createClient(url, key) : null;

export async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
