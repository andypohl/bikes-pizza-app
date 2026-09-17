// The header of a member's profile page (/member/<username>/): when they
// joined, the location they chose to share and how many pizzas and bikes
// they have posted, from the public `GET /api/members/{username}`. The
// static page (a member's post grid) carries the username; the fallback
// page for members without posts reads it from the path.
import { API_URL } from '../lib/api';

export type Profile = {
  uid: string;
  username: string;
  joinedAt: string | null;
  location: string;
  counts: Record<string, number>;
  messages: boolean;
};

export async function fetchProfile(username: string): Promise<Profile | null> {
  try {
    const res = await fetch(`${API_URL}/api/members/${encodeURIComponent(username)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as Partial<Profile>;
    if (typeof json.username !== 'string') return null;
    return {
      uid: typeof json.uid === 'string' ? json.uid : '',
      username: json.username,
      joinedAt: typeof json.joinedAt === 'string' ? json.joinedAt : null,
      location: typeof json.location === 'string' ? json.location : '',
      counts: json.counts && typeof json.counts === 'object' ? (json.counts as Record<string, number>) : {},
      messages: json.messages === true,
    };
  } catch {
    return null;
  }
}

const joined = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

/** Fills the header (`[data-profile]`) on the page from the API; leaves it as built when the API cannot be reached. */
export async function wireProfile() {
  const header = document.querySelector<HTMLElement>('[data-profile]');
  if (!header) return;
  const username = header.dataset.username || location.pathname.split('/').filter(Boolean)[1] || '';
  if (!username) return;
  const profile = await fetchProfile(username);
  const name = header.querySelector<HTMLElement>('[data-username]');
  const meta = header.querySelector<HTMLElement>('[data-meta]');
  const missing = header.querySelector<HTMLElement>('[data-missing]');
  if (!profile) {
    if (missing && !header.dataset.username) missing.hidden = false;
    return;
  }
  if (name) name.textContent = profile.username;
  if (meta) {
    const parts = [];
    if (profile.joinedAt) parts.push(`Joined ${joined(profile.joinedAt)}`);
    if (profile.location) parts.push(profile.location);
    meta.textContent = parts.join(' · ');
    meta.hidden = parts.length === 0;
  }
  for (const feed of ['pizza', 'bikes']) {
    const el = header.querySelector<HTMLElement>(`[data-count="${feed}"]`);
    if (!el) continue;
    const n = profile.counts[feed] ?? 0;
    el.textContent = `${n} ${feed === 'pizza' ? (n === 1 ? 'pizza' : 'pizzas') : n === 1 ? 'bike' : 'bikes'}`;
    el.hidden = false;
  }
  if (missing) missing.hidden = true;
}
