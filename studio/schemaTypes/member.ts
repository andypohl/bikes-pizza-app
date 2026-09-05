import { defineField, defineType } from 'sanity'
import { UserIcon } from '@sanity/icons/User'

/**
 * A bikes.pizza member, as far as the website needs to know: the stable
 * account id and the current username. Posts submitted through the app
 * reference one of these, so a username change shows on every post at
 * the next build without touching the posts.
 *
 * Written by the submission functions (created on first publish, username
 * kept in step from the account page). Read-only here: the account is the
 * source of truth, and the email never comes here.
 */
export const member = defineType({
  name: 'member',
  title: 'Member',
  type: 'document',
  icon: UserIcon,
  readOnly: true,
  description: 'Mirrors an account; managed by the app, not editable here.',
  fields: [
    defineField({
      name: 'uid',
      title: 'Account id',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'username',
      type: 'string',
      description: 'Empty until the member chooses one.',
    }),
  ],
  preview: {
    select: { title: 'username', subtitle: 'uid' },
    prepare: ({ title, subtitle }) => ({ title: title || '(no username yet)', subtitle }),
  },
})
