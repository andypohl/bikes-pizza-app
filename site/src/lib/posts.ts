// The posts the site is built from: the `posts` collection in Firestore,
// read once per build over REST (see firestore.ts), with their photos
// served from Cloud Storage as the renditions the functions made when the
// post was published (functions/renditions.js). The document shape is
// described in functions/post.js.
import {
  ARTICLE_FEEDS,
  BIKE_COLORS,
  BIKE_TYPES,
  BIKE_YEARS,
  FEED_LABELS,
  GALLERY_FEEDS,
  PIZZA_STYLES,
  postPath as contractPostPath,
  type Option,
} from './contract';
import { query, type Document } from './firestore';

export { FEED_LABELS };

/**
 * The feed read as full articles at /news/. News stays out of the gallery
 * (the front page, the category pages and the member pages) and may go
 * without a photo.
 */
export const NEWS_FEED = ARTICLE_FEEDS[0];

/** A post's photo: where its renditions are and which sizes exist. */
export interface PostImage {
  /** URL prefix a rendition's file name is appended to. */
  base: string;
  version: string;
  /** Of the original, after rotation. */
  width: number;
  height: number;
  /** Widths of the renditions, smallest first; the last is the largest available. */
  sizes: number[];
  formats: string[];
  /** A tiny data: URL shown while a rendition loads. */
  blur: string | null;
  /** Where the subject is, 0..1 from the top left; crops are placed around it. */
  focus: { x: number; y: number };
}

/** The member credited with a post, as recorded on the post when it was published. */
export interface Credit {
  uid: string;
  username: string;
  name: string;
}

export interface Post {
  /** The slug, which is the document id. */
  id: string;
  title: string;
  feed: string;
  publishedAt: string;
  /** One line for cards and meta descriptions. */
  summary: string;
  /** The body rendered to sanitized HTML when the post was written. */
  html: string;
  /** Null only for a news post without a photo. */
  image: PostImage | null;
  /** Additional pictures, in order; empty for most posts. */
  images: PostImage[];
  /** Bike or pizza details as stored option values (`brand`, `year`, `color`, `type`; `style`), or null. */
  details: Record<string, string> | null;
  credit: Credit | null;
  /** Published comments at build time; the page fetches the live thread. */
  commentCount: number;
  /** False when the post's author switched comments off. */
  commentsEnabled: boolean;
}

/** A post in the gallery: not news, and always with a photo. */
export type GalleryPost = Post & { image: PostImage };

const str = (value: unknown) => (typeof value === 'string' ? value : '');
const num = (value: unknown) => (typeof value === 'number' ? value : 0);
const record = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : null);

function toImage(value: unknown): PostImage | null {
  const image = record(value);
  if (!image || !str(image.base)) return null;
  const focus = record(image.focus);
  return {
    base: str(image.base),
    version: str(image.version),
    width: num(image.width),
    height: num(image.height),
    sizes: Array.isArray(image.sizes) ? image.sizes.map(num).filter(Boolean) : [],
    formats: Array.isArray(image.formats) ? image.formats.map(str) : [],
    blur: str(image.blur) || null,
    focus: { x: focus ? num(focus.x) : 0.5, y: focus ? num(focus.y) : 0.5 },
  };
}

function toPost(doc: Document): Post {
  const credit = record(doc.credit);
  const details = record(doc.details);
  return {
    id: doc.id,
    title: str(doc.title),
    feed: str(doc.feed),
    publishedAt: str(doc.publishedAt),
    summary: str(doc.summary),
    html: str(doc.html),
    image: toImage(doc.image),
    images: Array.isArray(doc.images) ? doc.images.map(toImage).filter((image): image is PostImage => image !== null) : [],
    details: details ? Object.fromEntries(Object.entries(details).map(([k, v]) => [k, str(v)])) : null,
    credit: credit ? { uid: str(credit.uid), username: str(credit.username), name: str(credit.name) } : null,
    commentCount: num(doc.commentCount),
    commentsEnabled: doc.commentsEnabled !== false,
  };
}

let cache: Promise<Post[]> | undefined;

/** Every published post, newest first. Fetched once per build. */
export function getPosts(): Promise<Post[]> {
  cache ??= query('posts', [{ field: 'status', op: 'EQUAL', value: 'published' }]).then((docs) =>
    docs
      .map(toPost)
      .filter((post) => post.title && post.feed && post.publishedAt)
      .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0)),
  );
  return cache;
}

export function isNews(post: Post): boolean {
  return post.feed === NEWS_FEED;
}

/** The gallery, newest first: every post but the news. */
export async function getGalleryPosts(): Promise<GalleryPost[]> {
  return (await getPosts()).filter((post): post is GalleryPost => !isNews(post) && post.image !== null);
}

/** The news, newest first. */
export async function getNewsPosts(): Promise<Post[]> {
  return (await getPosts()).filter(isNews);
}

/** Articles per page of the news feed; the feed fetches a page at a time as the reader scrolls. */
export const NEWS_PAGE_SIZE = 5;

/** The news split into pages of NEWS_PAGE_SIZE, page 1 first. */
export function newsPages(news: Post[]): Post[][] {
  const pages: Post[][] = [];
  for (let i = 0; i < news.length; i += NEWS_PAGE_SIZE) pages.push(news.slice(i, i + NEWS_PAGE_SIZE));
  return pages;
}

export function categoryOf(post: Post): string {
  return FEED_LABELS[post.feed] ?? post.feed;
}

