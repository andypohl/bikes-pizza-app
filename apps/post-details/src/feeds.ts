export type Feed = 'all' | 'bikes' | 'pizza' | 'blog'

export const FEEDS: {value: Feed; title: string}[] = [
  {value: 'all', title: 'All'},
  {value: 'bikes', title: 'Bikes'},
  {value: 'pizza', title: 'Pizza'},
  {value: 'blog', title: 'Blog'},
]
