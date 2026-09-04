/**
 * Import one post from the Ghost site into Sanity.
 *
 *   npx sanity exec scripts/import-ghost-post.ts --with-user-token -- <slug>
 *
 * Reads the Ghost Content API key from GHOST_CONTENT_API_KEY or, failing
 * that, from ../config/local.json (the app's git-ignored build config).
 * Uploads the feature image as an asset, converts the HTML body to Portable
 * Text, and creates a published `post`. Refuses to import a slug twice.
 */
import { readFileSync } from 'node:fs'
import { htmlToBlocks } from '@portabletext/block-tools'
import { JSDOM } from 'jsdom'
import { createSchema } from 'sanity'
import { getCliClient } from 'sanity/cli'
import { schemaTypes } from '../schemaTypes'

const GHOST_URL = 'https://pizza-predator.ghost.io'
const FEED_FOR_TAG: Record<string, string> = { biking: 'bikes', bikes: 'bikes', pizza: 'pizza' }

const slug = process.argv[2]
if (!slug) throw new Error('Usage: import-ghost-post.ts <slug>')

const key =
  process.env.GHOST_CONTENT_API_KEY ??
  JSON.parse(readFileSync(new URL('../../config/local.json', import.meta.url), 'utf8'))
    .GHOST_CONTENT_API_KEY
if (!key) throw new Error('No Ghost Content API key found')

const client = getCliClient({ apiVersion: '2025-02-19' })

const existing = await client.fetch<string | null>(
  '*[_type == "post" && slug.current == $slug][0]._id',
  { slug },
)
if (existing) throw new Error(`Already imported as ${existing}`)

const res = await fetch(
  `${GHOST_URL}/ghost/api/content/posts/slug/${slug}/?key=${key}&include=tags,authors&formats=html`,
)
if (!res.ok) throw new Error(`Ghost ${res.status}`)
const ghost = (await res.json()).posts[0]

// Portable Text conversion, driven by the Studio's own blockContent type.
const blockContentType = createSchema({ name: 'default', types: schemaTypes })
  .get('post')
  .fields.find((f: { name: string }) => f.name === 'body').type
const body = htmlToBlocks(ghost.html ?? '', blockContentType, {
  parseHtml: (html) => new JSDOM(html).window.document,
})

let mainImage: unknown
if (ghost.feature_image) {
  const img = await fetch(ghost.feature_image)
  if (!img.ok) throw new Error(`Image ${img.status}`)
  const asset = await client.assets.upload('image', Buffer.from(await img.arrayBuffer()), {
    filename: ghost.feature_image.split('/').pop(),
    source: { name: 'ghost', id: ghost.id, url: ghost.url },
  })
  mainImage = {
    _type: 'image',
    asset: { _type: 'reference', _ref: asset._id },
    ...(ghost.feature_image_alt ? { alt: ghost.feature_image_alt } : {}),
  }
}

const tags: string[] = (ghost.tags ?? []).map((t: { slug: string }) => t.slug)
const feed = tags.map((t) => FEED_FOR_TAG[t]).find(Boolean) ?? 'blog'

const doc = await client.create({
  _type: 'post',
  title: ghost.title,
  slug: { _type: 'slug', current: ghost.slug },
  feed,
  publishedAt: new Date(ghost.published_at).toISOString(),
  ...(mainImage ? { mainImage } : {}),
  ...(ghost.custom_excerpt ? { excerpt: ghost.custom_excerpt } : {}),
  body,
  source: { system: 'ghost', id: ghost.id, url: ghost.url },
})
console.log(`Created ${doc._id}: "${doc.title}" (${feed}, ${body.length} blocks)`)
