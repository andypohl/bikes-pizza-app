// Generated from contract/*.json by tool/contract/generate.mjs. Do not edit; change the JSON and run the generator.

export const TIME_ZONE = "America/Chicago";

/** Every feed, in display order. */

export const FEEDS = [
  {
    "value": "bikes",
    "label": "Bikes",
    "noun": "bike",
    "layout": "gallery",
    "submissions": true,
    "postingHours": [
      8,
      12,
      16,
      20
    ]
  },
  {
    "value": "pizza",
    "label": "Pizza",
    "noun": "pizza",
    "layout": "gallery",
    "submissions": true,
    "postingHours": [
      9,
      13,
      17,
      21
    ]
  },
  {
    "value": "news",
    "label": "News",
    "noun": "news post",
    "layout": "article",
    "submissions": false,
    "postingHours": []
  }
];

export const FEED_LABELS = {
  "bikes": "Bikes",
  "pizza": "Pizza",
  "news": "News",
};

/** Feeds shown as a photo gallery, in category order. */

export const GALLERY_FEEDS = ["bikes","pizza"];

/** Feeds read as full articles. */

export const ARTICLE_FEEDS = ["news"];

/** Feeds that accept member submissions, with the noun for messages. */

export const SUBMISSION_FEEDS = {
  "bikes": {"noun":"bike"},
  "pizza": {"noun":"pizza"},
};

/** Hours of the day (24h, in TIME_ZONE) each queue posts at. */

export const POSTING_HOURS = {
  "bikes": [8,12,16,20],
  "pizza": [9,13,17,21],
};

export const BIKE_YEARS = [
  { title: "Before 1960", value: "pre-1960" },
  { title: "1960s", value: "1960s" },
  { title: "1970s", value: "1970s" },
  { title: "1980s", value: "1980s" },
  { title: "1990s", value: "1990s" },
  { title: "2000s", value: "2000s" },
  { title: "2010s", value: "2010s" },
  { title: "2020s", value: "2020s" },
];

export const BIKE_YEARS_VALUES = ["pre-1960","1960s","1970s","1980s","1990s","2000s","2010s","2020s"];

export const BIKE_COLORS = [
  { title: "Black", value: "black" },
  { title: "White", value: "white" },
  { title: "Silver / gray", value: "silver" },
  { title: "Chrome", value: "chrome" },
  { title: "Red", value: "red" },
  { title: "Orange", value: "orange" },
  { title: "Yellow", value: "yellow" },
  { title: "Green", value: "green" },
  { title: "Blue", value: "blue" },
  { title: "Purple", value: "purple" },
  { title: "Pink", value: "pink" },
  { title: "Brown / tan", value: "brown" },
  { title: "Multicolor", value: "multi" },
];

export const BIKE_COLORS_VALUES = ["black","white","silver","chrome","red","orange","yellow","green","blue","purple","pink","brown","multi"];

export const BIKE_TYPES = [
  { title: "Mountain", value: "mtb" },
  { title: "Fat MTB", value: "fat-mtb" },
  { title: "Road", value: "road" },
  { title: "BMX", value: "bmx" },
  { title: "Gravel", value: "gravel" },
  { title: "Cyclocross", value: "cyclocross" },
  { title: "Touring", value: "touring" },
  { title: "Track / fixed", value: "track" },
  { title: "Cruiser", value: "cruiser" },
  { title: "Hybrid / city", value: "hybrid" },
  { title: "Folding", value: "folding" },
  { title: "Cargo", value: "cargo" },
  { title: "E-bike", value: "ebike" },
  { title: "Kids", value: "kids" },
  { title: "Other", value: "other" },
];

export const BIKE_TYPES_VALUES = ["mtb","fat-mtb","road","bmx","gravel","cyclocross","touring","track","cruiser","hybrid","folding","cargo","ebike","kids","other"];

export const PIZZA_STYLES = [
  { title: "Altoona style", value: "altoona" },
  { title: "Brier Hill", value: "brier-hill" },
  { title: "California", value: "california" },
  { title: "Calzone", value: "calzone" },
  { title: "Chicago deep-dish", value: "chicago-deep-dish" },
  { title: "Chicago stuffed", value: "chicago-stuffed" },
  { title: "Chicago tavern", value: "chicago-tavern" },
  { title: "Colorado mountain pie", value: "colorado-mountain-pie" },
  { title: "Detroit", value: "detroit" },
  { title: "Fugazzeta", value: "fugazzeta" },
  { title: "Grandma style", value: "grandma" },
  { title: "Greek", value: "greek" },
  { title: "Madison pizza", value: "madison" },
  { title: "Milwaukee pizza", value: "milwaukee" },
  { title: "Neapolitan", value: "neapolitan" },
  { title: "New Haven (apizza)", value: "new-haven" },
  { title: "New Jersey bar pie", value: "new-jersey-bar-pie" },
  { title: "New York coal-oven", value: "new-york-coal-oven" },
  { title: "New York (other)", value: "new-york-other" },
  { title: "New York Sicilian", value: "new-york-sicilian" },
  { title: "New York street slice", value: "new-york-street-slice" },
  { title: "Ohio Valley", value: "ohio-valley" },
  { title: "Old Forge", value: "old-forge" },
  { title: "Pinsa Romana", value: "pinsa-romana" },
  { title: "Pissaladière", value: "pissaladiere" },
  { title: "Pizza al taglio", value: "pizza-al-taglio" },
  { title: "Pizza fritta", value: "pizza-fritta" },
  { title: "Pizza tonda Romana", value: "pizza-tonda-romana" },
  { title: "Quad Cities", value: "quad-cities" },
  { title: "Regina style", value: "regina" },
  { title: "Rhode Island bakery", value: "rhode-island-bakery" },
  { title: "Sicilian", value: "sicilian" },
  { title: "St. Louis", value: "st-louis" },
  { title: "Stromboli", value: "stromboli" },
  { title: "Thick-crust", value: "thick-crust" },
  { title: "Thin-crust", value: "thin-crust" },
  { title: "Trenton tomato pie", value: "trenton-tomato-pie" },
  { title: "Other", value: "other" },
];

