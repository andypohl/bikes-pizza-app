import {type DocumentHandle} from '@sanity/sdk-react'
import {Box, Card, Flex, Heading, Text} from '@sanity/ui'
import {Suspense, useState} from 'react'
import {dataset, datasets} from '../environment'
import {FEEDS, type Feed} from './feeds'
import {PostEditor} from './PostEditor'
import {PostList} from './PostList'

/**
 * Two panes: the posts on the left (newest first, filtered by feed), and
 * the selected post's structured details on the right. Edits go straight
 * to a draft in Content Lake; Publish makes them live.
 */
export function PostDetails() {
  const [feed, setFeed] = useState<Feed>('all')
  const [selected, setSelected] = useState<DocumentHandle | null>(null)

  return (
    <Flex height="fill" style={{minHeight: '100vh'}}>
      <Card
        borderRight
        flex="none"
        overflow="auto"
        style={{width: 360, maxWidth: '45vw'}}
        tone="transparent"
      >
        <Box padding={4}>
          <Flex align="baseline" gap={2} wrap="wrap">
            <Heading as="h1" size={2}>
              Post details
            </Heading>
            <Text muted size={1}>
              {datasets[dataset].title === 'Post details' ? 'production' : dataset}
            </Text>
          </Flex>
        </Box>
        <PostList
          feed={feed}
          feeds={FEEDS}
          onFeedChange={setFeed}
          onSelect={setSelected}
          selectedId={selected?.documentId ?? null}
        />
      </Card>
      <Box flex={1} overflow="auto" padding={4}>
        {selected ? (
          <Suspense
            key={selected.documentId}
            fallback={
              <Text muted size={1}>
                Loading post…
              </Text>
            }
          >
            <PostEditor handle={selected} />
          </Suspense>
        ) : (
          <Text muted>Choose a post on the left.</Text>
        )}
      </Box>
    </Flex>
  )
}
