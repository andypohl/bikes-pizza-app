import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:pizza_predator/store/store_repository.dart';

Map<String, dynamic> _productNode(String id, {bool available = true}) => {
      'id': 'gid://shopify/Product/$id',
      'title': 'Product $id',
      'handle': 'product-$id',
      'description': 'Desc $id',
      'availableForSale': available,
      'featuredImage': {'url': 'https://cdn.example/$id.jpg', 'altText': null},
      'priceRange': {
        'minVariantPrice': {'amount': '12.50', 'currencyCode': 'USD'},
      },
      'variants': {
        'edges': [
          {
            'node': {
              'id': 'gid://shopify/ProductVariant/$id-1',
              'title': 'Default Title',
              'availableForSale': available,
              'price': {'amount': '12.50', 'currencyCode': 'USD'},
            },
          },
        ],
      },
    };

String _productsBody({bool hasNext = false}) => jsonEncode({
      'data': {
        'products': {
          'pageInfo': {'hasNextPage': hasNext, 'endCursor': 'cur1'},
          'edges': [
            {'node': _productNode('a')},
            {'node': _productNode('b', available: false)},
          ],
        },
      },
    });

void main() {
  ShopifyStorefrontRepository repo(MockClient client) =>
      ShopifyStorefrontRepository(
        storeDomain: 'demo.myshopify.com',
        accessToken: 'public-token',
        client: client,
      );

  test('posts to the versioned GraphQL endpoint with the token header',
      () async {
    late http.Request captured;
    final client = MockClient((req) async {
      captured = req;
      return http.Response(_productsBody(), 200);
    });

    await repo(client).fetchProducts();

    expect(captured.url.toString(),
        'https://demo.myshopify.com/api/2025-07/graphql.json');
    expect(captured.headers['X-Shopify-Storefront-Access-Token'],
        'public-token');
    final body = jsonDecode(captured.body) as Map<String, dynamic>;
    expect(body['query'], contains('products('));
    expect((body['variables'] as Map)['first'], 20);
  });

  test('parses products, prices, images and paging', () async {
    final client =
        MockClient((_) async => http.Response(_productsBody(hasNext: true), 200));

    final page = await repo(client).fetchProducts();

    expect(page.hasMore, isTrue);
    expect(page.endCursor, 'cur1');
    expect(page.products, hasLength(2));
    final a = page.products.first;
    expect(a.title, 'Product a');
    expect(a.price.amount, 12.5);
    expect(a.price.currencyCode, 'USD');
    expect(a.imageUrl, 'https://cdn.example/a.jpg');
    expect(a.variants.single.id, 'gid://shopify/ProductVariant/a-1');
    expect(a.hasSingleVariant, isTrue);
    expect(page.products.last.availableForSale, isFalse);
  });

  test('createCheckout returns the checkout URL and passes the email',
      () async {
    late Map<String, dynamic> variables;
    final client = MockClient((req) async {
      variables = (jsonDecode(req.body) as Map)['variables'] as Map<String, dynamic>;
      return http.Response(
        jsonEncode({
          'data': {
            'cartCreate': {
              'cart': {
                'id': 'gid://shopify/Cart/1',
                'checkoutUrl': 'https://demo.myshopify.com/checkouts/abc',
              },
              'userErrors': [],
            },
          },
        }),
        200,
      );
    });

    final url = await repo(client).createCheckout(
      variantId: 'gid://shopify/ProductVariant/a-1',
      email: 'andy@example.com',
    );

    expect(url.toString(), 'https://demo.myshopify.com/checkouts/abc');
    final input = variables['input'] as Map;
    expect((input['lines'] as List).single,
        {'merchandiseId': 'gid://shopify/ProductVariant/a-1', 'quantity': 1});
    expect(input['buyerIdentity'], {'email': 'andy@example.com'});
  });

  test('surfaces Shopify user errors and GraphQL errors', () async {
    final userError = MockClient((_) async => http.Response(
          jsonEncode({
            'data': {
              'cartCreate': {
                'cart': null,
                'userErrors': [
                  {'field': null, 'message': 'Variant is sold out'},
                ],
              },
            },
          }),
          200,
        ));
    expect(
      () => repo(userError).createCheckout(variantId: 'x'),
      throwsA(isA<StoreException>()
          .having((e) => e.message, 'message', contains('sold out'))),
    );

    final gqlError = MockClient((_) async => http.Response(
          jsonEncode({
            'errors': [
              {'message': 'Invalid access token'},
            ],
          }),
          200,
        ));
    expect(
      () => repo(gqlError).fetchProducts(),
      throwsA(isA<StoreException>()
          .having((e) => e.message, 'message', contains('Invalid access token'))),
    );

    final http401 = MockClient((_) async => http.Response('nope', 401));
    expect(() => repo(http401).fetchProducts(), throwsA(isA<StoreException>()));
  });
}
