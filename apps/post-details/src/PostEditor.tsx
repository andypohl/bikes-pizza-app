import {type DocumentHandle, useDocumentProjection} from '@sanity/sdk-react'
import {Box, Card, Flex, Grid, Heading, Stack, Text} from '@sanity/ui'
import {Suspense} from 'react'
import {dataset, datasets} from '../environment'
import {BIKE_COLORS, BIKE_TYPES, BIKE_YEARS} from '../../../studio/schemaTypes/bikeOptions'
import {MemberField} from './MemberField'
import {PublishBar} from './PublishBar'
import {SelectField, TextField} from './fields'

type Header = {title: string | null; feed: string | null; publishedAt: string | null}

export function PostEditor({handle}: {handle: DocumentHandle}) {
  const {data} = useDocumentProjection<Header>({
    ...handle,
    projection: `{title, feed, publishedAt}`,
  })
  const studioHref = `${datasets[dataset].studioUrl}/structure/post;${handle.documentId}`

  return (
    <Stack space={4} style={{maxWidth: 640}}>
      <Stack space={3}>
        <Heading as="h2" size={3}>
          {data.title || 'Untitled'}
        </Heading>
        <Flex gap={3} wrap="wrap">
          <Text muted size={1}>
            {data.feed ?? 'no feed'} ·{' '}
            {data.publishedAt ? data.publishedAt.slice(0, 10) : 'unscheduled'}
          </Text>
          <Text size={1}>
            <a href={studioHref} target="_blank" rel="noreferrer">
              Open in Studio
            </a>
          </Text>
        </Flex>
      </Stack>

      {data.feed === 'bikes' && (
        <Card border padding={4} radius={2}>
          <Stack space={4}>
            <Heading as="h3" size={1}>
              Bike details
            </Heading>
            <Grid columns={[1, 1, 2]} gap={4}>
              <TextField handle={handle} path="bike.brand" label="Brand" />
              <SelectField handle={handle} path="bike.year" label="Year" options={BIKE_YEARS} />
              <SelectField handle={handle} path="bike.color" label="Colour" options={BIKE_COLORS} />
              <SelectField handle={handle} path="bike.type" label="Type" options={BIKE_TYPES} />
            </Grid>
          </Stack>
        </Card>
      )}

      <Card border padding={4} radius={2}>
        <Suspense
          fallback={
            <Text muted size={1}>
              Loading members…
            </Text>
          }
        >
          <MemberField handle={handle} />
        </Suspense>
      </Card>

      <Box>
        <Suspense fallback={null}>
          <PublishBar handle={handle} />
        </Suspense>
      </Box>
    </Stack>
  )
}
