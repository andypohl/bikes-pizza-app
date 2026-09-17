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

/// One choice in a reaction palette: the stored value and its label.
class ReactionOption {
  const ReactionOption(this.value, this.title);

  final String value;
  final String title;
}

/// A question a member answers about a post by picking from fixed
/// options: one of them ([pickOne]) or any number.
class ReactionPalette {
  const ReactionPalette({
    required this.key,
    required this.prompt,
    required this.pickOne,
    required this.options,
  });

  /// Names the palette in a post's counts and a member's picks.
  final String key;
  final String prompt;
  final bool pickOne;
  final List<ReactionOption> options;

  /// Whether [value] is one of the options.
  bool has(String value) => options.any((o) => o.value == value);
}

/// The reaction palettes of each feed, in display order; feeds without
/// any take no reactions.
const reactionPalettes = <String, List<ReactionPalette>>{
  'pizza': [
    ReactionPalette(
      key: 'had',
      prompt: 'I\'ve had this pizza',
      pickOne: true,
      options: [ReactionOption('yes', 'Yes'), ReactionOption('no', 'No')],
    ),
    ReactionPalette(
      key: 'fantastic',
      prompt: 'This pizza has fantastic',
      pickOne: true,
      options: [
        ReactionOption('crust', 'Crust'),
        ReactionOption('cheese', 'Cheese'),
        ReactionOption('sauce', 'Sauce'),
        ReactionOption('toppings', 'Toppings'),
        ReactionOption('price', 'Price'),
      ],
    ),
  ],
  'bikes': [
    ReactionPalette(
      key: 'looks',
      prompt: 'This bike looks',
      pickOne: true,
      options: [
        ReactionOption('stylish', 'Stylish'),
        ReactionOption('comfortable', 'Comfortable'),
        ReactionOption('fast', 'Fast'),
        ReactionOption('rugged', 'Rugged'),
      ],
    ),
    ReactionPalette(
      key: 'favorite',
      prompt: 'My favorite part of this bike is its',
      pickOne: true,
      options: [
        ReactionOption('wheels', 'Wheels'),
        ReactionOption('frame', 'Frame'),
        ReactionOption('gears', 'Gears/derailleurs'),
        ReactionOption('shifters', 'Shifters'),
        ReactionOption('brakes', 'Brakes'),
        ReactionOption('paint', 'Paint'),
        ReactionOption('bars', 'Bars'),
        ReactionOption('seat', 'Seat'),
        ReactionOption('pedals', 'Pedals'),
      ],
    ),
  ],
};

/// Comments on posts: the longest comment, in characters.
const commentMaxLength = 1000;

/// How long after posting a comment its author may still edit it.
const commentEditWindow = Duration(minutes: 5);

/// Top-level comments per page.
const commentPageSize = 20;

/// Replies shown under a comment before "show more".
const commentRepliesShown = 3;

/// Reports from different members that hide a comment until an admin looks.
const commentReportsToHide = 2;

/// How many of the newest comment times a post carries (`commentTimes`).
const commentTimesKept = 20;

/// The reasons a comment can be reported for, value to label, in display order.
const commentReportReasons = <String, String>{
  'racism': 'Racism',
  'misogyny': 'Misogyny',
  'harassment': 'Too mean or harassing',
  'politics': 'Politics',
  'spam': 'Spam',
  'other': 'Something else',
};

/// A member's location on their profile: the longest, in characters.
const memberLocationMaxLength = 60;

/// Direct messages: the longest message, in characters.
const messageMaxLength = 1000;

/// How long after sending a message its author may still edit it.
const messageEditWindow = Duration(minutes: 5);

/// How much of the newest message a thread carries as its preview.
const messagePreviewLength = 100;
