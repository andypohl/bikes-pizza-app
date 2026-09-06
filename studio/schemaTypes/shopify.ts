import { defineField, defineType } from 'sanity'
import { BasketIcon } from '@sanity/icons/Basket'
import { TagIcon } from '@sanity/icons/Tag'
import { PackageIcon } from '@sanity/icons/Package'

/**
 * Documents written by Sanity Connect for Shopify: one per product, product
 * variant and collection in the store, everything under `store`. Shopify is
 * the source of truth and each sync overwrites `store`, so it is read-only
 * here; the website reads it at build time. Shapes follow
 * https://www.sanity.io/docs/apis-and-sdks/sanity-connect-for-shopify-reference
 */

const shopifyStatus = defineField({
  name: 'status',
  type: 'string',
  options: { list: ['active', 'archived', 'draft', 'unlisted', 'unknown'] },
})

export const product = defineType({
  name: 'product',
  title: 'Product',
  type: 'document',
  icon: BasketIcon,
  readOnly: true,
  description: 'Synced from Shopify by Sanity Connect; edit it in Shopify.',
  fields: [
    defineField({
      name: 'store',
      title: 'Shopify',
      type: 'object',
      fields: [
        defineField({ name: 'id', type: 'number' }),
        defineField({ name: 'gid', type: 'string' }),
        defineField({ name: 'title', type: 'string' }),
        defineField({ name: 'slug', type: 'slug' }),
        shopifyStatus,
        defineField({ name: 'isDeleted', type: 'boolean' }),
        defineField({ name: 'productType', type: 'string' }),
        defineField({ name: 'vendor', type: 'string' }),
        defineField({ name: 'tags', type: 'string' }),
        defineField({ name: 'descriptionHtml', type: 'text' }),
        defineField({ name: 'previewImageUrl', type: 'url' }),
        defineField({
          name: 'priceRange',
          type: 'object',
          fields: [
            defineField({ name: 'minVariantPrice', type: 'number' }),
            defineField({ name: 'maxVariantPrice', type: 'number' }),
          ],
        }),
        defineField({
          name: 'options',
          type: 'array',
          of: [
            {
              type: 'object',
              name: 'option',
              fields: [
                defineField({ name: 'name', type: 'string' }),
                defineField({ name: 'values', type: 'array', of: [{ type: 'string' }] }),
              ],
            },
          ],
        }),
        defineField({
          name: 'variants',
          type: 'array',
          of: [{ type: 'reference', to: [{ type: 'productVariant' }], weak: true }],
        }),
        defineField({ name: 'createdAt', type: 'string' }),
        defineField({ name: 'updatedAt', type: 'string' }),
        defineField({ name: 'shopifyTriggeredAt', type: 'string' }),
        defineField({
          name: 'shop',
          type: 'object',
          fields: [defineField({ name: 'domain', type: 'string' })],
        }),
      ],
    }),
  ],
  preview: {
    select: { title: 'store.title', subtitle: 'store.status', media: 'store.previewImageUrl' },
    prepare: ({ title, subtitle }) => ({ title, subtitle }),
  },
})

export const productVariant = defineType({
  name: 'productVariant',
  title: 'Product variant',
  type: 'document',
  icon: TagIcon,
  readOnly: true,
  description: 'Synced from Shopify by Sanity Connect; edit it in Shopify.',
  fields: [
    defineField({
      name: 'store',
      title: 'Shopify',
      type: 'object',
      fields: [
        defineField({ name: 'id', type: 'number' }),
        defineField({ name: 'gid', type: 'string' }),
        defineField({ name: 'productId', type: 'number' }),
        defineField({ name: 'productGid', type: 'string' }),
        defineField({ name: 'title', type: 'string' }),
        shopifyStatus,
        defineField({ name: 'isDeleted', type: 'boolean' }),
        defineField({ name: 'sku', type: 'string' }),
        defineField({ name: 'barcode', type: 'string' }),
        defineField({ name: 'price', type: 'number' }),
        defineField({ name: 'compareAtPrice', type: 'number' }),
        defineField({ name: 'option1', type: 'string' }),
        defineField({ name: 'option2', type: 'string' }),
        defineField({ name: 'option3', type: 'string' }),
        defineField({ name: 'previewImageUrl', type: 'url' }),
        defineField({
          name: 'inventory',
          type: 'object',
          fields: [
            defineField({ name: 'isAvailable', type: 'boolean' }),
            defineField({ name: 'policy', type: 'string' }),
          ],
        }),
        defineField({ name: 'createdAt', type: 'string' }),
        defineField({ name: 'updatedAt', type: 'string' }),
        defineField({
          name: 'shop',
          type: 'object',
          fields: [defineField({ name: 'domain', type: 'string' })],
        }),
      ],
    }),
  ],
  preview: {
    select: { title: 'store.title', price: 'store.price' },
    prepare: ({ title, price }) => ({ title, subtitle: price == null ? undefined : `$${price}` }),
  },
})

export const collection = defineType({
  name: 'collection',
  title: 'Collection',
  type: 'document',
  icon: PackageIcon,
  readOnly: true,
  description: 'Synced from Shopify by Sanity Connect; edit it in Shopify.',
  fields: [
    defineField({
      name: 'store',
      title: 'Shopify',
      type: 'object',
      fields: [
        defineField({ name: 'id', type: 'number' }),
        defineField({ name: 'gid', type: 'string' }),
        defineField({ name: 'title', type: 'string' }),
        defineField({ name: 'slug', type: 'slug' }),
        defineField({ name: 'isDeleted', type: 'boolean' }),
        defineField({ name: 'descriptionHtml', type: 'text' }),
        defineField({ name: 'imageUrl', type: 'url' }),
        defineField({ name: 'sortOrder', type: 'string' }),
        defineField({ name: 'createdAt', type: 'string' }),
        defineField({ name: 'updatedAt', type: 'string' }),
        defineField({
          name: 'shop',
          type: 'object',
          fields: [defineField({ name: 'domain', type: 'string' })],
        }),
      ],
    }),
  ],
  preview: { select: { title: 'store.title' } },
})
