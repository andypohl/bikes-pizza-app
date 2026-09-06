import { sanityClient } from 'sanity:client';
import { createImageUrlBuilder } from '@sanity/image-url';
import type { SanityImageSource } from '@sanity/image-url/lib/types/types';
import { defineQuery } from 'groq';
import { BIKE_COLORS, BIKE_TYPES, BIKE_YEARS, type Option } from '../../../studio/schemaTypes/bikeOptions';
import { PIZZA_STYLES } from '../../../studio/schemaTypes/pizzaOptions';

/** Human labels for the `feed` field; these double as the gallery categories. */
export const FEED_LABELS: Record<string, string> = {
  bikes: 'Bikes',
  pizza: 'Pizza',
  blog: 'Blog',
};

export interface PostImage {
  asset: { _ref: string };
  hotspot?: unknown;
  crop?: unknown;
  alt: string;
  width: number;
  height: number;
  lqip?: string;
}

/** The member who submitted a post, from their `member` document. */
export interface Author {
  id: string;
  username: string;
}

/** The structured details of a bike post, as the stored option values. */
export interface BikeDetails {
  brand: string | null;
  year: string | null;
  color: string | null;
  type: string | null;
}

/** The structured details of a pizza post, as the stored option values. */
export interface PizzaDetails {
  style: string | null;
}

export interface Post {
  id: string;
  title: string;
  feed: string;
  publishedAt: string;
  excerpt: string | null;
  plain: string;
  body: unknown[];
  image: PostImage;
  /** The credit typed at submission; the fallback when there is no author. */
  submittedBy: string | null;
  author: Author | null;
  /** Filled in for bike posts through the Post details app; null otherwise. */
  bike: BikeDetails | null;
  /** Filled in for pizza posts through the Post details app; null otherwise. */
  pizza: PizzaDetails | null;
}

const POSTS_QUERY = defineQuery(`
  *[_type == "post" && defined(slug.current) && defined(mainImage.asset)]
    | order(publishedAt desc) {
    "id": slug.current,
    title,
    feed,
    publishedAt,
    excerpt,
    "plain": pt::text(body),
    body,
    submittedBy,
    "author": author->{ "id": _id, "username": coalesce(username, "") },
    "bike": bike { brand, year, color, type },
    "pizza": pizza { style },
    "image": mainImage {
      asset,
      hotspot,
      crop,
      "alt": coalesce(alt, ^.title),
      "width": asset->metadata.dimensions.width,
      "height": asset->metadata.dimensions.height,
      "lqip": asset->metadata.lqip
    }
  }
`);

let cache: Promise<Post[]> | undefined;

/** Every published post, newest first. Fetched once per build. */
export function getPosts(): Promise<Post[]> {
  cache ??= sanityClient.fetch<Post[]>(POSTS_QUERY);
  return cache;
}

export function categoryOf(post: Post): string {
  return FEED_LABELS[post.feed] ?? post.feed;
}

/** Path of a member's page: their username lowercased, as usernames differ only by case are one name. */
export function memberPath(author: Author): string {
  return `/member/${author.username.toLowerCase()}/`;
}

/** The credit line for a post: the member's current username, else the text typed at submission. */
export function creditOf(post: Post): string | null {
  return post.author?.username || post.submittedBy || null;
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
  if (post.feed === 'bikes' && post.bike) {
    const bike = post.bike;
    if (bike.brand) specs.push({ label: 'Brand', value: bike.brand });
    if (bike.year) specs.push({ label: 'Year', value: titleOf(BIKE_YEARS, bike.year) });
    if (bike.color) specs.push({ label: 'Color', value: titleOf(BIKE_COLORS, bike.color) });
    if (bike.type) specs.push({ label: 'Type', value: titleOf(BIKE_TYPES, bike.type) });
  } else if (post.feed === 'pizza' && post.pizza?.style) {
    specs.push({ label: 'Style', value: titleOf(PIZZA_STYLES, post.pizza.style) });
  }
  return specs;
}

/** One line of details for tiles: "GT · Mountain · 1990s" for a bike, the style for a pizza. */
export function detailLine(post: Post): string | null {
  if (post.feed === 'pizza') {
    const style = post.pizza?.style;
    return style ? titleOf(PIZZA_STYLES, style) : null;
  }
  const bike = post.feed === 'bikes' ? post.bike : null;
  if (!bike) return null;
  const parts = [bike.brand, bike.type && titleOf(BIKE_TYPES, bike.type), bike.year && titleOf(BIKE_YEARS, bike.year)];
  const line = parts.filter((part): part is string => !!part).join(' · ');
  return line || null;
}

/**
 * Every member with at least one post that carries their username, with
 * their posts newest first. Members who have not chosen a username yet
 * have no page; their posts show the typed credit instead.
 */
export function membersOf(posts: Post[]): { author: Author; posts: Post[] }[] {
  const byId = new Map<string, { author: Author; posts: Post[] }>();
  for (const post of posts) {
    if (!post.author?.username) continue;
    const entry = byId.get(post.author.id) ?? { author: post.author, posts: [] };
    entry.posts.push(post);
    byId.set(post.author.id, entry);
  }
  return [...byId.values()];
}

/**
 * The category pages, in the order the filter shows them. Every feed has
 * one, whether or not it has posts yet, so the Blog page exists before the
 * first blog post.
 */
export const CATEGORY_FEEDS = ['bikes', 'pizza', 'blog'];
export const CATEGORIES = CATEGORY_FEEDS.map((feed) => FEED_LABELS[feed]);

/** Feeds whose newest post is featured on the front page, in row order. */
export const FEATURED_FEEDS = ['bikes', 'pizza'];

/**
 * Splits `posts` (newest first) into the newest post of each of `feeds`,
 * in that order, and everything else in the original order.
 */
export function splitFeatured(posts: Post[], feeds: string[] = FEATURED_FEEDS): { featured: Post[]; rest: Post[] } {
  const featured = feeds.map((feed) => posts.find((post) => post.feed === feed)).filter((post): post is Post => !!post);
  const ids = new Set(featured.map((post) => post.id));
  return { featured, rest: posts.filter((post) => !ids.has(post.id)) };
}

/** Short text for cards and meta descriptions. */
export function summaryOf(post: Post, max = 160): string {
  const text = (post.excerpt ?? post.plain ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const builder = createImageUrlBuilder(sanityClient);

export function urlFor(source: SanityImageSource) {
  return builder.image(source).auto('format');
}

/** Width over height of gallery tiles; nearly every photo is shot 4:3. */
export const TILE_RATIO = 4 / 3;

/**
 * `src` and `srcset` for an image at the given widths. With `ratio` the
 * image is cropped to that width/height ratio on Sanity's CDN, which
 * respects the hotspot set in the Studio.
 */
export function responsive(image: SanityImageSource, widths: number[], quality = 80, ratio?: number) {
  const url = (w: number) => {
    const b = urlFor(image).width(w).quality(quality);
    return (ratio ? b.height(Math.round(w / ratio)).fit('crop') : b).url();
  };
  const srcset = widths.map((w) => `${url(w)} ${w}w`).join(', ');
  return { src: url(widths[widths.length - 1]), srcset };
}
