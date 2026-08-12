export type BhtCategory = {
  slug: string;
  label: string;
  code: string;
  panelCode: string | null;
  description: string;
};

export const ALL_BHT_CATEGORY: BhtCategory = {
  slug: "all",
  label: "All Categories",
  code: "ALL-CATEGORIES",
  panelCode: null,
  description: "Unified BHT tracker dashboard across all product categories and omnibus respondents.",
};

export const BHT_CATEGORIES: BhtCategory[] = [
  {
    slug: "breakfast-cereals",
    label: "Breakfast Cereals",
    code: "BREAKFAST-CEREALS",
    panelCode: "Panel_7",
    description: "Exploring the breakfast cereals market landscape, consumer preferences, brand positioning, and growth trends across key demographics.",
  },
  {
    slug: "noodles",
    label: "Noodles",
    code: "NOODLES",
    panelCode: "Panel_1",
    description: "Comprehensive analysis of the noodles market covering instant, dried, and fresh segments with brand share and pricing dynamics.",
  },
  {
    slug: "toothpaste",
    label: "Toothpaste",
    code: "TOOTHPASTE",
    panelCode: "Panel_2",
    description: "In-depth toothpaste market research including whitening, sensitivity, and herbal segments across retail channels.",
  },
  {
    slug: "bleach",
    label: "Bleach",
    code: "BLEACH",
    panelCode: "Panel_4",
    description: "Market intelligence on bleach products covering household and industrial segments, brand loyalty, and pricing strategies.",
  },
  {
    slug: "wet-hair",
    label: "Wet Hair",
    code: "WET-HAIR",
    panelCode: "Panel_9",
    description: "Wet hair care market analysis spanning shampoos, conditioners, and treatments with consumer behavior insights.",
  },
  {
    slug: "dry-hair",
    label: "Dry Hair",
    code: "DRY-HAIR",
    panelCode: "Panel_10",
    description: "Dry hair care segment research including styling products, serums, and protective treatments across demographics.",
  },
  {
    slug: "condiment-mixes",
    label: "Condiment Mixes",
    code: "CONDIMENT-MIXES",
    panelCode: "Panel_8",
    description: "Condiment mixes market study covering spice blends, seasoning cubes, and flavor enhancers with regional preferences.",
  },
  {
    slug: "malt",
    label: "Malt",
    code: "MALT",
    panelCode: "Panel_11",
    description: "Malt-based beverages and food products market research including energy drinks, breakfast malt, and nutritional supplements.",
  },
  {
    slug: "snacks",
    label: "Snacks",
    code: "SNACKS",
    panelCode: "Panel_6",
    description: "Snacks industry analysis covering chips, crackers, nuts, and confectionery with distribution and consumer trend data.",
  },
  {
    slug: "edible-oil",
    label: "Edible Oil",
    code: "EDIBLE-OIL",
    panelCode: "Panel_3",
    description: "Edible oil market research spanning palm, groundnut, soy, and blended oils with pricing, sourcing, and demand patterns.",
  },
  {
    slug: "toilet-cleaner",
    label: "Toilet Cleaner",
    code: "TOILET-CLEANER",
    panelCode: "Panel_5",
    description: "Toilet cleaner market intelligence covering liquid, gel, and tablet formats with brand penetration and channel analysis.",
  },
  {
    slug: "omnibus",
    label: "Omnibus",
    code: "OMNIBUS",
    panelCode: null,
    description: "Common omnibus question section answered by all respondents across the monthly BHT tracker.",
  },
];

export const BHT_CATEGORY_FILTER_OPTIONS: BhtCategory[] = [ALL_BHT_CATEGORY, ...BHT_CATEGORIES];

export const DEFAULT_BHT_CATEGORY = "all";

export function getBhtCategory(slug: string | null | undefined) {
  if (!slug || slug === ALL_BHT_CATEGORY.slug) return ALL_BHT_CATEGORY;
  return BHT_CATEGORIES.find((category) => category.slug === slug) ?? ALL_BHT_CATEGORY;
}
