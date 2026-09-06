/// A price in a single currency.
class Money {
  const Money({required this.amount, required this.currencyCode});

  final double amount;
  final String currencyCode;

  Money times(int quantity) =>
      Money(amount: amount * quantity, currencyCode: currencyCode);

  Money plus(Money other) =>
      Money(amount: amount + other.amount, currencyCode: currencyCode);

  factory Money.fromJson(Map<String, dynamic> json) => Money(
    amount: double.tryParse('${json['amount']}') ?? 0,
    currencyCode: json['currencyCode'] as String? ?? 'USD',
  );
}

class ProductVariant {
  const ProductVariant({
    required this.id,
    required this.numericId,
    required this.title,
    required this.price,
    required this.availableForSale,
    this.imageUrl,
  });

  /// Shopify GID, e.g. `gid://shopify/ProductVariant/123`. This is what a
  /// Storefront cart line refers to.
  final String id;

  /// The number in the GID, which Shopify's cart permalink uses.
  final int numericId;
  final String title;
  final Money price;
  final bool availableForSale;
  final String? imageUrl;

  /// Shopify's name for the one variant of a product without options.
  static const defaultTitle = 'Default Title';

  /// Parses a variant from the `productVariant` document Sanity Connect for
  /// Shopify writes (projected by `SanityStoreRepository`).
  factory ProductVariant.fromSanityJson(Map<dynamic, dynamic> json) {
    final numericId = (json['id'] as num?)?.toInt() ?? 0;
    return ProductVariant(
      id: json['gid'] as String? ?? 'gid://shopify/ProductVariant/$numericId',
      numericId: numericId,
      title: json['title'] as String? ?? defaultTitle,
      price: Money(
        amount: (json['price'] as num?)?.toDouble() ?? 0,
        currencyCode: 'USD',
      ),
      availableForSale: json['available'] as bool? ?? false,
      imageUrl: json['image'] as String?,
    );
  }
}

class Product {
  const Product({
    required this.id,
    required this.title,
    required this.handle,
    required this.description,
    required this.price,
    required this.availableForSale,
    this.category = '',
    this.imageUrl,
    this.variants = const [],
  });

  final String id;
  final String title;
  final String handle;

  /// Plain-text description.
  final String description;

  /// Shopify's "product type", which the store uses as its category.
  final String category;

  /// Lowest variant price, for the grid.
  final Money price;
  final bool availableForSale;
  final String? imageUrl;
  final List<ProductVariant> variants;

  /// True when there is a real choice to make, rather than Shopify's single
  /// default variant.
  bool get hasChoices =>
      variants.length > 1 ||
      (variants.length == 1 &&
          variants.first.title != ProductVariant.defaultTitle);

  /// Parses a product from the projection `SanityStoreRepository` requests.
  factory Product.fromSanityJson(Map<String, dynamic> json) {
    final rawVariants = json['variants'];
    final variants = (rawVariants is List ? rawVariants : const [])
        .whereType<Map>()
        .where((v) => (v['id'] as num?) != null && v['deleted'] != true)
        .map(ProductVariant.fromSanityJson)
        .toList(growable: false);
    return Product(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '(untitled)',
      handle: json['handle'] as String? ?? '',
      description: stripHtml(json['descriptionHtml'] as String? ?? ''),
      category: (json['category'] as String? ?? '').trim(),
      price: Money(
        amount: (json['price'] as num?)?.toDouble() ?? 0,
        currencyCode: 'USD',
      ),
      availableForSale: variants.any((v) => v.availableForSale),
      imageUrl: json['image'] as String?,
      variants: variants,
    );
  }

  /// Shopify's product description is HTML; the app shows plain text.
  static String stripHtml(String html) => html
      .replaceAll(RegExp(r'<br\s*/?>|</p>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'<[^>]+>'), '')
      .replaceAll('&amp;', '&')
      .replaceAll('&nbsp;', ' ')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll(RegExp(r'\n{3,}'), '\n\n')
      .trim();
}

/// Resizes a Shopify CDN image on their side; with [height] it is cropped
/// to the box from the centre.
String shopifyImage(String url, int width, {int? height}) {
  final uri = Uri.tryParse(url);
  if (uri == null || !uri.hasScheme || uri.host.isEmpty) return url;
  return uri
      .replace(
        queryParameters: {
          ...uri.queryParameters,
          'width': '$width',
          if (height != null) 'height': '$height',
          if (height != null) 'crop': 'center',
        },
      )
      .toString();
}
