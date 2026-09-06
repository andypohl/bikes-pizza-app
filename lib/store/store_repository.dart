import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config.dart';
import 'cart.dart';
import 'product.dart';

class StoreException implements Exception {
  StoreException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// Catalogue + checkout for the Store tab.
abstract class StoreRepository {
  /// Every product for sale, newest first.
  Future<List<Product>> fetchProducts();

  /// Where to send the shopper to pay for [items]: Shopify's hosted
  /// checkout. [email] pre-fills it when the shopper is signed in (only
  /// possible through the Storefront API; the cart permalink cannot).
  Future<Uri> checkout(List<CartItem> items, {String? email});

  /// The catalogue comes from Sanity, like posts; checkout goes through the
  /// Storefront API when the build carries its settings, else through the
  /// store's cart permalink.
  static StoreRepository forConfig() => SanityStoreRepository(
    projectId: SanityConfig.projectId,
    dataset: SanityConfig.dataset,
    apiVersion: SanityConfig.apiVersion,
    storeUrl: ShopifyConfig.storeUrl,
    storefront: ShopifyConfig.isConfigured
        ? ShopifyStorefront(
            storeDomain: ShopifyConfig.storeDomain,
            accessToken: ShopifyConfig.storefrontToken,
          )
        : null,
  );
}

/// Reads the products that Sanity Connect for Shopify keeps in the dataset
/// (`product` and `productVariant` documents), the same ones the website's
/// shop is built from, through the API CDN.
class SanityStoreRepository implements StoreRepository {
  SanityStoreRepository({
    required this.projectId,
    required this.dataset,
    required this.apiVersion,
    required this.storeUrl,
    this.storefront,
    http.Client? client,
  }) : _client = client ?? http.Client();

  final String projectId;
  final String dataset;
  final String apiVersion;

  /// The store's own domain, where the cart permalink checks out.
  final String storeUrl;
  final ShopifyStorefront? storefront;
  final http.Client _client;

  /// The same shape the website's `site/src/lib/shop.ts` reads.
  static const query = '''
*[_type == "product" && store.status == "active" && store.isDeleted != true && defined(store.slug.current)]
  | order(store.createdAt desc) {
  "id": _id,
  "title": store.title,
  "handle": store.slug.current,
  "category": coalesce(store.productType, ""),
  "descriptionHtml": coalesce(store.descriptionHtml, ""),
  "image": store.previewImageUrl,
  "price": coalesce(store.priceRange.minVariantPrice, 0),
  "variants": store.variants[]->{
    "id": store.id,
    "gid": store.gid,
    "title": store.title,
    "price": coalesce(store.price, 0),
    "available": coalesce(store.inventory.isAvailable, false),
    "image": store.previewImageUrl,
    "deleted": store.isDeleted == true
  }
}''';

  Uri get uri => Uri.https(
    '$projectId.apicdn.sanity.io',
    '/v$apiVersion/data/query/$dataset',
    {'query': query},
  );

  @override
  Future<List<Product>> fetchProducts() async {
    final response = await _client.get(
      uri,
      headers: const {'Accept': 'application/json'},
    );
    if (response.statusCode != 200) {
      throw StoreException('Sanity API returned HTTP ${response.statusCode}');
    }
    final body = jsonDecode(response.body);
    final result = body is Map<String, dynamic> ? body['result'] : null;
    if (result is! List) {
      throw StoreException('Unexpected response from Sanity API');
    }
    return result
        .whereType<Map<String, dynamic>>()
        .map(Product.fromSanityJson)
        .toList(growable: false);
  }

  @override
  Future<Uri> checkout(List<CartItem> items, {String? email}) async {
    if (items.isEmpty) throw StoreException('Nothing to check out.');
    final storefront = this.storefront;
    if (storefront != null) return storefront.createCheckout(items, email);
    return permalink(items);
  }

  /// Shopify's cart permalink: `/cart/<variant>:<qty>,<variant>:<qty>`.
  Uri permalink(List<CartItem> items) {
    final lines = items.map((i) => '${i.numericId}:${i.quantity}').join(',');
    return Uri.parse('${storeUrl.replaceAll(RegExp(r'/+$'), '')}/cart/$lines');
  }
}

/// Creates carts through Shopify's Storefront GraphQL API with a public
/// access token, which lets the checkout be pre-filled with the shopper's
/// email. Docs: https://shopify.dev/docs/api/storefront
class ShopifyStorefront {
  ShopifyStorefront({
    required this.storeDomain,
    required this.accessToken,
    this.apiVersion = ShopifyConfig.apiVersion,
    http.Client? client,
  }) : _client = client ?? http.Client();

  final String storeDomain;
  final String accessToken;
  final String apiVersion;
  final http.Client _client;

  Uri get endpoint => Uri.https(storeDomain, '/api/$apiVersion/graphql.json');

  static const _cartCreateMutation = r'''
mutation CartCreate($input: CartInput!) {
  cartCreate(input: $input) {
    cart { id checkoutUrl }
    userErrors { field message }
  }
}''';

  Future<Uri> createCheckout(List<CartItem> items, String? email) async {
    final data = await _query(_cartCreateMutation, {
      'input': {
        'lines': [
          for (final item in items)
            {'merchandiseId': item.variantId, 'quantity': item.quantity},
        ],
        if (email != null && email.isNotEmpty)
          'buyerIdentity': {'email': email},
      },
    });
    final result = (data['cartCreate'] as Map?)?.cast<String, dynamic>();
    final errors = (result?['userErrors'] as List?) ?? const [];
    if (errors.isNotEmpty) {
      final message = (errors.first as Map)['message'];
      throw StoreException('Could not start checkout: $message');
    }
    final url = ((result?['cart'] as Map?)?['checkoutUrl']) as String?;
    final uri = url == null ? null : Uri.tryParse(url);
    if (uri == null) {
      throw StoreException('Shopify did not return a checkout URL.');
    }
    return uri;
  }

  Future<Map<String, dynamic>> _query(
    String query,
    Map<String, dynamic> variables,
  ) async {
    final response = await _client.post(
      endpoint,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': accessToken,
      },
      body: jsonEncode({'query': query, 'variables': variables}),
    );
    if (response.statusCode != 200) {
      throw StoreException('Shopify returned HTTP ${response.statusCode}');
    }
    final body = jsonDecode(response.body);
    if (body is! Map<String, dynamic>) {
      throw StoreException('Unexpected response from Shopify');
    }
    final errors = body['errors'];
    if (errors is List && errors.isNotEmpty) {
      final message = (errors.first as Map)['message'];
      throw StoreException('Shopify error: $message');
    }
    return (body['data'] as Map?)?.cast<String, dynamic>() ?? const {};
  }
}
