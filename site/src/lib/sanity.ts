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

/** `src` and `srcset` for an image at the given widths. */
export function responsive(image: SanityImageSource, widths: number[], quality = 80) {
  const srcset = widths
    .map((w) => `${urlFor(image).width(w).quality(quality).url()} ${w}w`)
    .join(', ');
  const src = urlFor(image).width(widths[widths.length - 1]).quality(quality).url();
  return { src, srcset };
}
