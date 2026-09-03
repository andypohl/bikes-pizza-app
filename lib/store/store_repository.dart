import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config.dart';
import 'product.dart';

class ProductPage {
  const ProductPage({required this.products, this.endCursor, this.hasMore = false});

  final List<Product> products;
  final String? endCursor;
  final bool hasMore;
}

class StoreException implements Exception {
  StoreException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// Catalogue + checkout for the Store tab.
abstract class StoreRepository {
  Future<ProductPage> fetchProducts({String? after});

  /// Creates a cart with one line and returns Shopify's hosted checkout URL.
  /// [email] pre-fills the checkout when the shopper is signed in.
  Future<Uri> createCheckout({
    required String variantId,
    int quantity = 1,
    String? email,
  });

  /// Returns a Shopify-backed repository when the build carries store
  /// settings, otherwise null (the Store tab shows a placeholder).
  static StoreRepository? forConfig() => ShopifyConfig.isConfigured
      ? ShopifyStorefrontRepository(
          storeDomain: ShopifyConfig.storeDomain,
          accessToken: ShopifyConfig.storefrontToken,
        )
      : null;
}

/// Talks to Shopify's Storefront GraphQL API with a public access token.
/// Docs: https://shopify.dev/docs/api/storefront
class ShopifyStorefrontRepository implements StoreRepository {
  ShopifyStorefrontRepository({
    required this.storeDomain,
    required this.accessToken,
    this.apiVersion = ShopifyConfig.apiVersion,
    http.Client? client,
  }) : _client = client ?? http.Client();

  final String storeDomain;
  final String accessToken;
  final String apiVersion;
  final http.Client _client;

  Uri get endpoint =>
      Uri.https(storeDomain, '/api/$apiVersion/graphql.json');

  static const _productsQuery = r'''
query Products($first: Int!, $after: String) {
  products(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        title
        handle
        description
        availableForSale
        featuredImage { url(transform: {maxWidth: 800, maxHeight: 800}) altText }
        priceRange { minVariantPrice { amount currencyCode } }
        variants(first: 20) {
          edges {
            node { id title availableForSale price { amount currencyCode } }
          }
        }
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

  @override
  Future<ProductPage> fetchProducts({String? after}) async {
    final data = await _query(_productsQuery, {
      'first': ShopifyConfig.pageSize,
      'after': after,
    });
    final products = (data['products'] as Map?)?.cast<String, dynamic>();
    if (products == null) throw StoreException('Shopify returned no products.');

    final edges = (products['edges'] as List?) ?? const [];
    final pageInfo =
        (products['pageInfo'] as Map?)?.cast<String, dynamic>() ?? const {};

    return ProductPage(
      products: edges
          .map((e) => (e as Map)['node'])
          .whereType<Map>()
          .map((n) => Product.fromJson(n.cast<String, dynamic>()))
          .toList(growable: false),
      endCursor: pageInfo['endCursor'] as String?,
      hasMore: pageInfo['hasNextPage'] as bool? ?? false,
    );
  }

  @override
  Future<Uri> createCheckout({
    required String variantId,
    int quantity = 1,
    String? email,
  }) async {
    final data = await _query(_cartCreateMutation, {
      'input': {
        'lines': [
          {'merchandiseId': variantId, 'quantity': quantity},
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
    if (uri == null) throw StoreException('Shopify did not return a checkout URL.');
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
