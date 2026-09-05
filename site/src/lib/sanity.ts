import { sanityClient } from 'sanity:client';
import { createImageUrlBuilder } from '@sanity/image-url';
import type { SanityImageSource } from '@sanity/image-url/lib/types/types';
import { defineQuery } from 'groq';

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

export interface Post {
  id: string;
  title: string;
  feed: string;
  publishedAt: string;
  excerpt: string | null;
  plain: string;
  body: unknown[];
  image: PostImage;
  submittedBy: string | null;
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
