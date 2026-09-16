// Generated from contract/*.json by tool/contract/generate.mjs. Do not edit; change the JSON and run the generator.
//
// Facts shared with the Cloud Functions and the website: the feeds, the
// option lists for a post's details, the username rule and URL shapes.

const timeZone = 'America/Chicago';

/// Every feed's label, by value, in display order.
const feedLabels = <String, String>{
  'bikes': 'Bikes',
  'pizza': 'Pizza',
  'news': 'News',
};

/// What a post in each feed is, for messages ("your bike").
const feedNouns = <String, String>{
  'bikes': 'bike',
  'pizza': 'pizza',
  'news': 'news post',
};

/// Feeds shown as a photo gallery, in category order.
const galleryFeeds = <String>['bikes', 'pizza'];

/// Feeds read as full articles.
const articleFeeds = <String>['news'];

/// Feeds that accept member submissions.
const submissionFeeds = <String>['bikes', 'pizza'];

/// Display titles for the stored `bikeYears` values.
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

/// Display titles for the stored `bikeColors` values.
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

/// Display titles for the stored `bikeTypes` values.
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

/// Display titles for the stored `pizzaStyles` values.
const pizzaStyles = <String, String>{
  'altoona': 'Altoona style',
  'brier-hill': 'Brier Hill',
  'california': 'California',
  'calzone': 'Calzone',
  'chicago-deep-dish': 'Chicago deep-dish',
  'chicago-stuffed': 'Chicago stuffed',
  'chicago-tavern': 'Chicago tavern',
  'colorado-mountain-pie': 'Colorado mountain pie',
  'detroit': 'Detroit',
  'fugazzeta': 'Fugazzeta',
  'grandma': 'Grandma style',
  'greek': 'Greek',
  'madison': 'Madison pizza',
  'milwaukee': 'Milwaukee pizza',
  'neapolitan': 'Neapolitan',
  'new-haven': 'New Haven (apizza)',
  'new-jersey-bar-pie': 'New Jersey bar pie',
  'new-york-coal-oven': 'New York coal-oven',
  'new-york-other': 'New York (other)',
  'new-york-sicilian': 'New York Sicilian',
  'new-york-street-slice': 'New York street slice',
  'ohio-valley': 'Ohio Valley',
  'old-forge': 'Old Forge',
  'pinsa-romana': 'Pinsa Romana',
  'pissaladiere': 'Pissaladière',
  'pizza-al-taglio': 'Pizza al taglio',
  'pizza-fritta': 'Pizza fritta',
  'pizza-tonda-romana': 'Pizza tonda Romana',
  'quad-cities': 'Quad Cities',
  'regina': 'Regina style',
  'rhode-island-bakery': 'Rhode Island bakery',
  'sicilian': 'Sicilian',
  'st-louis': 'St. Louis',
  'stromboli': 'Stromboli',
  'thick-crust': 'Thick-crust',
  'thin-crust': 'Thin-crust',
  'trenton-tomato-pie': 'Trenton tomato pie',
  'other': 'Other',
};

/// Usernames: 3 to 24 letters, digits or underscores.
final usernamePattern = RegExp(r'^[A-Za-z0-9_]{3,24}$');

const usernameRule = '3 to 24 letters, digits or underscores';

const _postPaths = <String, String>{
  'news': '/news/{slug}/',
  'default': '/post/{slug}/',
};

/// Path of a post's page on the website.
String postPath(String feed, String slug) =>
    (_postPaths[feed] ?? _postPaths['default']!).replaceFirst('{slug}', slug);

const imageMaxEdge = 2048;

const imageMaxUploadBytes = 8388608;

/// How many additional photos a bike or pizza post may carry besides its main one.
const imageMaxExtra = 4;
