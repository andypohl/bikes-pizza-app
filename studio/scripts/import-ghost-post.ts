/**
 * Import posts from the Ghost site into Sanity.
 *
 *   npx sanity exec scripts/import-ghost-post.ts --with-user-token -- <slug> [<slug> ...]
 *
 * Reads the Ghost Content API key from GHOST_CONTENT_API_KEY or, failing
 * that, from ../config/local.json (the app's git-ignored build config).
 * For each slug: uploads the feature image and any inline figures as assets,
 * converts the HTML body to Portable Text (figures become image blocks with
 * their captions), and creates a published `post`. Slugs already imported
 * are skipped; other failures are reported and the run continues.
 */
import { readFileSync } from 'node:fs'
import { htmlToBlocks } from '@portabletext/block-tools'
import { JSDOM } from 'jsdom'
import { createSchema } from 'sanity'
import { getCliClient } from 'sanity/cli'
import { schemaTypes } from '../schemaTypes'

const GHOST_API = 'https://pizza-predator.ghost.io'
const GHOST_SITE = 'https://www.pizzapredator.com'
const FEED_FOR_TAG: Record<string, string> = { biking: 'bikes', bikes: 'bikes', pizza: 'pizza' }

const slugs = process.argv.slice(2)
if (slugs.length === 0) throw new Error('Usage: import-ghost-post.ts <slug> [<slug> ...]')

const key =
  process.env.GHOST_CONTENT_API_KEY ??
  JSON.parse(readFileSync(new URL('../../config/local.json', import.meta.url), 'utf8'))
    .GHOST_CONTENT_API_KEY
if (!key) throw new Error('No Ghost Content API key found')

const client = getCliClient({ apiVersion: '2025-02-19' })
const blockContentType = createSchema({ name: 'default', types: schemaTypes })
  .get('post')
  .fields.find((f: { name: string }) => f.name === 'body').type

type Ghost = {
  id: string; slug: string; title: string; url: string; html?: string
  feature_image?: string; feature_image_alt?: string; custom_excerpt?: string
  published_at: string; tags?: { slug: string }[]
}

const absolute = (src: string) => new URL(src, GHOST_SITE).toString()

async function uploadImage(src: string, ghost: Ghost) {
  const url = absolute(src)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Image ${res.status} for ${url}`)
  const asset = await client.assets.upload('image', Buffer.from(await res.arrayBuffer()), {
    filename: new URL(url).pathname.split('/').pop(),
    source: { name: 'ghost', id: `${ghost.id}:${url}`, url: ghost.url },
  })
  return { _type: 'reference' as const, _ref: asset._id }
}

async function importPost(slug: string) {
  const existing = await client.fetch<string | null>(
    '*[_type == "post" && slug.current == $slug][0]._id',
    { slug },
  )
  if (existing) return `skipped (already ${existing})`

  const res = await fetch(
    `${GHOST_API}/ghost/api/content/posts/slug/${slug}/?key=${key}&include=tags&formats=html`,
  )
  if (!res.ok) throw new Error(`Ghost ${res.status}`)
  const ghost: Ghost = (await res.json()).posts[0]
  const html = ghost.html ?? ''

  // Upload inline images first; the converter's rules are synchronous.
  const dom = new JSDOM(html)
  const assetFor = new Map<string, { _type: 'reference'; _ref: string }>()
  for (const img of Array.from(dom.window.document.querySelectorAll('img'))) {
    const src = img.getAttribute('src')
    if (src && !assetFor.has(src)) assetFor.set(src, await uploadImage(src, ghost))
  }

  // Ghost tags outbound links with ?ref=<site>; that is Ghost-specific noise.
  const cleanedHtml = html.replace(/\?ref=pizzapredator\.com(?=["'&#])/g, '')
  const body = htmlToBlocks(cleanedHtml, blockContentType, {
    parseHtml: (h) => new JSDOM(h).window.document,
    rules: [
      {
        deserialize(el, _next, block) {
          const tag = (el as Element).tagName?.toLowerCase()
          const node = el as Element
          const img = tag === 'img' ? node : tag === 'figure' ? node.querySelector('img') : null
          if (!img) return undefined
          const asset = assetFor.get(img.getAttribute('src') ?? '')
          if (!asset) return undefined
          const caption = tag === 'figure' ? node.querySelector('figcaption')?.textContent?.trim() : ''
          const alt = img.getAttribute('alt')?.trim()
          return block({
            _type: 'image',
            asset,
            ...(alt ? { alt } : {}),
            ...(caption ? { caption } : {}),
          })
        },
      },
    ],
  })

  const mainImage = ghost.feature_image
    ? {
        _type: 'image',
        asset: await uploadImage(ghost.feature_image, ghost),
        ...(ghost.feature_image_alt ? { alt: ghost.feature_image_alt } : {}),
      }
    : undefined

  const tags = (ghost.tags ?? []).map((t) => t.slug)
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
  const images = body.filter((b: { _type: string }) => b._type === 'image').length
  return `created ${doc._id} (${feed}, ${body.length} blocks, ${images} inline images)`
}

let failed = 0
for (const slug of slugs) {
  try {
    console.log(`${slug}: ${await importPost(slug)}`)
  } catch (err) {
    failed++
    console.error(`${slug}: FAILED ${(err as Error).message}`)
  }
}
if (failed) process.exitCode = 1
