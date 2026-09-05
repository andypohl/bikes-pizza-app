import {
  type DocumentHandle,
  editDocument,
  useApplyDocumentActions,
  useDocument,
  useEditDocument,
} from '@sanity/sdk-react'
import {Select, Stack, Text, TextInput} from '@sanity/ui'
import {useCallback} from 'react'
import {type Option} from '../../../studio/schemaTypes/bikeOptions'

type FieldProps = {
  handle: DocumentHandle
  path: string
  label: string
}

/** Removes the value at `path` from the draft (rather than setting it to an empty string). */
export function useUnset(handle: DocumentHandle, path: string) {
  const apply = useApplyDocumentActions()
  return useCallback(() => apply(editDocument(handle, {unset: [path]})), [apply, handle, path])
}

export function TextField({handle, path, label}: FieldProps) {
  const {data: value} = useDocument<string | null>({...handle, path})
  const edit = useEditDocument<string>({...handle, path})
  const unset = useUnset(handle, path)

  return (
    <Stack space={2}>
      <Text size={1} weight="medium">
        {label}
      </Text>
      <TextInput
        value={value ?? ''}
        onChange={(event) => {
          const next = event.currentTarget.value
          if (next === '') unset()
          else edit(next)
        }}
      />
    </Stack>
  )
}

export function SelectField({handle, path, label, options}: FieldProps & {options: Option[]}) {
  const {data: value} = useDocument<string | null>({...handle, path})
  const edit = useEditDocument<string>({...handle, path})
  const unset = useUnset(handle, path)

  return (
    <Stack space={2}>
      <Text size={1} weight="medium">
        {label}
      </Text>
      <Select
        value={value ?? ''}
        onChange={(event) => {
          const next = event.currentTarget.value
          if (next === '') unset()
          else edit(next)
        }}
      >
        <option value="">—</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.title}
          </option>
        ))}
      </Select>
    </Stack>
  )
}
