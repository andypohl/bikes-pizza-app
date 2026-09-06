/// Display titles for the pizza style values stored on a post.
///
/// Mirrors `studio/schemaTypes/pizzaOptions.ts`, which the Studio and the
/// Post details app share; keep the two in step. An unknown value is shown
/// as stored, so a new style added there still displays here.
library;

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