export const PIZZA_STYLES_VALUES = ["altoona","brier-hill","california","calzone","chicago-deep-dish","chicago-stuffed","chicago-tavern","colorado-mountain-pie","detroit","fugazzeta","grandma","greek","madison","milwaukee","neapolitan","new-haven","new-jersey-bar-pie","new-york-coal-oven","new-york-other","new-york-sicilian","new-york-street-slice","ohio-valley","old-forge","pinsa-romana","pissaladiere","pizza-al-taglio","pizza-fritta","pizza-tonda-romana","quad-cities","regina","rhode-island-bakery","sicilian","st-louis","stromboli","thick-crust","thin-crust","trenton-tomato-pie","other"];

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/;

export const USERNAME_RULE = "3 to 24 letters, digits or underscores";

export const POST_PATHS = {
  "news": "/news/{slug}/",
  "default": "/post/{slug}/",
};

/** Path of a post's page on the website. */

export function postPath(feed, slug) {
  return (POST_PATHS[feed] ?? POST_PATHS.default).replace("{slug}", slug);
}

export const IMAGE_MAX_EDGE = 2048;

export const IMAGE_MAX_UPLOAD_BYTES = 8388608;

/** How many additional photos a bike or pizza post may carry besides its main one. */

export const IMAGE_MAX_EXTRA = 4;

export const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** The reaction palettes of each feed, in display order; feeds without any take no reactions. */

export const REACTION_PALETTES = {
  "pizza": [
    {
      "key": "had",
      "prompt": "I've had this pizza",
      "pick": "one",
      "options": [
        {
          "value": "yes",
          "title": "Yes"
        },
        {
          "value": "no",
          "title": "No"
        }
      ]
    },
    {
      "key": "fantastic",
      "prompt": "This pizza has fantastic",
      "pick": "one",
      "options": [
        {
          "value": "crust",
          "title": "Crust"
        },
        {
          "value": "cheese",
          "title": "Cheese"
        },
        {
          "value": "sauce",
          "title": "Sauce"
        },
        {
          "value": "toppings",
          "title": "Toppings"
        },
        {
          "value": "price",
          "title": "Price"
        }
      ]
    }
  ],
  "bikes": [
    {
      "key": "looks",
      "prompt": "This bike looks",
      "pick": "one",
      "options": [
        {
          "value": "stylish",
          "title": "Stylish"
        },
        {
          "value": "comfortable",
          "title": "Comfortable"
        },
        {
          "value": "fast",
          "title": "Fast"
        },
        {
          "value": "rugged",
          "title": "Rugged"
        }
      ]
    },
    {
      "key": "favorite",
      "prompt": "My favorite part of this bike is its",
      "pick": "one",
      "options": [
        {
          "value": "wheels",
          "title": "Wheels"
        },
        {
          "value": "frame",
          "title": "Frame"
        },
        {
          "value": "gears",
          "title": "Gears/derailleurs"
        },
        {
          "value": "shifters",
          "title": "Shifters"
        },
        {
          "value": "brakes",
          "title": "Brakes"
        },
        {
          "value": "paint",
          "title": "Paint"
        },
        {
          "value": "bars",
          "title": "Bars"
        },
        {
          "value": "seat",
          "title": "Seat"
        },
        {
          "value": "pedals",
          "title": "Pedals"
        }
      ]
    }
  ]
};

/** The rules for comments on posts: lengths, windows, page sizes, report reasons and screening thresholds. */

export const COMMENTS = {
  "maxLength": 1000,
  "editWindowMinutes": 5,
  "pageSize": 20,
  "repliesShown": 3,
  "reportsToHide": 2,
  "timesKept": 20,
  "rateLimit": {
    "seconds": 15,
    "perDay": 200
  },
  "reportReasons": [
    {
      "value": "racism",
      "title": "Racism"
    },
    {
      "value": "misogyny",
      "title": "Misogyny"
    },
    {
      "value": "harassment",
      "title": "Too mean or harassing"
    },
    {
      "value": "politics",
      "title": "Politics"
    },
    {
      "value": "spam",
      "title": "Spam"
    },
    {
      "value": "other",
      "title": "Something else"
    }
  ],
  "screening": {
    "blockCategories": [
      "Toxic",
      "Insult",
      "Profanity",
      "Derogatory",
      "Sexual",
      "Violent"
    ],
    "block": 0.8,
    "hold": 0.5,
    "holdCategories": [
      "Politics"
    ],
    "holdTopic": 0.5
  }
};
