import 'package:flutter/foundation.dart';

/// The website that shows the same posts as the app. Posts themselves are
/// read from the Firebase project the build signs in to (see main.dart:
/// release builds use the production project, the rest the development
/// one), so they need no setting of their own.
class SiteConfig {
  SiteConfig._();

  /// Canonical origin of the website.
  static String get siteUrl =>
      kReleaseMode ? 'https://bikes.pizza' : 'https://bikes-pizza.dev';

  /// Posts fetched per page.
  static const int pageSize = 15;
}

/// The REST API behind the submissions site (`docs/api.md`): editing posts
/// and, on tablets, the review and admin screens. Requests carry the
/// signed-in member's Firebase ID token. Release builds talk to the
/// production API and the rest to the development one, matching the
/// Firebase project each signs in to; `--dart-define=API_URL=...` points a
/// build elsewhere (an emulator, say).
class ApiConfig {
  ApiConfig._();

  static const String _definedUrl = String.fromEnvironment('API_URL');

  static String get baseUrl => _definedUrl.isNotEmpty
      ? _definedUrl
      : (kReleaseMode
            ? 'https://submissions.bikes.pizza'
            : 'https://submissions.bikes-pizza.dev');
}

/// The Sanity dataset the store's products are still read from (see
/// `store/store_repository.dart`), until the shop moves to the Storefront
/// API. Release builds read `production`, the rest `development`;
/// `--dart-define=SANITY_PROJECT_ID=...` / `SANITY_DATASET=...` override.
class SanityConfig {
  SanityConfig._();

  static const String projectId = String.fromEnvironment(
    'SANITY_PROJECT_ID',
    defaultValue: 'nva9b0ia',
  );

  static const String _definedDataset = String.fromEnvironment(
    'SANITY_DATASET',
  );

  static String get dataset => _definedDataset.isNotEmpty
      ? _definedDataset
      : (kReleaseMode ? 'production' : 'development');

  /// Sanity API version (a date), see
  /// https://www.sanity.io/docs/api-versioning
  static const String apiVersion = '2025-02-19';
}

/// Shopify settings. The catalogue still comes from Sanity (see
/// `store/store_repository.dart`); Shopify is where checkout happens.
///
/// The store domain and Storefront access token come from the Shopify admin
/// (a Headless channel or a custom app with Storefront API access) and are
/// supplied at build time, typically via `--dart-define-from-file`:
///
///   flutter run --dart-define-from-file=config/local.json
///
/// With them, checkout goes through the Storefront API, which lets the
/// signed-in member's email pre-fill it. Without them, checkout uses the
/// store's cart permalink, which needs no token. The Storefront access
/// token is a *public* token by Shopify's design: it can only read the
/// catalogue and create carts, so shipping it inside the app is expected.
class ShopifyConfig {
  ShopifyConfig._();

  /// The store's own site, where the cart permalink opens checkout.
  static const String storeUrl = String.fromEnvironment(
    'SHOPIFY_STORE_URL',
    defaultValue: 'https://shop.bikes.pizza',
  );

  /// Host for Storefront API calls: `your-store.myshopify.com`, or a custom
  /// domain connected to the store. Checkout uses Shopify's primary domain.
  static const String storeDomain = String.fromEnvironment(
    'SHOPIFY_STORE_DOMAIN',
  );

  static const String storefrontToken = String.fromEnvironment(
    'SHOPIFY_STOREFRONT_TOKEN',
  );

  /// Storefront API version, see
  /// https://shopify.dev/docs/api/usage/versioning
  static const String apiVersion = '2025-07';

  static bool get isConfigured =>
      storeDomain.isNotEmpty && storefrontToken.isNotEmpty;
}
