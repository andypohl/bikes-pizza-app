// The choices for a post's structured details, as values only. Mirrors
// `studio/schemaTypes/bikeOptions.ts` and `pizzaOptions.ts`, which the
// Studio, the website and the Post details app import; the functions are
// plain JavaScript and cannot, so the values are repeated here and
// post_options.test.js checks the two stay in step. Titles are not needed
// server-side: an edit sends the value and the clients show the title.

export const BIKE_YEARS = ["pre-1960", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"];

export const BIKE_COLORS = [
  "black",
  "white",
  "silver",
  "chrome",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "brown",
  "multi",
];

export const BIKE_TYPES = [
  "mtb",
  "fat-mtb",
  "road",
  "bmx",
  "gravel",
  "cyclocross",
  "touring",
  "track",
  "cruiser",
  "hybrid",
  "folding",
  "cargo",
  "ebike",
  "kids",
  "other",
];

export const PIZZA_STYLES = [
  "altoona",
  "brier-hill",
  "california",
  "calzone",
  "chicago-deep-dish",
  "chicago-stuffed",
  "chicago-tavern",
  "colorado-mountain-pie",
  "detroit",
  "fugazzeta",
  "grandma",
  "greek",
  "madison",
  "milwaukee",
  "neapolitan",
  "new-haven",
  "new-jersey-bar-pie",
  "new-york-coal-oven",
  "new-york-other",
  "new-york-sicilian",
  "new-york-street-slice",
  "ohio-valley",
  "old-forge",
  "pinsa-romana",
  "pissaladiere",
  "pizza-al-taglio",
  "pizza-fritta",
  "pizza-tonda-romana",
  "quad-cities",
  "regina",
  "rhode-island-bakery",
  "sicilian",
  "st-louis",
  "stromboli",
  "thick-crust",
  "thin-crust",
  "trenton-tomato-pie",
  "other",
];
