// Firestore over its REST API, read at build time without credentials:
// the security rules let anyone read what the website shows (published
// posts). No SDK, no service account; the project is the only setting.
//
// The response of `runQuery` is Firestore's typed JSON (`{stringValue}`,
// `{mapValue: {fields}}`, ...); `decode` turns it into plain objects.

/** The Firebase project the site is built from; set in astro.config.mjs. */
export const FIREBASE_PROJECT: string = import.meta.env.PUBLIC_FIREBASE_PROJECT;

const DATABASE = `projects/${FIREBASE_PROJECT}/databases/(default)`;
const ENDPOINT = `https://firestore.googleapis.com/v1/${DATABASE}/documents`;

type Value =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: Value[] } }
  | { mapValue: { fields?: Record<string, Value> } };

/** A Firestore value as the plain JavaScript value it stands for. */
export function decode(value: Value): unknown {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decode);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields ?? {});
  throw new Error(`firestore: unknown value ${JSON.stringify(value)}`);
}

function decodeFields(fields: Record<string, Value>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]));
}

export interface Filter {
  field: string;
  op: 'EQUAL' | 'NOT_EQUAL' | 'LESS_THAN' | 'GREATER_THAN' | 'ARRAY_CONTAINS';
  value: string | number | boolean;
}

/** A document's fields plus its id (the last part of its path). */
export type Document = Record<string, unknown> & { id: string };

const encodeValue = (value: Filter['value']): Value =>
  typeof value === 'string'
    ? { stringValue: value }
    : typeof value === 'boolean'
      ? { booleanValue: value }
      : Number.isInteger(value)
        ? { integerValue: String(value) }
        : { doubleValue: value };

/**
 * Every document of a top-level collection matching all of `filters`.
 * Equality filters alone need no composite index, so callers sort the
 * result themselves rather than asking Firestore to.
 */
export async function query(collection: string, filters: Filter[]): Promise<Document[]> {
  if (!FIREBASE_PROJECT) throw new Error('firestore: PUBLIC_FIREBASE_PROJECT is not set');
  const where =
    filters.length === 1
      ? fieldFilter(filters[0])
      : { compositeFilter: { op: 'AND', filters: filters.map(fieldFilter) } };
  const response = await fetch(`${ENDPOINT}:runQuery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], where } }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`firestore: ${collection} query failed with HTTP ${response.status}: ${body}`);
  const rows: { document?: { name: string; fields?: Record<string, Value> }; error?: { message: string } }[] =
    JSON.parse(body);
  const failed = rows.find((row) => row.error);
  if (failed?.error) throw new Error(`firestore: ${collection} query failed: ${failed.error.message}`);
  return rows
    .filter((row): row is { document: { name: string; fields?: Record<string, Value> } } => !!row.document)
    .map(({ document }) => ({ ...decodeFields(document.fields ?? {}), id: document.name.split('/').pop() ?? '' }));
}

const fieldFilter = ({ field, op, value }: Filter) => ({
  fieldFilter: { field: { fieldPath: field }, op, value: encodeValue(value) },
});
