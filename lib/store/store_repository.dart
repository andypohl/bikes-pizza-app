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

  /// Products and carts both come from the Storefront API when the build
  /// carries its settings (`ShopifyConfig`); without them the store has
  /// no products and checkout goes through the store's cart permalink.
  static StoreRepository forConfig() => ShopifyStoreRepository(
    storeUrl: ShopifyConfig.storeUrl,
    storefront: ShopifyConfig.isConfigured
        ? ShopifyStorefront(
            storeDomain: ShopifyConfig.storeDomain,
            accessToken: ShopifyConfig.storefrontToken,
          )
        : null,
  );
}

/// The store on Shopify's Storefront API: the same products the website's
/// shop is built from, read live.
class ShopifyStoreRepository implements StoreRepository {
  ShopifyStoreRepository({required this.storeUrl, this.storefront});

  /// The store's own domain, where the cart permalink checks out.
  final String storeUrl;
  final ShopifyStorefront? storefront;

  @override
  Future<List<Product>> fetchProducts() async {
    final storefront = this.storefront;
    if (storefront == null) {
      throw StoreException('This build was made without the store settings.');
    }
    return storefront.fetchProducts();
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

/// Reads products and creates carts through Shopify's Storefront GraphQL
/// API with the store's public access token; a cart made here can be
/// pre-filled with the shopper's email. Docs:
/// https://shopify.dev/docs/api/storefront
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

  /// Every product the token's sales channel offers, newest first, a
  /// page at a time (the website's `site/src/lib/shop.ts` asks the same).
  static const productsQuery = r'''
query Products($first: Int!, $after: String) {
  products(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title handle productType descriptionHtml availableForSale
      featuredImage { url }
      priceRange { minVariantPrice { amount currencyCode } }
      variants(first: 100) {
        nodes { id title availableForSale price { amount currencyCode } image { url } }
      }
    }
  }
}''';

  static const _cartCreateMutation = r'''
mutation CartCreate($input: CartInput!) {
  cartCreate(input: $input) {
    cart { id checkoutUrl }
    userErrors { field message }
  }
}''';

  /// Every product, newest first.
  Future<List<Product>> fetchProducts() async {
    final products = <Product>[];
    String? after;
    do {
      final data = await _query(productsQuery, {'first': 100, 'after': after});
      final page = (data['products'] as Map?)?.cast<String, dynamic>();
      final nodes = page?['nodes'];
      if (nodes is! List) {
        throw StoreException('Unexpected response from Shopify');
      }
      products.addAll(
        nodes
            .whereType<Map>()
            .map((node) => Product.fromStorefrontJson(node.cast()))
            .where((product) => product.handle.isNotEmpty),
      );
      final info = (page?['pageInfo'] as Map?) ?? const {};
      after = info['hasNextPage'] == true ? info['endCursor'] as String? : null;
    } while (after != null);
    return products;
  }

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
