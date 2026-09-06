import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:pizza_predator/store/cart.dart';
import 'package:pizza_predator/store/product.dart';
import 'package:pizza_predator/store/store_repository.dart';

/// A product row as `SanityStoreRepository`'s projection returns it.
Map<String, dynamic> _row(
  String id, {
  String category = '',
  bool available = true,
  List<dynamic>? variants,
}) => {
  'id': 'shopifyProduct-$id',
  'title': 'Product $id',
  'handle': 'product-$id',
  'category': category,
  'descriptionHtml': '<p>Desc &amp; more <b>$id</b></p>',
  'image': 'https://cdn.shopify.com/s/files/1/$id.jpg',
  'price': 12.5,
  'variants':
      variants ??
      [
        {
          'id': int.parse(id),
          'gid': 'gid://shopify/ProductVariant/$id',
          'title': 'Default Title',
          'price': 12.5,
          'available': available,
          'image': null,
          'deleted': false,
        },
      ],
};

String _result(List<Map<String, dynamic>> rows) =>
    jsonEncode({'ms': 3, 'query': '', 'result': rows});

CartItem _item(int id, int quantity) => CartItem(
  variantId: 'gid://shopify/ProductVariant/$id',
  numericId: id,
  handle: 'p$id',
  title: 'P$id',
  variantTitle: '',
  price: const Money(amount: 10, currencyCode: 'USD'),
  quantity: quantity,
);

void main() {
  SanityStoreRepository repo(
    MockClient client, {
    ShopifyStorefront? storefront,
  }) => SanityStoreRepository(
    projectId: 'abc123',
    dataset: 'development',
    apiVersion: '2025-02-19',
    storeUrl: 'https://shop.example.com/',
    storefront: storefront,
    client: client,
  );

  test('reads active products from the API CDN', () async {
    late http.Request captured;
    final client = MockClient((req) async {
      captured = req;
      return http.Response(_result([_row('1')]), 200);
    });
    final products = await repo(client).fetchProducts();

    expect(captured.url.host, 'abc123.apicdn.sanity.io');
    expect(captured.url.path, '/v2025-02-19/data/query/development');
    expect(
      captured.url.queryParameters['query'],
      contains('_type == "product"'),
    );
    expect(
      captured.url.queryParameters['query'],
      contains('store.status == "active"'),
    );
    expect(products.single.title, 'Product 1');
  });

  test(
    'parses products, variants, categories and plain descriptions',
    () async {
      final rows = [
        _row('1', category: 'Stickers'),
        _row(
          '2',
          variants: [
            {
              'id': 21,
              'gid': 'gid://shopify/ProductVariant/21',
              'title': 'S',
              'price': 20,
              'available': false,
              'deleted': false,
            },
            {
              'id': 22,
              'gid': 'gid://shopify/ProductVariant/22',
              'title': 'M',
              'price': 20,
              'available': true,
              'deleted': false,
            },
            {
              'id': 23,
              'gid': 'gid://shopify/ProductVariant/23',
              'title': 'L',
              'price': 20,
              'available': true,
              'deleted': true,
            },
            null,
          ],
        ),
        _row('3', available: false),
      ];
      final client = MockClient((_) async => http.Response(_result(rows), 200));
      final products = await repo(client).fetchProducts();

      final one = products[0];
      expect(one.category, 'Stickers');
      expect(one.description, 'Desc & more 1');
      expect(one.price.amount, 12.5);
      expect(one.imageUrl, 'https://cdn.shopify.com/s/files/1/1.jpg');
      expect(one.hasChoices, isFalse);
      expect(one.availableForSale, isTrue);
      expect(one.variants.single.numericId, 1);

      final two = products[1];
      expect(two.hasChoices, isTrue);
      // Deleted and dangling variants are dropped.
      expect(two.variants.map((v) => v.title), ['S', 'M']);
      expect(two.availableForSale, isTrue);

      expect(products[2].availableForSale, isFalse);
    },
  );

  test('rejects error responses', () async {
    final client = MockClient((_) async => http.Response('nope', 500));
    expect(repo(client).fetchProducts(), throwsA(isA<StoreException>()));
  });

  test(
    'checks out through the cart permalink without a Storefront token',
    () async {
      final client = MockClient((_) async => http.Response('', 200));
      final url = await repo(client).checkout([_item(1, 2), _item(2, 1)]);
      expect(url.toString(), 'https://shop.example.com/cart/1:2,2:1');
      expect(repo(client).checkout(const []), throwsA(isA<StoreException>()));
    },
  );

  test(
    'checks out through the Storefront API with the email when configured',
    () async {
      late http.Request captured;
      final client = MockClient((req) async {
        captured = req;
        return http.Response(
          jsonEncode({
            'data': {
              'cartCreate': {
                'cart': {
                  'id': 'gid://shopify/Cart/1',
                  'checkoutUrl': 'https://shop.example.com/checkouts/1',
                },
                'userErrors': [],
              },
            },
          }),
          200,
        );
      });
      final storefront = ShopifyStorefront(
        storeDomain: 'demo.myshopify.com',
        accessToken: 'public-token',
        client: client,
      );
      final url = await repo(
        client,
        storefront: storefront,
      ).checkout([_item(1, 2), _item(2, 1)], email: 'andy@example.com');

      expect(url.toString(), 'https://shop.example.com/checkouts/1');
      expect(
        captured.url.toString(),
        'https://demo.myshopify.com/api/2025-07/graphql.json',
      );
      expect(
        captured.headers['X-Shopify-Storefront-Access-Token'],
        'public-token',
      );
      final input =
          ((jsonDecode(captured.body) as Map)['variables'] as Map)['input']
              as Map;
      expect(input['lines'], [
        {'merchandiseId': 'gid://shopify/ProductVariant/1', 'quantity': 2},
        {'merchandiseId': 'gid://shopify/ProductVariant/2', 'quantity': 1},
      ]);
      expect(input['buyerIdentity'], {'email': 'andy@example.com'});
    },
  );

  test('surfaces Storefront user errors', () async {
    final client = MockClient(
      (_) async => http.Response(
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
      ),
    );
    final storefront = ShopifyStorefront(
      storeDomain: 'demo.myshopify.com',
      accessToken: 'public-token',
      client: client,
    );
    expect(
      repo(client, storefront: storefront).checkout([_item(1, 1)]),
      throwsA(
        isA<StoreException>().having(
          (e) => e.message,
          'message',
          contains('sold out'),
        ),
      ),
    );
  });

  test('resizes Shopify CDN images on their side', () {
    expect(
      shopifyImage(
        'https://cdn.shopify.com/s/files/1/a.jpg?v=1',
        800,
        height: 600,
      ),
      'https://cdn.shopify.com/s/files/1/a.jpg?v=1&width=800&height=600&crop=center',
    );
    expect(shopifyImage('not a url', 800), 'not a url');
  });
}
