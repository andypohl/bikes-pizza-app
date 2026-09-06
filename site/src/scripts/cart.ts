// The shopping cart, kept in this browser (localStorage) until checkout,
// when the whole cart is handed to Shopify as one cart permalink. Nothing
// is sent anywhere before that. Components listen for `cart:change` on
// `window` (also fired when another tab changes the cart) to re-render.

export interface CartItem {
  /** Shopify's numeric variant id, what the permalink needs. */
  variantId: number;
  handle: string;
  title: string;
  /** Empty for Shopify's single default variant. */
  variantTitle: string;
  price: number;
  image: string | null;
  quantity: number;
}

const KEY = 'bikes.pizza:cart';
const EVENT = 'cart:change';

export function readCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const items = raw ? (JSON.parse(raw) as CartItem[]) : [];
    return Array.isArray(items) ? items.filter((item) => item && item.variantId > 0 && item.quantity > 0) : [];
  } catch {
    return [];
  }
}

function write(items: CartItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage unavailable (private mode, quota): the cart lives for this page only.
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function addItem(item: Omit<CartItem, 'quantity'>, quantity = 1): CartItem[] {
  const items = readCart();
  const existing = items.find((line) => line.variantId === item.variantId);
  if (existing) existing.quantity += quantity;
  else items.push({ ...item, quantity });
  write(items);
  return items;
}

export function setQuantity(variantId: number, quantity: number): CartItem[] {
  const items = readCart()
    .map((line) => (line.variantId === variantId ? { ...line, quantity } : line))
    .filter((line) => line.quantity > 0);
  write(items);
  return items;
}

export function removeItem(variantId: number): CartItem[] {
  return setQuantity(variantId, 0);
}

export function clearCart() {
  write([]);
}

export function countOf(items: CartItem[]): number {
  return items.reduce((sum, line) => sum + line.quantity, 0);
}

export function subtotalOf(items: CartItem[]): number {
  return items.reduce((sum, line) => sum + line.price * line.quantity, 0);
}

/** Shopify's cart permalink for every line: `/cart/<variant>:<qty>,<variant>:<qty>`. */
export function checkoutUrlFor(storeUrl: string, items: CartItem[]): string {
  const lines = items.map((line) => `${line.variantId}:${line.quantity}`).join(',');
  return `${storeUrl.replace(/\/+$/, '')}/cart/${lines}`;
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatMoney(amount: number): string {
  return money.format(amount);
}

/** Calls `fn` now and whenever the cart changes, here or in another tab. */
export function onCart(fn: (items: CartItem[]) => void) {
  fn(readCart());
  window.addEventListener(EVENT, () => fn(readCart()));
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) fn(readCart());
  });
}
