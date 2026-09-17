// Comments under a post, for signed-in members (docs/community-design.md):
// fetched from the REST API with the member's ID token and rendered in
// place, with reply, like, edit (five minutes), delete, report and a
// composer. The static page carries the count from build time; this
// script takes over once the Firebase session is known. Nothing is
// fetched while signed out.
import { API_URL } from '../lib/api';
import { COMMENTS } from '../lib/contract';
import { onAuth, signInHref, type SiteUser } from './auth';

type Comment = {
  id: string;
  parentId: string | null;
  uid: string | null;
  username: string;
  html: string;
  text?: string;
  createdAt: string;
  editedAt: string | null;
  status: string;
  removed: boolean;
  likeCount: number;
  liked: boolean;
  replyCount: number;
  mine: boolean;
  replies?: Comment[];
};

type Page = { count: number; comments: Comment[]; next: string | null };

type Root = {
  el: HTMLElement;
  postId: string;
  authorUid: string;
  enabled: boolean;
  count: number;
  user: NonNullable<SiteUser>;
  page: Page | null;
  replyTo: Comment | null;
  editing: Comment | null;
  loading: boolean;
};

const EDIT_WINDOW_MS = COMMENTS.editWindowMinutes * 60 * 1000;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const button = (label: string, className: string, onClick: () => void): HTMLButtonElement => {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};

