/// Static configuration for talking to the Ghost site behind pizzapredator.com.
///
/// The Ghost Content API key is supplied at build time so it never has to be
/// committed to source control:
///
///   flutter run --dart-define=GHOST_CONTENT_API_KEY=your_key_here
///
/// Create a key in Ghost Admin: Settings -> Integrations -> Add custom
/// integration, then copy the "Content API key". When no key is provided the
/// app falls back to the site's public RSS feeds, which only expose the 15
/// most recent posts per feed.
class GhostConfig {
  GhostConfig._();

  /// Canonical site origin. The apex domain 301-redirects here.
  static const String siteUrl = 'https://www.pizzapredator.com';

  static const String contentApiKey =
      String.fromEnvironment('GHOST_CONTENT_API_KEY');

  static bool get hasContentApiKey => contentApiKey.isNotEmpty;

  /// Posts fetched per page from the Content API.
  static const int pageSize = 15;
}

/// Shopify Storefront API settings. Both values come from the Shopify admin
/// (a Headless channel or a custom app with Storefront API access) and are
/// supplied at build time, typically via `--dart-define-from-file`:
///
///   flutter run --dart-define-from-file=config/local.json
///
/// The Storefront access token is a *public* token by Shopify's design: it
/// can only read the catalogue and create carts, so shipping it inside the
/// app is expected. It is still kept out of the repo so the store can be
/// swapped without a code change.
class ShopifyConfig {
  ShopifyConfig._();

  /// e.g. `your-store.myshopify.com`
  static const String storeDomain =
      String.fromEnvironment('SHOPIFY_STORE_DOMAIN');

  static const String storefrontToken =
      String.fromEnvironment('SHOPIFY_STOREFRONT_TOKEN');

  /// Storefront API version, see
  /// https://shopify.dev/docs/api/usage/versioning
  static const String apiVersion = '2025-07';

  static bool get isConfigured =>
      storeDomain.isNotEmpty && storefrontToken.isNotEmpty;

  static const int pageSize = 20;
}
