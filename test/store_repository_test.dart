import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:bikes_pizza/store/cart.dart';
import 'package:bikes_pizza/store/product.dart';
import 'package:bikes_pizza/store/store_repository.dart';

/// A product node as the Storefront API's `products` query returns it.
Map<String, dynamic> _node(
  String id, {
  String category = '',
  bool available = true,
  List<dynamic>? variants,
}) => {
  'id': 'gid://shopify/Product/$id',
  'title': 'Product $id',
  'handle': 'product-$id',
  'productType': category,
  'descriptionHtml': '<p>Desc &amp; more <b>$id</b></p>',
  'availableForSale': available,
  'featuredImage': {'url': 'https://cdn.shopify.com/s/files/1/$id.jpg'},
  'priceRange': {
    'minVariantPrice': {'amount': '12.5', 'currencyCode': 'USD'},
  },
  'variants': {
    'nodes':
        variants ??
        [
          {
            'id': 'gid://shopify/ProductVariant/$id',
            'title': 'Default Title',
            'availableForSale': available,
            'price': {'amount': '12.5', 'currencyCode': 'USD'},
            'image': null,
          },
        ],
  },
};

Map<String, dynamic> _variant(int id, String title, bool available) => {
  'id': 'gid://shopify/ProductVariant/$id',
  'title': title,
  'availableForSale': available,
  'price': {'amount': '20.0', 'currencyCode': 'USD'},
  'image': {'url': 'https://cdn.shopify.com/s/files/1/v$id.jpg'},
};

String _page(
  List<Map<String, dynamic>> nodes, {
  bool hasNextPage = false,
  String? endCursor,
}) => jsonEncode({
  'data': {
    'products': {
      'pageInfo': {'hasNextPage': hasNextPage, 'endCursor': endCursor},
      'nodes': nodes,
    },
  },
});

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
  ShopifyStorefront storefrontOn(MockClient client) => ShopifyStorefront(
    storeDomain: 'demo.myshopify.com',
    accessToken: 'public-token',
    client: client,
  );

  ShopifyStoreRepository repo(
    MockClient client, {
    ShopifyStorefront? storefront,
  }) => ShopifyStoreRepository(
    storeUrl: 'https://shop.example.com/',
    storefront: storefront,
  );

  test('reads products from the Storefront API, page by page', () async {
    final captured = <http.Request>[];
    final client = MockClient((req) async {
      captured.add(req);
      return captured.length == 1
          ? http.Response(
              _page([_node('1')], hasNextPage: true, endCursor: 'c1'),
              200,
            )
          : http.Response(_page([_node('2')]), 200);
    });
    final products = await repo(
      client,
      storefront: storefrontOn(client),
    ).fetchProducts();

    expect(products.map((p) => p.title), ['Product 1', 'Product 2']);
    expect(captured.length, 2);
    expect(
      captured.first.url.toString(),
      'https://demo.myshopify.com/api/2025-07/graphql.json',
    );
    expect(
      captured.first.headers['X-Shopify-Storefront-Access-Token'],
      'public-token',
    );
    final first = jsonDecode(captured.first.body) as Map;
    expect(first['query'], contains('products(first: \$first, after: \$after'));
    expect(first['variables'], {'first': 100, 'after': null});
    expect((jsonDecode(captured.last.body) as Map)['variables'], {
      'first': 100,
      'after': 'c1',
    });
  });

  test('a build without the store settings has no products', () {
    final client = MockClient((_) async => http.Response('', 200));
    expect(repo(client).fetchProducts(), throwsA(isA<StoreException>()));
  });

  test(
    'parses products, variants, categories and plain descriptions',
    () async {
      final nodes = [
        _node('1', category: 'Stickers'),
        _node(
          '2',
          variants: [
            _variant(21, 'S', false),
            _variant(22, 'M', true),
            {'id': 'gid://shopify/Draft/x', 'title': 'no numeric id'},
            null,
          ],
        ),
        _node('3', available: false),
      ];
      final client = MockClient((_) async => http.Response(_page(nodes), 200));
      final products = await repo(
        client,
        storefront: storefrontOn(client),
      ).fetchProducts();

      final one = products[0];
      expect(one.category, 'Stickers');
      expect(one.description, 'Desc & more 1');
      expect(one.price.amount, 12.5);
      expect(one.imageUrl, 'https://cdn.shopify.com/s/files/1/1.jpg');
      expect(one.hasChoices, isFalse);
      expect(one.availableForSale, isTrue);
      expect(one.variants.single.numericId, 1);
      expect(one.variants.single.id, 'gid://shopify/ProductVariant/1');

      final two = products[1];
      expect(two.hasChoices, isTrue);
      // Variants without a Shopify id are dropped.
      expect(two.variants.map((v) => v.title), ['S', 'M']);
      expect(two.variants.map((v) => v.numericId), [21, 22]);
      expect(
        two.variants[1].imageUrl,
        'https://cdn.shopify.com/s/files/1/v22.jpg',
      );
      expect(two.availableForSale, isTrue);

      expect(products[2].availableForSale, isFalse);
    },
  );

  test('rejects error responses', () async {
    final client = MockClient((_) async => http.Response('nope', 500));
    expect(
      repo(client, storefront: storefrontOn(client)).fetchProducts(),
      throwsA(isA<StoreException>()),
    );
    final failing = MockClient(
      (_) async => http.Response(
        jsonEncode({
          'errors': [
            {'message': 'Invalid access token'},
          ],
        }),
        200,
      ),
    );
    expect(
      repo(failing, storefront: storefrontOn(failing)).fetchProducts(),
      throwsA(
        isA<StoreException>().having(
          (e) => e.message,
          'message',
          contains('Invalid access token'),
        ),
      ),
    );
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
