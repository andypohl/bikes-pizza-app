/**
 * Choices for the structured details on a bike post. Shared by the Studio
 * schema and the Post details app (apps/post-details), so a new decade,
 * color or type is added here and nowhere else.
 */
export type Option = {title: string; value: string}

export const BIKE_YEARS: Option[] = [
  {title: 'Before 1960', value: 'pre-1960'},
  {title: '1960s', value: '1960s'},
  {title: '1970s', value: '1970s'},
  {title: '1980s', value: '1980s'},
  {title: '1990s', value: '1990s'},
  {title: '2000s', value: '2000s'},
  {title: '2010s', value: '2010s'},
  {title: '2020s', value: '2020s'},
]

export const BIKE_COLORS: Option[] = [
  {title: 'Black', value: 'black'},
  {title: 'White', value: 'white'},
  {title: 'Silver / gray', value: 'silver'},
  {title: 'Chrome', value: 'chrome'},
  {title: 'Red', value: 'red'},
  {title: 'Orange', value: 'orange'},
  {title: 'Yellow', value: 'yellow'},
  {title: 'Green', value: 'green'},
  {title: 'Blue', value: 'blue'},
  {title: 'Purple', value: 'purple'},
  {title: 'Pink', value: 'pink'},
  {title: 'Brown / tan', value: 'brown'},
  {title: 'Multicolor', value: 'multi'},
]

export const BIKE_TYPES: Option[] = [
  {title: 'Mountain', value: 'mtb'},
  {title: 'Fat MTB', value: 'fat-mtb'},
  {title: 'Road', value: 'road'},
  {title: 'BMX', value: 'bmx'},
  {title: 'Gravel', value: 'gravel'},
  {title: 'Cyclocross', value: 'cyclocross'},
  {title: 'Touring', value: 'touring'},
  {title: 'Track / fixed', value: 'track'},
  {title: 'Cruiser', value: 'cruiser'},
  {title: 'Hybrid / city', value: 'hybrid'},
  {title: 'Folding', value: 'folding'},
  {title: 'Cargo', value: 'cargo'},
  {title: 'E-bike', value: 'ebike'},
  {title: 'Kids', value: 'kids'},
  {title: 'Other', value: 'other'},
]