/** Path of a post's own page: news articles live under /news/, the gallery under /post/. */
export function postPath(post: Post): string {
  return contractPostPath(post.feed, post.id);
}

/** Path of a member's page: their username lowercased, as usernames that differ only by case are one name. */
export function memberPath(credit: Credit): string {
  return `/member/${credit.username.toLowerCase()}/`;
}

/** The credit line for a post: the member's username, else the name typed at submission. */
export function creditOf(post: Post): string | null {
  return post.credit?.username || post.credit?.name || null;
}

export interface Spec {
  label: string;
  value: string;
}

const titleOf = (options: Option[], value: string) => options.find((option) => option.value === value)?.title ?? value;

/**
 * The structured details of a post as labelled display values, in the
 * order they are shown: brand, year, color and type for a bike, the style
 * for a pizza. Empty when none are filled in.
 */
export function detailSpecs(post: Post): Spec[] {
  const specs: Spec[] = [];
  const details = post.details ?? {};
  if (post.feed === 'bikes') {
    if (details.brand) specs.push({ label: 'Brand', value: details.brand });
    if (details.year) specs.push({ label: 'Year', value: titleOf(BIKE_YEARS, details.year) });
    if (details.color) specs.push({ label: 'Color', value: titleOf(BIKE_COLORS, details.color) });
    if (details.type) specs.push({ label: 'Type', value: titleOf(BIKE_TYPES, details.type) });
  } else if (post.feed === 'pizza' && details.style) {
    specs.push({ label: 'Style', value: titleOf(PIZZA_STYLES, details.style) });
  }
  return specs;
}

/** One line of details for tiles: "GT · Mountain · 1990s" for a bike, the style for a pizza. */
export function detailLine(post: Post): string | null {
  const details = post.details ?? {};
  if (post.feed === 'pizza') return details.style ? titleOf(PIZZA_STYLES, details.style) : null;
  if (post.feed !== 'bikes') return null;
  const parts = [details.brand, details.type && titleOf(BIKE_TYPES, details.type), details.year && titleOf(BIKE_YEARS, details.year)];
  const line = parts.filter((part): part is string => !!part).join(' · ');
  return line || null;
}

/**
 * Every member with at least one post that carries their username, with
 * their posts newest first. Members who have not chosen a username yet
 * have no page; their posts show the typed name instead.
 */
export function membersOf(posts: GalleryPost[]): { credit: Credit; posts: GalleryPost[] }[] {
  const byUid = new Map<string, { credit: Credit; posts: GalleryPost[] }>();
  for (const post of posts) {
    if (!post.credit?.uid || !post.credit.username) continue;
    const entry = byUid.get(post.credit.uid) ?? { credit: post.credit, posts: [] };
    entry.posts.push(post);
    byUid.set(post.credit.uid, entry);
  }
  return [...byUid.values()];
}

/**
 * The gallery's category pages, in the order the filter shows them. Every
 * feed has one, whether or not it has posts yet. The filter also links to
 * the news, which has its own page rather than a category.
 */
export const CATEGORY_FEEDS = GALLERY_FEEDS;
export const CATEGORIES = CATEGORY_FEEDS.map((feed) => FEED_LABELS[feed]);

/** Feeds whose newest post is featured on the front page, in row order. */
export const FEATURED_FEEDS = GALLERY_FEEDS;

/**
 * Splits `posts` (newest first) into the newest post of each of `feeds`,
 * in that order, and everything else in the original order.
 */
export function splitFeatured(
  posts: GalleryPost[],
  feeds: string[] = FEATURED_FEEDS,
): { featured: GalleryPost[]; rest: GalleryPost[] } {
  const featured = feeds
    .map((feed) => posts.find((post) => post.feed === feed))
    .filter((post): post is GalleryPost => !!post);
  const ids = new Set(featured.map((post) => post.id));
  return { featured, rest: posts.filter((post) => !ids.has(post.id)) };
}

/** Short text for cards and meta descriptions. */
export function summaryOf(post: Post, max = 160): string {
  const text = post.summary.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Width over height of gallery tiles; nearly every photo is shot 4:3. */
export const TILE_RATIO = 4 / 3;

/** The URL of one rendition, e.g. `800.webp`. */
export function renditionUrl(image: PostImage, name: string): string {
  return `${image.base}${encodeURIComponent(name)}?alt=media`;
}

/** The widest rendition no wider than `max` (the widest of all without it). */
export function widthUpTo(image: PostImage, max = Infinity): number {
  const fitting = image.sizes.filter((w) => w <= max);
  return fitting.length ? fitting[fitting.length - 1] : image.sizes[0];
}

/**
 * `src` and `srcset` over every rendition of a photo, so the browser picks
 * the size that fits the slot described by the `sizes` attribute. WebP
 * throughout; the JPEG renditions are for the app and for link previews.
 */
export function responsive(image: PostImage, format = 'webp') {
  const url = (w: number) => renditionUrl(image, `${w}.${format}`);
  return {
    src: url(widthUpTo(image)),
    srcset: image.sizes.map((w) => `${url(w)} ${w}w`).join(', '),
  };
}

/** A JPEG of the photo for Open Graph cards, which want at most about 1200px. */
export function previewUrl(image: PostImage): string {
  return renditionUrl(image, `${widthUpTo(image, 1200)}.jpg`);
}

/** CSS `object-position` that keeps the photo's focus in view when it is cropped to a tile. */
export function focusPosition(image: PostImage): string {
  return `${Math.round(image.focus.x * 100)}% ${Math.round(image.focus.y * 100)}%`;
}
