import {type DocumentHandle, useDocumentProjection, useDocuments} from '@sanity/sdk-react'
import {Badge, Box, Button, Card, Inline, Stack, Tab, TabList, Text} from '@sanity/ui'
import {Suspense} from 'react'
import {type Feed} from './feeds'

type Props = {
  feed: Feed
  feeds: {value: Feed; title: string}[]
  onFeedChange: (feed: Feed) => void
  onSelect: (handle: DocumentHandle) => void
  selectedId: string | null
}

export function PostList({feed, feeds, onFeedChange, onSelect, selectedId}: Props) {
  return (
    <Stack>
      <Box paddingX={4} paddingBottom={3}>
        <TabList space={1}>
          {feeds.map((f) => (
            <Tab
              key={f.value}
              id={`feed-${f.value}`}
              aria-controls="post-list"
              label={f.title}
              selected={feed === f.value}
              onClick={() => onFeedChange(f.value)}
            />
          ))}
        </TabList>
      </Box>
      <Suspense
        fallback={
          <Box padding={4}>
            <Text muted size={1}>
              Loading posts…
            </Text>
          </Box>
        }
      >
        <Posts key={feed} feed={feed} onSelect={onSelect} selectedId={selectedId} />
      </Suspense>
    </Stack>
  )
}

function Posts({feed, onSelect, selectedId}: Omit<Props, 'feeds' | 'onFeedChange'>) {
  const {data, hasMore, isPending, loadMore} = useDocuments({
    documentType: 'post',
    filter: feed === 'all' ? undefined : 'feed == $feed',
    params: {feed},
    batchSize: 25,
    orderings: [{field: 'publishedAt', direction: 'desc'}],
  })

  return (
    <Stack id="post-list" role="tabpanel" space={1} paddingX={2} paddingBottom={4}>
      {data.length === 0 && (
        <Box padding={3}>
          <Text muted size={1}>
            No posts here yet.
          </Text>
        </Box>
      )}
      {data.map((handle) => (
        <Suspense key={handle.documentId} fallback={<RowSkeleton />}>
          <PostRow
            handle={handle}
            selected={handle.documentId === selectedId}
            onSelect={onSelect}
          />
        </Suspense>
      ))}
      {hasMore && (
        <Box padding={2}>
          <Button
            mode="ghost"
            text={isPending ? 'Loading…' : 'Load more'}
            disabled={isPending}
            onClick={loadMore}
            width="fill"
          />
        </Box>
      )}
    </Stack>
  )
}

function RowSkeleton() {
  return (
    <Box padding={3}>
      <Text muted size={1}>
        …
      </Text>
    </Box>
  )
}

type RowData = {
  title: string | null
  feed: string | null
  publishedAt: string | null
  username: string | null
  hasAuthor: boolean
  bikeComplete: boolean
  pizzaComplete: boolean
}

function PostRow({
  handle,
  selected,
  onSelect,
}: {
  handle: DocumentHandle
  selected: boolean
  onSelect: (handle: DocumentHandle) => void
}) {
  const {data} = useDocumentProjection<RowData>({
    ...handle,
    projection: `{
      title,
      feed,
      publishedAt,
      "username": author->username,
      "hasAuthor": defined(author),
      "bikeComplete": defined(bike.brand) && defined(bike.year) && defined(bike.color) && defined(bike.type),
      "pizzaComplete": defined(pizza.style)
    }`,
  })

  const needsBike = data.feed === 'bikes' && !data.bikeComplete
  const needsPizza = data.feed === 'pizza' && !data.pizzaComplete

  return (
    <Card
      as="button"
      padding={3}
      radius={2}
      tone={selected ? 'primary' : 'default'}
      pressed={selected}
      onClick={() => onSelect(handle)}
      style={{textAlign: 'left', cursor: 'pointer'}}
    >
      <Stack space={2}>
        <Text weight="medium" textOverflow="ellipsis">
          {data.title || 'Untitled'}
        </Text>
        <Text muted size={1}>
          {data.feed ?? '—'} · {data.publishedAt ? data.publishedAt.slice(0, 10) : 'unscheduled'}
          {data.username ? ` · @${data.username}` : ''}
        </Text>
        {(needsBike || needsPizza || !data.hasAuthor) && (
          <Inline space={1}>
            {needsBike && <Badge tone="caution">needs bike details</Badge>}
            {needsPizza && <Badge tone="caution">needs pizza details</Badge>}
            {!data.hasAuthor && <Badge tone="caution">no member</Badge>}
          </Inline>
        )}
      </Stack>
    </Card>
  )
}
