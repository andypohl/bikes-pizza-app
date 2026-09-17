// The read-only view of a direct message thread at /messages/<thread>/,
// where the "Previous messages" link in a continue-by-email mail points.
// Needs the site's Firebase session (the account page shares the origin):
// signed out it links to sign in; signed in it fetches the thread from
// the API with the member's token, page by page, and draws every message
// as a bubble, the member's own on the right. A thread the member is not
// part of says so; a `gone` marker explains that the other member deleted
// their account.
import { API_URL } from '../lib/api';
import { onAuth, signInHref, type SiteUser } from './auth';

type Message = {
  id: string;
  kind: string;
  event?: string;
  by?: string | null;
  uid?: string;
  html: string;
  createdAt?: string;
  at?: string;
  editedAt?: string | null;
  deleted?: boolean;
  conversation: number;
};

type ThreadInfo = { id: string; gone: boolean; other: { uid: string; username: string } | null };

/** How many pages (fifty messages each) the page fetches at most. */
const MAX_PAGES = 10;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

async function fetchThread(user: NonNullable<SiteUser>, id: string): Promise<{ thread: ThreadInfo; messages: Message[] } | { error: string }> {
  const token = await user.getIdToken();
  let before: string | null = null;
  let thread: ThreadInfo | null = null;
  const messages: Message[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = `${API_URL}/api/threads/${encodeURIComponent(id)}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const error = (json.error ?? {}) as { code?: string; message?: string };
      return { error: error.code === 'not-found' ? 'This conversation is not yours to read, or does not exist.' : (error.message ?? 'Could not load the conversation.') };
    }
    thread ??= json.thread as ThreadInfo;
    const batch = Array.isArray(json.messages) ? (json.messages as Message[]) : [];
    messages.push(...batch);
    if (!json.more || !batch.length) break;
    const last = batch[batch.length - 1];
    before = last.createdAt ?? last.at ?? null;
    if (!before) break;
  }
  return { thread: thread ?? { id, gone: false, other: null }, messages: messages.reverse() };
}

function eventLine(m: Message, uid: string, other: string): string {
  switch (m.event) {
    case 'emailed':
      return '(conversation continued by email)';
    case 'declined':
      return '(the request to continue by email was declined)';
    case 'blocked':
      return m.by === uid ? `(you blocked ${other})` : `(${other} blocked this conversation)`;
    default:
      return `(${m.event ?? 'event'})`;
  }
}

function render(container: HTMLElement, user: NonNullable<SiteUser>, thread: ThreadInfo, messages: Message[]) {
  container.replaceChildren();
  const other = thread.other?.username ?? 'a member who has left';
  container.append(el('h1', 'text-3xl font-light tracking-wide text-ink mb-1', thread.gone ? 'Conversation' : `Conversation with ${other}`));
  if (thread.gone) {
    container.append(
      el('p', 'text-muted font-light mt-3', 'This conversation is no longer available: the other member deleted their account. Conversations are deleted along with the accounts of the people in them.'),
    );
    return;
  }
  container.append(el('p', 'text-sm text-muted font-light mb-6', 'Read-only. Reply from the bikes.pizza app.'));
  const list = el('div', 'flex flex-col gap-2');
  let conversation = 0;
  for (const m of messages) {
    if (m.conversation !== conversation) {
      conversation = m.conversation;
      if (conversation > 1) list.append(el('p', 'text-center text-xs text-muted my-2', `Conversation ${conversation}`));
    }
    if (m.kind === 'event') {
      list.append(el('p', 'text-center text-xs text-muted my-2', eventLine(m, user.uid, other)));
      continue;
    }
    const mine = m.uid === user.uid;
    const row = el('div', `flex ${mine ? 'justify-end' : 'justify-start'}`);
    const bubble = el('div', `max-w-[80%] rounded-2xl px-4 py-2 text-sm font-light ${mine ? 'bg-accent text-on-accent rounded-br-sm' : 'bg-pill text-ink rounded-bl-sm'}`);
    const body = el('div', 'thread-body');
    if (m.deleted) body.append(el('em', 'opacity-80', 'Message deleted'));
    else body.innerHTML = m.html; // rendered and sanitized by the functions
    const meta = el('div', `mt-1 text-[11px] ${mine ? 'text-on-accent/80' : 'text-muted'}`, `${when(m.createdAt ?? '')}${m.editedAt ? ' · edited' : ''}`);
    bubble.append(body, meta);
    row.append(bubble);
    list.append(row);
  }
  if (!messages.length) list.append(el('p', 'text-muted font-light', 'Nothing here yet.'));
  container.append(list);
}

let stop: (() => void) | undefined;

export function wireThreadPage() {
  const container = document.querySelector<HTMLElement>('[data-thread-page]');
  if (!container) return;
  const id = location.pathname.split('/').filter(Boolean)[1] ?? '';
  stop?.();
  stop = onAuth(async (user, known) => {
    if (!known) return;
    if (!id) {
      container.replaceChildren(el('p', 'text-muted font-light', 'No conversation was named.'));
      return;
    }
    if (!user) {
      container.replaceChildren();
      container.append(el('h1', 'text-3xl font-light tracking-wide text-ink mb-3', 'Conversation'));
      const a = el('a', 'text-sm font-light text-muted underline decoration-line underline-offset-4 hover:text-spice', 'Sign in to read this conversation');
      a.href = signInHref(location.pathname);
      container.append(a);
      return;
    }
    container.replaceChildren(el('p', 'text-muted font-light', 'Loading…'));
    const result = await fetchThread(user, id);
    if ('error' in result) {
      container.replaceChildren(el('h1', 'text-3xl font-light tracking-wide text-ink mb-3', 'Conversation'), el('p', 'text-muted font-light', result.error));
      return;
    }
    render(container, user, result.thread, result.messages);
  });
}
