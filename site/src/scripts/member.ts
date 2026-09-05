// The signed-in member's profile, through the `member` Cloud Function (see
// functions/members.js). Resolves to null when there is no Firebase app,
// no signed-in member, or the function cannot be reached; callers treat
// that as "unknown" rather than an error.
import { firebaseApp, sdk } from './firebase';

export type MemberProfile = {
  email: string;
  username: string;
  newsletters: { id: string; name: string; description: string; subscribed: boolean }[];
};

export async function memberProfile(): Promise<MemberProfile | null> {
  try {
    const app = await firebaseApp();
    if (!app) return null;
    const { getFunctions, httpsCallable } = await sdk('functions');
    const call = httpsCallable(getFunctions(app, 'us-central1'), 'member');
    const { data } = await call({});
    return data as MemberProfile;
  } catch {
    return null;
  }
}

/** The member's username, or null when they have none or it is unknown. */
export async function memberUsername(): Promise<string | null> {
  const profile = await memberProfile();
  return profile?.username || null;
}
