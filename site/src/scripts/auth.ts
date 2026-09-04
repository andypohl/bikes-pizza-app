// Shared Firebase Auth state for the site's client scripts. The web config
// comes from Firebase Hosting's reserved URL, so nothing project-specific is
// bundled; on a plain `astro preview` there is no config and `known` stays
// false. The SDK is loaded from Google's CDN only when the config exists.

export type SiteUser = {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  getIdToken: () => Promise<string>;
} | null;

type Listener = (user: SiteUser, known: boolean) => void;

let user: SiteUser = null;
let known = false;
const listeners = new Set<Listener>();
let started = false;

function notify() {
  for (const listener of listeners) listener(user, known);
}

async function start() {
  started = true;
  try {
    const res = await fetch('/__/firebase/init.json');
    if (!res.ok) return;
    const config = await res.json();
    const [{ initializeApp }, { getAuth, onAuthStateChanged }] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js'),
    ]);
    onAuthStateChanged(getAuth(initializeApp(config)), (next: SiteUser) => {
      user = next;
      known = true;
      notify();
    });
  } catch {
    // Leave the state unknown; callers show their neutral UI.
  }
}

/** Calls `listener` now and whenever the signed-in user changes. */
export function onAuth(listener: Listener): () => void {
  listeners.add(listener);
  listener(user, known);
  if (!started) start();
  return () => listeners.delete(listener);
}

/** The path to sign in and come back to `returnTo` (a path on this site). */
export function signInHref(returnTo: string): string {
  return `/account/?mode=signin&r=${encodeURIComponent(returnTo)}`;
}
