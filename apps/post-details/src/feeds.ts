export type Feed = 'all' | 'bikes' | 'pizza' | 'news'

export const FEEDS: {value: Feed; title: string}[] = [
  {value: 'all', title: 'All'},
  {value: 'bikes', title: 'Bikes'},
  {value: 'pizza', title: 'Pizza'},
  {value: 'news', title: 'News'},
]
