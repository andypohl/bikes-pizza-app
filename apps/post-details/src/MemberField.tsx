import {type DocumentHandle, useDocument, useEditDocument, useQuery} from '@sanity/sdk-react'
import {Select, Stack, Text} from '@sanity/ui'
import {useUnset} from './fields'

type Member = {_id: string; username: string | null; uid: string}
type Reference = {_type: 'reference'; _ref: string}

/**
 * Links the post to a member, chosen by username. The post stores a
 * reference to the member document, so the credit follows any later
 * username change. Members who have not chosen a username yet are listed
 * by account id.
 */
export function MemberField({handle}: {handle: DocumentHandle}) {
  const {data: members} = useQuery<Member[]>({
    query: `*[_type == "member"] | order(lower(username) asc, uid asc) {_id, username, uid}`,
  })
  const {data: author} = useDocument<Reference | null>({...handle, path: 'author'})
  const editAuthor = useEditDocument<Reference>({...handle, path: 'author'})
  const unset = useUnset(handle, 'author')

  const current = members.find((m) => m._id === author?._ref)

  return (
    <Stack space={2}>
      <Text size={1} weight="medium">
        Member
      </Text>
      <Select
        value={author?._ref ?? ''}
        onChange={(event) => {
          const next = event.currentTarget.value
          if (next === '') unset()
          else editAuthor({_type: 'reference', _ref: next})
        }}
      >
        <option value="">— not linked —</option>
        {author?._ref && !current && <option value={author._ref}>(unknown member)</option>}
        {members.map((member) => (
          <option key={member._id} value={member._id}>
            {member.username ? `@${member.username}` : `(no username yet) ${member.uid}`}
          </option>
        ))}
      </Select>
      <Text muted size={1}>
        {members.length === 0
          ? 'No members yet. A member document appears when an account first has a post published.'
          : 'The username shown on the site comes from the linked member.'}
      </Text>
    </Stack>
  )
}
