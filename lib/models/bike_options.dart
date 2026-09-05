/// Display titles for the bike detail values stored on a post.
///
/// Mirrors `studio/schemaTypes/bikeOptions.ts`, which the Studio and the
/// Post details app share; keep the two in step. An unknown value is shown
/// as stored, so a new option added there still displays here.
library;

const bikeYears = <String, String>{
  'pre-1960': 'Before 1960',
  '1960s': '1960s',
  '1970s': '1970s',
  '1980s': '1980s',
  '1990s': '1990s',
  '2000s': '2000s',
  '2010s': '2010s',
  '2020s': '2020s',
};

const bikeColors = <String, String>{
  'black': 'Black',
  'white': 'White',
  'silver': 'Silver / gray',
  'chrome': 'Chrome',
  'red': 'Red',
  'orange': 'Orange',
  'yellow': 'Yellow',
  'green': 'Green',
  'blue': 'Blue',
  'purple': 'Purple',
  'pink': 'Pink',
  'brown': 'Brown / tan',
  'multi': 'Multicolor',
};

const bikeTypes = <String, String>{
  'mtb': 'Mountain',
  'fat-mtb': 'Fat MTB',
  'road': 'Road',
  'bmx': 'BMX',
  'gravel': 'Gravel',
  'cyclocross': 'Cyclocross',
  'touring': 'Touring',
  'track': 'Track / fixed',
  'cruiser': 'Cruiser',
  'hybrid': 'Hybrid / city',
  'folding': 'Folding',
  'cargo': 'Cargo',
  'ebike': 'E-bike',
  'kids': 'Kids',
  'other': 'Other',
};
