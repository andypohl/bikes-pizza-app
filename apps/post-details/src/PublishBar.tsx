import {
  type DocumentHandle,
  discardDocument,
  publishDocument,
  useApplyDocumentActions,
  useQuery,
} from '@sanity/sdk-react'
import {Badge, Button, Flex, useToast} from '@sanity/ui'
import {useState} from 'react'

/**
 * Edits land in a draft; the website builds from published documents, so
 * nothing shows on the site until Publish. Publishing also triggers the
 * site rebuild through the Sanity webhook.
 */
export function PublishBar({handle}: {handle: DocumentHandle}) {
  const {data: draftId} = useQuery<string | null>({
    query: `*[_id == $draftId][0]._id`,
    params: {draftId: `drafts.${handle.documentId}`},
    perspective: 'raw',
  })
  const apply = useApplyDocumentActions()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const hasDraft = Boolean(draftId)

  async function run(action: 'publish' | 'discard') {
    setBusy(true)
    try {
      await apply(action === 'publish' ? publishDocument(handle) : discardDocument(handle))
      toast.push({
        status: 'success',
        title: action === 'publish' ? 'Published' : 'Changes discarded',
      })
    } catch (error) {
      toast.push({
        status: 'error',
        title: action === 'publish' ? 'Publish failed' : 'Discard failed',
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Flex align="center" gap={2} wrap="wrap">
      <Badge tone={hasDraft ? 'caution' : 'positive'}>
        {hasDraft ? 'Unpublished changes' : 'Published'}
      </Badge>
      <Flex flex={1} />
      <Button
        mode="ghost"
        text="Discard changes"
        disabled={!hasDraft || busy}
        onClick={() => run('discard')}
      />
      <Button
        tone="primary"
        text="Publish"
        disabled={!hasDraft || busy}
        onClick={() => run('publish')}
      />
    </Flex>
  )
}
