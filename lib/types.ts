export type Station = {
  id: string; name: string; mode: 'crew' | 'quiz'; points: number; requires_check: boolean;
  quiz_question: string | null; quiz_options: string[] | null;
};
export type Reward = {
  id: string; name: string; description: string | null; photo_url: string | null;
  cost: number; stock_remaining: number; limit_per_person: number;
};
export type EventData = {
  id: string; slug: string; name: string; logo_url: string | null; poster_url: string | null;
  accent_color: string | null; bonus_points: number; is_open: boolean;
  stations: Station[]; rewards: Reward[];
};
export type Passport = {
  code: string; name: string; qr_code: string; points: number; earned: number; completed: boolean;
  claimed: string[]; redeemed: Record<string, number>;
};
export type FlashMsg = { type: 'good' | 'bad' | 'warn'; text: string; sub?: string } | null;

export function eventSlug(): string {
  const q = new URLSearchParams(window.location.search).get('e');
  let last: string | null = null;
  try { last = localStorage.getItem('jp:last'); } catch {}
  const slug = (q || last || process.env.NEXT_PUBLIC_DEFAULT_EVENT || 'rockets-rollers').toLowerCase();
  try { localStorage.setItem('jp:last', slug); } catch {}
  return slug;
}
export function getToken(slug: string): string | null {
  try { return localStorage.getItem('jp:token:' + slug); } catch { return null; }
}
export function setToken(slug: string, token: string | null) {
  try { token ? localStorage.setItem('jp:token:' + slug, token) : localStorage.removeItem('jp:token:' + slug); } catch {}
}
export function prettyCode(code: string) { return code.slice(0, 4) + '-' + code.slice(4); }
