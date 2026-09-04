// Settings the website reads at page load from the submissions API, such
// as whether the "Submit a bike or pizza" button is shown. The last answer
// is remembered per browser so repeat visits render without waiting, and
// `watchSettings` then follows the settings document in Firestore so a
// change made on the review page shows up without a reload.
import { API_URL } from '../lib/api';
import { firebaseApp, sdk } from './firebase';

export type SiteSettings = { submitButton: boolean };

const KEY = 'site-settings';
let pending: Promise<SiteSettings | null> | undefined;

export function cachedSettings(): SiteSettings | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SiteSettings) : null;
  } catch {
    return null;
  }
}

export function fetchSettings(): Promise<SiteSettings | null> {
  pending ??= fetch(`${API_URL}/api/site/settings`, { cache: 'no-store' })
    .then((res) => (res.ok ? (res.json() as Promise<SiteSettings>) : null))
    .then((settings) => {
      if (settings) {
        try {
          localStorage.setItem(KEY, JSON.stringify(settings));
        } catch {
          // Storage unavailable; the fetched value is still returned.
        }
      }
      return settings;
    })
    .catch(() => null);
  return pending;
}

const DEFAULTS: SiteSettings = { submitButton: true };

function normalise(data: Record<string, unknown> | undefined): SiteSettings {
  const out = { ...DEFAULTS };
  if (data && typeof data.submitButton === 'boolean') out.submitButton = data.submitButton;
  return out;
}

/**
 * Calls `listener` with the cached value (if any), then with the API's
 * answer, then on every later change to the settings document. Returns a
 * function that stops listening.
 */
export function watchSettings(listener: (settings: SiteSettings) => void): () => void {
  let stopped = false;
  let unsubscribe: (() => void) | undefined;
  const cached = cachedSettings();
  if (cached) listener(cached);
  fetchSettings().then((settings) => {
    if (settings && !stopped) listener(settings);
  });
  (async () => {
    try {
      const app = await firebaseApp();
      if (!app || stopped) return;
      const { getFirestore, doc, onSnapshot } = await sdk('firestore');
      if (stopped) return;
      unsubscribe = onSnapshot(doc(getFirestore(app), 'settings', 'site'), (snap: { data: () => Record<string, unknown> | undefined }) => {
        const settings = normalise(snap.data());
        try {
          localStorage.setItem(KEY, JSON.stringify(settings));
        } catch {
          // Storage unavailable.
        }
        listener(settings);
      });
    } catch {
      // The API answer stands; changes will show on the next load.
    }
  })();
  return () => {
    stopped = true;
    unsubscribe?.();
  };
}
