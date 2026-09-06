import { sanityClient } from 'sanity:client';
import { defineQuery } from 'groq';
import { slugify } from '../utils/slug';

/**
 * The shop: products that Sanity Connect for Shopify keeps in the dataset
 * (`product` and `productVariant` documents, everything under `store`).
 * Read once per build, like posts. Checkout stays with Shopify: the buy
 * button opens the store's cart permalink for the chosen variant.
 */

export interface Variant {
  id: number;
  title: string;
  price: number;
  compareAtPrice: number | null;
  available: boolean;
  image: string | null;
}

export interface Product {
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

const PRODUCTS_QUERY = defineQuery(`
  *[_type == "product" && store.status == "active" && store.isDeleted != true && defined(store.slug.current)]
    | order(store.createdAt desc) {
    "id": _id,
    "title": store.title,
    "handle": store.slug.current,
    "category": coalesce(store.productType, ""),
    "descriptionHtml": coalesce(store.descriptionHtml, ""),
    "image": store.previewImageUrl,
    "price": coalesce(store.priceRange.minVariantPrice, 0),
    "maxPrice": coalesce(store.priceRange.maxVariantPrice, store.priceRange.minVariantPrice, 0),
    "variants": store.variants[]->{
      "id": store.id,
      "title": store.title,
      "price": coalesce(store.price, 0),
      "compareAtPrice": store.compareAtPrice,
      "available": coalesce(store.inventory.isAvailable, false),
      "image": store.previewImageUrl,
      "deleted": store.isDeleted == true
    }
  }
`);

type RawVariant = Variant & { deleted: boolean };

let cache: Promise<Product[]> | undefined;

/** Every active product, newest first. Fetched once per build. */
export function getProducts(): Promise<Product[]> {
  cache ??= sanityClient.fetch<Omit<Product, 'available'>[]>(PRODUCTS_QUERY).then((products) =>
    products.map((product) => {
      // A dangling variant reference dereferences to null; drop those and
      // variants Shopify has deleted.
      const variants = ((product.variants ?? []) as (RawVariant | null)[])
        .filter((variant): variant is RawVariant => variant !== null && !!variant.id && !variant.deleted)
        .map(({ deleted: _deleted, ...variant }) => variant);
      return { ...product, variants, available: variants.some((variant) => variant.available) };
    }),
  );
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

/** The store's own domain, where checkout happens. */
export const STORE_URL = (import.meta.env.PUBLIC_STORE_URL || 'https://shop.bikes.pizza/').replace(/\/+$/, '');

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
