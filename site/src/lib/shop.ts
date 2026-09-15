import { slugify } from '../utils/slug';

/**
 * The shop: the products of the Shopify store, read once per build from
 * the Storefront GraphQL API with the store's public access token (which
 * Shopify designs to ship in clients: it can only read the catalogue and
 * create carts). Checkout stays with Shopify: the buy button opens the
 * store's cart permalink for the chosen variant.
 */

export interface Variant {
  /** Shopify's numeric variant id, what the cart permalink needs. */
  id: number;
  title: string;
  price: number;
  compareAtPrice: number | null;
  available: boolean;
  image: string | null;
}

export interface Product {
  /** Shopify's product id (`gid://shopify/Product/...`). */
  id: string;
  title: string;
  handle: string;
  /** Shopify's "product type", which the shop uses as its category. */
  category: string;
  descriptionHtml: string;
  image: string | null;
  price: number;
  maxPrice: number;
  available: boolean;
  variants: Variant[];
}

/** The store's own domain, where checkout happens. */
export const STORE_URL = (import.meta.env.PUBLIC_STORE_URL || 'https://shop.bikes.pizza/').replace(/\/+$/, '');

/**
 * Where the Storefront API is called: the shop's `*.myshopify.com` host or
 * a custom domain connected to the store; the store's own domain unless
 * overridden. The token is `PUBLIC_SHOPIFY_STOREFRONT_TOKEN`; without one
 * the build has no products (the Store button then links to the store).
 */
const STORE_DOMAIN: string = import.meta.env.PUBLIC_SHOPIFY_STORE_DOMAIN || new URL(`${STORE_URL}/`).host;
const STOREFRONT_TOKEN: string = import.meta.env.PUBLIC_SHOPIFY_STOREFRONT_TOKEN || '';
const API_VERSION = '2025-07';

const PRODUCTS_QUERY = `
  query Products($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title handle productType descriptionHtml availableForSale
        featuredImage { url }
        priceRange { minVariantPrice { amount } maxVariantPrice { amount } }
        variants(first: 100) {
          nodes { id title availableForSale price { amount } compareAtPrice { amount } image { url } }
        }
      }
    }
  }
`;

interface RawProduct {
  id: string;
  title: string;
  handle: string;
  productType: string | null;
  descriptionHtml: string | null;
  availableForSale: boolean;
  featuredImage: { url: string } | null;
  priceRange: { minVariantPrice: { amount: string }; maxVariantPrice: { amount: string } };
  variants: {
    nodes: {
      id: string;
      title: string;
      availableForSale: boolean;
      price: { amount: string };
      compareAtPrice: { amount: string } | null;
      image: { url: string } | null;
    }[];
  };
}

/** The number at the end of a Shopify GID (`gid://shopify/ProductVariant/123`). */
export function numericId(gid: string): number {
  return Number(gid.split('/').pop()?.split('?')[0]) || 0;
}

function toProduct(raw: RawProduct): Product {
  const variants = raw.variants.nodes
    .map((variant) => ({
      id: numericId(variant.id),
      title: variant.title,
      price: Number(variant.price.amount) || 0,
      compareAtPrice: variant.compareAtPrice ? Number(variant.compareAtPrice.amount) || null : null,
      available: variant.availableForSale,
      image: variant.image?.url ?? null,
    }))
    .filter((variant) => variant.id > 0);
  const price = Number(raw.priceRange.minVariantPrice.amount) || 0;
  return {
    id: raw.id,
    title: raw.title,
    handle: raw.handle,
    category: (raw.productType ?? '').trim(),
    descriptionHtml: raw.descriptionHtml ?? '',
    image: raw.featuredImage?.url ?? null,
    price,
    maxPrice: Math.max(price, Number(raw.priceRange.maxVariantPrice.amount) || 0),
    available: raw.availableForSale && variants.some((variant) => variant.available),
    variants,
  };
}

async function storefront<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://${STORE_DOMAIN}/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`shopify: HTTP ${response.status} from the Storefront API`);
  const body: { data?: T; errors?: { message: string }[] } = await response.json();
  if (body.errors?.length) throw new Error(`shopify: ${body.errors.map((error) => error.message).join('; ')}`);
  if (!body.data) throw new Error('shopify: empty reply from the Storefront API');
  return body.data;
}

async function fetchProducts(): Promise<Product[]> {
  if (!STOREFRONT_TOKEN) {
    console.warn('shop: PUBLIC_SHOPIFY_STOREFRONT_TOKEN is not set; building without products');
    return [];
  }
  const products: Product[] = [];
  let after: string | null = null;
  do {
    const data: { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawProduct[] } } =
      await storefront(PRODUCTS_QUERY, { first: 100, after });
    products.push(...data.products.nodes.filter((raw) => raw.handle).map(toProduct));
    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (after);
  return products;
}

let cache: Promise<Product[]> | undefined;

/** Every product of the store, newest first. Fetched once per build. */
export function getProducts(): Promise<Product[]> {
  cache ??= fetchProducts();
  return cache;
}

/** Path of a product's page. */
export function productPath(product: Product): string {
  return `/shop/${product.handle}/`;
}

export const ALL_PRODUCTS = 'All products';

/** The categories with at least one product, in first-seen order. */
export function categoriesOf(products: Product[]): string[] {
  const seen = new Set<string>();
  for (const product of products) if (product.category) seen.add(product.category);
  return [...seen];
}

export function categoryPath(category: string): string {
  return `/shop/category/${slugify(category)}/`;
}

/** Whether a product has real variants to choose from, rather than Shopify's single default one. */
export function hasChoices(product: Product): boolean {
  return product.variants.length > 1 || (product.variants.length === 1 && product.variants[0].title !== 'Default Title');
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** "$10.00", or "From $10.00" when variants differ in price. */
export function priceOf(product: Product): string {
  const from = product.maxPrice > product.price ? 'From ' : '';
  return `${from}${money.format(product.price)}`;
}

export function formatMoney(amount: number): string {
  return money.format(amount);
}

/** Shopify's cart permalink: opens checkout with one of the variant in the cart. */
export function checkoutUrl(variant: Variant, quantity = 1): string {
  return `${STORE_URL}/cart/${variant.id}:${quantity}`;
}

/**
 * A Shopify CDN image resized on their side. `width` and `height` crop to
 * the given box from the centre, which is how the tiles keep one ratio.
 */
export function shopifyImage(url: string, width: number, height?: number): string {
  const u = new URL(url);
  u.searchParams.set('width', String(width));
  if (height) {
    u.searchParams.set('height', String(height));
    u.searchParams.set('crop', 'center');
  }
  return u.toString();
}

/** `src` and `srcset` for a product image at the given widths, optionally cropped to `ratio` (width / height). */
export function responsiveShopify(url: string, widths: number[], ratio?: number) {
  const at = (w: number) => shopifyImage(url, w, ratio ? Math.round(w / ratio) : undefined);
  return { src: at(widths[widths.length - 1]), srcset: widths.map((w) => `${at(w)} ${w}w`).join(', ') };
}
