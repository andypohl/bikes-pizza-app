import { defineField, defineType } from 'sanity'
import { DocumentTextIcon } from '@sanity/icons/DocumentText'

/** A bikes.pizza post. `feed` is what the app's tabs filter on. */
export const post = defineType({
  name: 'post',
  title: 'Post',
  type: 'document',
  icon: DocumentTextIcon,
  fields: [
    defineField({
      name: 'title',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'slug',
      type: 'slug',
      options: { source: 'title', maxLength: 96 },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'feed',
      title: 'Feed',
      type: 'string',
      options: {
        list: [
          { title: 'Bikes', value: 'bikes' },
          { title: 'Pizza', value: 'pizza' },
          { title: 'Blog', value: 'blog' },
        ],
        layout: 'radio',
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'publishedAt',
      title: 'Published at',
      type: 'datetime',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'mainImage',
      title: 'Main image',
      type: 'image',
      options: { hotspot: true },
      fields: [
        defineField({ name: 'alt', type: 'string', title: 'Alternative text' }),
      ],
    }),
    defineField({
      name: 'excerpt',
      type: 'text',
      rows: 3,
      description: 'Short summary shown in lists. Leave empty to use the start of the body.',
    }),
    defineField({
      name: 'body',
      type: 'blockContent',
    }),
    defineField({
      name: 'submittedBy',
      title: 'Submitted by',
      type: 'string',
      description: 'Name given by a member who submitted this through the app, if any.',
    }),
    defineField({
      name: 'source',
      title: 'Imported from',
      type: 'object',
      description: 'Where this post lived before Sanity. Empty for posts written here.',
      options: { collapsible: true, collapsed: true },
      fields: [
        defineField({ name: 'system', type: 'string', options: { list: ['ghost', 'submission'] } }),
        defineField({ name: 'id', type: 'string' }),
        defineField({ name: 'url', type: 'url' }),
      ],
    }),
  ],
  orderings: [
    {
      title: 'Newest first',
      name: 'publishedAtDesc',
      by: [{ field: 'publishedAt', direction: 'desc' }],
    },
  ],
  preview: {
    select: { title: 'title', subtitle: 'feed', media: 'mainImage' },
  },
})
