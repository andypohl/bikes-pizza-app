// The search page (/search/?q=…): one request to the public
// `GET /api/search` (docs/api.md, "Search") when the page opens with a
// query, rendered as the API ranks it: members whose username starts
// with what was typed, posts whose title matches, posts whose bike or
// pizza details match, and posts whose story does, each with a line of
// the story around the matching word. Nothing is sent while typing; the
// form on the page (and the one in the top bar) is a plain GET.
import { API_URL } from '../lib/api';
import { detailLine, focusPosition, renditionUrl, widthUpTo, categoryOf, type Post, type PostImage } from '../lib/posts';
import { formatDate } from '../utils/format';

/** A post as the search endpoint lists it: the summary fields plus its page's URL. */
export type Hit = {
  id: string;
  feed: string;
  title: string;
  publishedAt: string;
  url: string;
  summary: string;
  image: PostImage | null;
  details: Record<string, string> | null;
  snippet?: string;
};

export type Results = {
  query: string;
  members: string[];
  titles: Hit[];
  details: Hit[];
  text: Hit[];
};

/** Per group; the endpoint allows up to 50. */
export const LIMIT = 30;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

function hitOf(json: unknown): Hit | null {
  if (!json || typeof json !== 'object') return null;
  const p = json as Record<string, unknown>;
  if (typeof p.id !== 'string' || typeof p.title !== 'string' || typeof p.url !== 'string') return null;
  const image = p.image && typeof p.image === 'object' && typeof (p.image as PostImage).base === 'string' ? (p.image as PostImage) : null;
  return {
    id: p.id,
    feed: typeof p.feed === 'string' ? p.feed : '',
    title: p.title,
    publishedAt: typeof p.publishedAt === 'string' ? p.publishedAt : '',
    url: p.url,
    summary: typeof p.summary === 'string' ? p.summary : '',
    image: image && Array.isArray(image.sizes) && image.sizes.length ? image : null,
    details: p.details && typeof p.details === 'object' ? (p.details as Record<string, string>) : null,
    snippet: typeof p.snippet === 'string' ? p.snippet : undefined,
  };
}

/** Asks the API; null when it cannot be reached or answers with an error. */
export async function fetchResults(query: string): Promise<Results | null> {
  try {
    const url = `${API_URL}/api/search?q=${encodeURIComponent(query)}&limit=${LIMIT}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    const hits = (list: unknown) => (Array.isArray(list) ? list.map(hitOf).filter((h): h is Hit => h !== null) : []);
    return {
      query: typeof json.query === 'string' ? json.query : query,
      members: Array.isArray(json.members)
        ? json.members.map((m) => (m && typeof m === 'object' ? (m as { username?: unknown }).username : null)).filter((u): u is string => typeof u === 'string')
        : [],
      titles: hits(json.titles),
      details: hits(json.details),
      text: hits(json.text),
    };
  } catch {
    return null;
  }
}

function heading(text: string) {
  return el('h2', 'mt-8 mb-2 text-sm font-medium tracking-wide text-spice uppercase', text);
}

function memberRow(username: string) {
  const link = el('a', 'flex items-center gap-3 py-2 text-ink hover:text-spice transition-colors');
  link.href = `/member/${username.toLowerCase()}/`;
  const icon = el('span', 'inline-flex h-9 w-9 items-center justify-center rounded-full bg-pill text-sm font-medium', username.slice(0, 1).toUpperCase());
  link.append(icon, el('span', 'font-light', username));
  return link;
}

function postRow(hit: Hit) {
  const link = el('a', 'group flex items-center gap-4 py-3');
  link.href = hit.url;
  if (hit.image) {
    const img = el('img', 'w-28 h-20 shrink-0 rounded-md object-cover bg-surface-2');
    img.src = renditionUrl(hit.image, `${widthUpTo(hit.image, 400)}.webp`);
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.style.objectPosition = focusPosition(hit.image);
    link.append(img);
  } else {
    link.append(el('span', 'w-28 h-20 shrink-0 rounded-md bg-surface-2'));
  }
  const text = el('span', 'min-w-0');
  text.append(el('span', 'block text-lg font-light text-ink group-hover:text-spice transition-colors', hit.title));
  const post = hit as unknown as Post;
  const meta = [categoryOf(post), hit.publishedAt ? formatDate(hit.publishedAt) : '', detailLine(post) ?? ''].filter(Boolean).join(' · ');
  if (meta) text.append(el('span', 'block text-sm text-muted font-light', meta));
  if (hit.snippet) text.append(el('span', 'block mt-1 text-sm text-muted font-light italic', hit.snippet));
  link.append(text);
  return link;
}

/** Renders `results` into `container`, replacing what was there. */
export function render(container: HTMLElement, results: Results) {
  container.replaceChildren();
  const groups: [string, HTMLElement[]][] = [
    ['Members', results.members.map(memberRow)],
    ['Matching titles', results.titles.map(postRow)],
    ['Matching details', results.details.map(postRow)],
    ['In the story', results.text.map(postRow)],
  ];
  let any = false;
  for (const [title, rows] of groups) {
    if (!rows.length) continue;
    any = true;
    container.append(heading(title));
    const list = el('div', 'divide-y divide-line');
    list.append(...rows);
    container.append(list);
  }
  if (!any) {
    container.append(el('p', 'text-muted font-light', `Nothing matched "${results.query}". A story only matches whole words.`));
  }
}

/** Reads the query from the URL, fills the page's box, and shows the results. */
export async function wireSearch() {
  const container = document.querySelector<HTMLElement>('[data-search-results]');
  if (!container) return;
  const query = (new URLSearchParams(location.search).get('q') ?? '').trim();
  const box = document.querySelector<HTMLInputElement>('main [data-search-input]');
  if (box) box.value = query;
  if (!query) {
    container.replaceChildren();
    box?.focus();
    return;
  }
  document.title = `${query} | Search | bikes.pizza`;
  container.replaceChildren(el('p', 'text-muted font-light', 'Searching…'));
  const results = await fetchResults(query);
  if ((new URLSearchParams(location.search).get('q') ?? '').trim() !== query) return;
  if (!results) {
    const p = el('p', 'text-muted font-light', 'Search is not available right now. ');
    const again = el('a', 'underline underline-offset-2 hover:text-spice', 'Try again');
    again.href = location.href;
    p.append(again);
    container.replaceChildren(p);
    return;
  }
  render(container, results);
}