const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function api(user: NonNullable<SiteUser>, path: string, init: { method?: string; body?: unknown } = {}): Promise<Record<string, unknown>> {
  const token = await user.getIdToken();
  const res = await fetch(`${API_URL}/api${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const error = (json.error ?? {}) as { code?: string; message?: string };
    throw new ApiError(error.code ?? 'unavailable', error.message ?? 'Something went wrong. Please try again.');
  }
  return json;
}

const LINK = 'underline decoration-line underline-offset-4 hover:text-spice';
const SMALL_BUTTON = 'text-xs font-medium text-muted hover:text-spice transition-colors px-1';

// ---- rendering ---------------------------------------------------------------

function setStatus(root: Root, text: string, bad = false) {
  const line = root.el.querySelector<HTMLElement>('[data-status]');
  if (!line) return;
  line.textContent = text;
  line.className = `text-sm mt-2 ${bad ? 'text-error' : 'text-muted'}`;
  line.hidden = !text;
}

function countLine(root: Root): HTMLElement {
  return el('h2', 'text-lg font-light tracking-wide text-ink mb-3', plural(root.count, 'comment'));
}

function renderSignedOut(container: HTMLElement, count: number) {
  container.replaceChildren();
  container.append(el('h2', 'text-lg font-light tracking-wide text-ink mb-3', plural(count, 'comment')));
  const a = el('a', `text-sm font-light text-muted ${LINK}`, 'Sign in to read the comments');
  a.href = signInHref(location.pathname + location.search);
  container.append(a);
}

function renderOff(container: HTMLElement) {
  container.replaceChildren(
    el('h2', 'text-lg font-light tracking-wide text-ink mb-3', 'Comments'),
    el('p', 'text-sm font-light text-muted', 'Comments are off for this post.'),
  );
}

function commentNode(root: Root, comment: Comment, reply = false): HTMLElement {
  const item = el('div', reply ? 'ml-5 mt-3' : 'mt-4');
  item.dataset.comment = comment.id;
  if (comment.removed) {
    item.append(el('p', 'text-sm italic text-muted', 'Comment removed'));
  } else {
    const head = el('div', 'flex flex-wrap items-baseline gap-x-2 text-xs text-muted');
    head.append(el('span', 'font-medium text-ink text-sm', comment.username || 'member'));
    head.append(el('span', '', when(comment.createdAt)));
    if (comment.editedAt) head.append(el('span', '', '(edited)'));
    if (comment.status === 'pending') head.append(el('span', 'text-spice', 'Waiting for review'));
    const body = el('div', 'comment-body text-sm text-ink font-light leading-relaxed mt-1');
    body.innerHTML = comment.html; // rendered and sanitized by the functions
    const actions = el('div', 'flex flex-wrap items-center gap-1 mt-1');
    const like = button(comment.liked ? '♥' : '♡', `${SMALL_BUTTON} text-base leading-none ${comment.liked ? 'text-spice' : ''}`, () => toggleLike(root, comment));
    like.title = comment.liked ? 'Unlike' : 'Like';
    like.disabled = comment.status === 'pending';
    actions.append(like);
    if (comment.likeCount > 0) {
      const count = button(String(comment.likeCount), SMALL_BUTTON, () => showLikes(root, comment));
      count.title = 'Who liked this';
      actions.append(count);
    }
    const replyButton = button('Reply', SMALL_BUTTON, () => {
      root.replyTo = comment;
      root.editing = null;
      renderComposer(root, true);
    });
    replyButton.disabled = comment.status === 'pending';
    actions.append(replyButton);
    const canEdit = comment.mine && Date.now() - Date.parse(comment.createdAt) < EDIT_WINDOW_MS;
    if (canEdit) {
      actions.append(
        button('Edit', SMALL_BUTTON, () => {
          root.editing = comment;
          root.replyTo = null;
          renderComposer(root, true);
        }),
      );
    }
    if (comment.mine || root.authorUid === root.user.uid) {
      actions.append(button('Delete', SMALL_BUTTON, () => remove(root, comment)));
    }
    if (!comment.mine) actions.append(button('Report', SMALL_BUTTON, () => report(root, comment)));
    item.append(head, body, actions);
  }
  const replies = comment.replies ?? [];
  if (replies.length || comment.replyCount > replies.length) {
    const list = el('div', '');
    for (const r of replies) list.append(commentNode(root, r, true));
    const hidden = comment.replyCount - replies.length;
    if (hidden > 0) {
      list.append(
        button(hidden === 1 ? 'Show 1 more reply' : `Show ${hidden} more replies`, `${SMALL_BUTTON} ml-5 mt-2`, () => moreReplies(root, comment)),
      );
    }
    item.append(list);
  }
  return item;
}

function renderThread(root: Root) {
  const container = root.el;
  const page = root.page;
  container.replaceChildren(countLine(root));
  if (!page) return;
  const list = el('div', '');
  list.dataset.thread = '';
  for (const comment of page.comments) list.append(commentNode(root, comment));
  container.append(list);
  if (page.next) container.append(button('Load more comments', `${SMALL_BUTTON} mt-3`, () => loadMore(root)));
  const status = el('p', 'text-sm mt-2 text-muted');
  status.dataset.status = '';
  status.hidden = true;
  container.append(status);
  container.append(composerNode(root));
}

function composerNode(root: Root): HTMLElement {
  const form = el('form', 'mt-4');
  form.dataset.composer = '';
  form.noValidate = true;
  const mode = el('div', 'flex items-center justify-between text-xs text-muted mb-1');
  mode.dataset.mode = '';
  mode.hidden = true;
  const modeText = el('span', '');
  const cancel = button('Cancel', SMALL_BUTTON, () => {
    root.replyTo = null;
    root.editing = null;
    renderComposer(root, false);
  });
  mode.append(modeText, cancel);
  const field = el('textarea', 'w-full rounded-lg border border-line bg-field text-ink text-sm font-light p-3 focus:outline-none focus:ring-2 focus:ring-accent');
  field.name = 'text';
  field.rows = 3;
  field.placeholder = 'Write a comment';
  field.maxLength = COMMENTS.maxLength * 2;
  const tools = el('div', 'flex items-center gap-1 mt-2');
  const wrap = (before: string, after: string) => {
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const selected = field.value.slice(start, end);
    field.setRangeText(`${before}${selected}${after}`, start, end, 'end');
    field.focus();
    update();
  };
  const tool = (label: string, title: string, onClick: () => void) => {
    const b = button(label, 'px-2 py-1 rounded text-sm text-muted hover:text-spice hover:bg-pill transition-colors', onClick);
    b.title = title;
    return b;
  };
  tools.append(
    tool('B', 'Bold', () => wrap('**', '**')),
    tool('I', 'Italic', () => wrap('_', '_')),
    tool('🔗', 'Link', () => {
      const url = window.prompt('Link address', 'https://');
      if (!url || url === 'https://') return;
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? start;
      const label = field.value.slice(start, end) || 'link';
      field.setRangeText(`[${label}](${url.trim()})`, start, end, 'end');
      field.focus();
      update();
    }),
  );
  const counter = el('span', 'ml-auto text-xs text-muted', `0/${COMMENTS.maxLength}`);
  const send = el('button', 'ml-2 px-4 py-2 rounded-full bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium disabled:opacity-50', 'Post');
  send.type = 'submit';
  send.disabled = true;
  tools.append(counter, send);
  const update = () => {
    const length = field.value.trim().length;
    counter.textContent = `${length}/${COMMENTS.maxLength}`;
    counter.classList.toggle('text-error', length > COMMENTS.maxLength);
    send.disabled = length === 0 || length > COMMENTS.maxLength;
  };
  field.addEventListener('input', update);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = field.value.trim();
    if (!text || text.length > COMMENTS.maxLength) return;
    send.disabled = true;
    try {
      await sendComment(root, text);
      field.value = '';
      update();
    } catch (error) {
      setStatus(root, error instanceof Error ? error.message : 'Could not post that.', true);
    } finally {
      update();
    }
  });
  form.append(mode, field, tools);
  return form;
}

/** Puts the composer into reply, edit or plain mode. */
function renderComposer(root: Root, focus: boolean) {
  const form = root.el.querySelector<HTMLFormElement>('[data-composer]');
  if (!form) return;
  const mode = form.querySelector<HTMLElement>('[data-mode]')!;
  const text = mode.firstElementChild as HTMLElement;
  const field = form.querySelector<HTMLTextAreaElement>('textarea')!;
  const send = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  if (root.editing) {
    mode.hidden = false;
    text.textContent = 'Editing your comment';
    field.value = root.editing.text ?? '';
    send.textContent = 'Save';
  } else if (root.replyTo) {
    mode.hidden = false;
    text.textContent = `Replying to ${root.replyTo.username}`;
    send.textContent = 'Reply';
  } else {
    mode.hidden = true;
    send.textContent = 'Post';
  }
  field.placeholder = root.replyTo ? 'Write a reply' : 'Write a comment';
  field.dispatchEvent(new Event('input'));
  if (focus) {
    form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    field.focus();
  }
}

// ---- data ----------------------------------------------------------------

function toComment(json: unknown): Comment | null {
  if (!json || typeof json !== 'object') return null;
  const c = json as Record<string, unknown>;
  if (typeof c.id !== 'string') return null;
  return {
    id: c.id,
    parentId: typeof c.parentId === 'string' ? c.parentId : null,
    uid: typeof c.uid === 'string' ? c.uid : null,
    username: typeof c.username === 'string' ? c.username : '',
    html: typeof c.html === 'string' ? c.html : '',
    text: typeof c.text === 'string' ? c.text : undefined,
    createdAt: typeof c.createdAt === 'string' ? c.createdAt : '',
    editedAt: typeof c.editedAt === 'string' ? c.editedAt : null,
    status: typeof c.status === 'string' ? c.status : 'published',
    removed: c.removed === true,
    likeCount: typeof c.likeCount === 'number' ? c.likeCount : 0,
    liked: c.liked === true,
    replyCount: typeof c.replyCount === 'number' ? c.replyCount : 0,
    mine: c.mine === true,
    replies: Array.isArray(c.replies) ? c.replies.map(toComment).filter((r): r is Comment => r !== null) : [],
  };
}

function toPage(json: Record<string, unknown>): Page {
  return {
    count: typeof json.count === 'number' ? json.count : 0,
    comments: Array.isArray(json.comments) ? json.comments.map(toComment).filter((c): c is Comment => c !== null) : [],
    next: typeof json.next === 'string' ? json.next : null,
  };
}

function replaceComment(root: Root, updated: Comment) {
  const page = root.page;
  if (!page) return;
  page.comments = page.comments.map((c) =>
    c.id === updated.id
      ? { ...updated, replies: c.replies, replyCount: c.replyCount }
      : { ...c, replies: (c.replies ?? []).map((r) => (r.id === updated.id ? updated : r)) },
  );
}

async function load(root: Root) {
  root.loading = true;
  try {
    const page = toPage(await api(root.user, `/posts/${encodeURIComponent(root.postId)}/comments`));
    root.page = page;
    root.count = page.count;
    renderThread(root);
  } catch (error) {
    root.el.replaceChildren(countLine(root), el('p', 'text-sm text-muted', error instanceof Error ? error.message : 'Could not load the comments.'));
  } finally {
    root.loading = false;
  }
}

async function loadMore(root: Root) {
  const page = root.page;
  if (!page?.next) return;
  try {
    const more = toPage(await api(root.user, `/posts/${encodeURIComponent(root.postId)}/comments?after=${encodeURIComponent(page.next)}`));
    root.page = { count: more.count, comments: [...page.comments, ...more.comments], next: more.next };
    root.count = more.count;
    renderThread(root);
  } catch (error) {
    setStatus(root, error instanceof Error ? error.message : 'Could not load more.', true);
  }
}

async function moreReplies(root: Root, comment: Comment) {
  try {
    const json = await api(root.user, `/posts/${encodeURIComponent(root.postId)}/comments/${encodeURIComponent(comment.id)}/replies`);
    const replies = Array.isArray(json.replies) ? json.replies.map(toComment).filter((r): r is Comment => r !== null) : [];
    if (root.page) {
      root.page.comments = root.page.comments.map((c) => (c.id === comment.id ? { ...c, replies, replyCount: replies.length } : c));
    }
    renderThread(root);
  } catch (error) {
    setStatus(root, error instanceof Error ? error.message : 'Could not load the replies.', true);
  }
}

async function sendComment(root: Root, text: string) {
  const path = `/posts/${encodeURIComponent(root.postId)}/comments`;
  if (root.editing) {
    const json = await api(root.user, `${path}/${encodeURIComponent(root.editing.id)}`, { method: 'PATCH', body: { text } });
    const saved = toComment(json.comment);
    if (saved) {
      if (root.editing.status !== saved.status) root.count += saved.status === 'pending' ? -1 : 1;
      replaceComment(root, saved);
    }
  } else {
    const parentId = root.replyTo?.parentId ?? root.replyTo?.id;
    const json = await api(root.user, path, { method: 'POST', body: { text, parentId } });
    const saved = toComment(json.comment);
    if (saved && root.page) {
      if (saved.parentId) {
        root.page.comments = root.page.comments.map((c) =>
          c.id === saved.parentId ? { ...c, replies: [...(c.replies ?? []), saved], replyCount: c.replyCount + 1 } : c,
        );
      } else {
        root.page.comments.push(saved);
      }
      if (saved.status !== 'pending') root.count += 1;
    }
  }
  root.replyTo = null;
  root.editing = null;
  renderThread(root);
  setStatus(root, root.page?.comments.some((c) => c.status === 'pending' && c.mine) ? 'Your comment is waiting for review.' : '');
}

async function toggleLike(root: Root, comment: Comment) {
  const optimistic = { ...comment, liked: !comment.liked, likeCount: comment.likeCount + (comment.liked ? -1 : 1) };
  replaceComment(root, optimistic);
  renderThread(root);
  try {
    const json = await api(root.user, `/posts/${encodeURIComponent(root.postId)}/comments/${encodeURIComponent(comment.id)}/like`, { method: 'POST' });
    replaceComment(root, { ...optimistic, liked: json.liked === true, likeCount: typeof json.likeCount === 'number' ? json.likeCount : optimistic.likeCount });
  } catch (error) {
    replaceComment(root, comment);
    setStatus(root, error instanceof Error ? error.message : 'Could not like that.', true);
  }
  renderThread(root);
}

async function showLikes(root: Root, comment: Comment) {
  try {
    const json = await api(root.user, `/posts/${encodeURIComponent(root.postId)}/comments/${encodeURIComponent(comment.id)}/likes`);
    const names = Array.isArray(json.likes) ? json.likes.map((l) => (l as { username?: string }).username).filter(Boolean) : [];
    setStatus(root, names.length ? `Liked by ${names.join(', ')}.` : 'Nobody has liked this yet.');
  } catch (error) {
    setStatus(root, error instanceof Error ? error.message : 'Could not load that.', true);
  }
}

async function remove(root: Root, comment: Comment) {
  if (!window.confirm('Delete this comment?')) return;
  try {
    await api(root.user, `/posts/${encodeURIComponent(root.postId)}/comments/${encodeURIComponent(comment.id)}`, { method: 'DELETE' });
    const page = root.page;
    if (page) {
      if (comment.parentId) {
        page.comments = page.comments.map((c) =>
          c.id === comment.parentId ? { ...c, replies: (c.replies ?? []).filter((r) => r.id !== comment.id), replyCount: c.replyCount - 1 } : c,
        );
      } else {
        page.comments = page.comments.flatMap((c) =>
          c.id !== comment.id ? [c] : (c.replies ?? []).length ? [{ ...c, removed: true, status: 'removed', html: '', username: '' }] : [],
        );
      }
      if (comment.status !== 'pending') root.count -= 1;
    }
    if (root.editing?.id === comment.id) root.editing = null;
    renderThread(root);
  } catch (error) {
    setStatus(root, error instanceof Error ? error.message : 'Could not delete that.', true);
  }
}

async function report(root: Root, comment: Comment) {
  const reasons = COMMENTS.reportReasons;
  const choice = window.prompt(
    `Report this comment? Type a number:\n${reasons.map((r, i) => `${i + 1}. ${r.title}`).join('\n')}`,
    '',
  );
  const index = Number(choice) - 1;
  const reason = reasons[index];
  if (!reason) return;
  try {
    await api(root.user, `/posts/${encodeURIComponent(root.postId)}/comments/${encodeURIComponent(comment.id)}/report`, {
      method: 'POST',
      body: { reason: reason.value },
    });
    setStatus(root, "Thanks. We'll take a look.");
  } catch (error) {
    setStatus(root, error instanceof Error ? error.message : 'Could not report that.', true);
  }
}

// ---- wiring --------------------------------------------------------------

const roots = new WeakMap<HTMLElement, Root>();
let stopAuth: (() => void) | undefined;
let visibilityWired = false;

/** Takes over the comments container on the page, if there is one. */
export function wireComments() {
  const container = document.querySelector<HTMLElement>('[data-comments]');
  if (!container) return;
  const postId = container.dataset.post ?? '';
  const authorUid = container.dataset.author ?? '';
  const enabled = container.dataset.enabled !== 'false';
  const count = Number(container.dataset.count ?? '0') || 0;
  stopAuth?.();
  stopAuth = onAuth((user, known) => {
    if (!known) return;
    if (!enabled) {
      renderOff(container);
      return;
    }
    if (!user) {
      roots.delete(container);
      renderSignedOut(container, count);
      return;
    }
    const existing = roots.get(container);
    if (existing && existing.user.uid === user.uid) return;
    const root: Root = { el: container, postId, authorUid, enabled, count, user, page: null, replyTo: null, editing: null, loading: false };
    roots.set(container, root);
    load(root);
  });
  if (!visibilityWired) {
    visibilityWired = true;
    // Coming back to the tab refreshes the thread, so replies made
    // elsewhere show without a reload.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const current = document.querySelector<HTMLElement>('[data-comments]');
      const root = current && roots.get(current);
      if (root && !root.loading && !root.editing && !root.replyTo) load(root);
    });
  }
}
