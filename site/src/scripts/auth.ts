// Shared Firebase Auth state for the site's client scripts (see firebase.ts
// for how the app is initialised). On a plain `astro preview` there is no
// config and `known` stays false.
import { firebaseApp, sdk } from './firebase';

export type SiteUser = {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  /** Firebase's User methods; `getIdToken(true)` mints a token with current claims. */
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  reload: () => Promise<void>;
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
    const app = await firebaseApp();
    if (!app) return;
    const { getAuth, onAuthStateChanged } = await sdk('auth');
    onAuthStateChanged(getAuth(app), (next: SiteUser) => {
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
