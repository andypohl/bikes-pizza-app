import {type SanityConfig} from '@sanity/sdk'
import {SanityApp} from '@sanity/sdk-react'
import {Flex, Spinner} from '@sanity/ui'
import {dataset, projectId} from '../environment'
import {PostDetails} from './PostDetails'
import {SanityUI} from './SanityUI'

const config: SanityConfig[] = [{projectId, dataset}]

function Loading() {
  return (
    <Flex justify="center" align="center" height="fill" style={{width: "100vw"}}>
      <Spinner />
    </Flex>
  )
}

export default function App() {
  return (
    <SanityUI>
      <SanityApp config={config} fallback={<Loading />}>
        <PostDetails />
      </SanityApp>
    </SanityUI>
  )
}
