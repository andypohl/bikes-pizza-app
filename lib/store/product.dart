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

  /// The number at the end of a Shopify GID, or 0 when it is not one.
  static int numericIdOf(String gid) =>
      int.tryParse(gid.split('/').last.split('?').first) ?? 0;

  /// Parses a variant node of the Storefront API's `products` query
  /// (`ShopifyStorefront.productsQuery`).
  factory ProductVariant.fromStorefrontJson(Map<dynamic, dynamic> json) {
    final id = json['id'] as String? ?? '';
    final price = json['price'];
    final image = json['image'];
    return ProductVariant(
      id: id,
      numericId: numericIdOf(id),
      title: json['title'] as String? ?? defaultTitle,
      price: price is Map
          ? Money.fromJson(price.cast<String, dynamic>())
          : const Money(amount: 0, currencyCode: 'USD'),
      availableForSale: json['availableForSale'] as bool? ?? false,
      imageUrl: image is Map ? image['url'] as String? : null,
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

  /// Parses a product node of the Storefront API's `products` query
  /// (`ShopifyStorefront.productsQuery`).
  factory Product.fromStorefrontJson(Map<String, dynamic> json) {
    final rawVariants = (json['variants'] as Map?)?['nodes'];
    final variants = (rawVariants is List ? rawVariants : const [])
        .whereType<Map>()
        .map(ProductVariant.fromStorefrontJson)
        .where((v) => v.numericId > 0)
        .toList(growable: false);
    final range = json['priceRange'];
    final minPrice = range is Map ? range['minVariantPrice'] : null;
    final image = json['featuredImage'];
    return Product(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '(untitled)',
      handle: json['handle'] as String? ?? '',
      description: stripHtml(json['descriptionHtml'] as String? ?? ''),
      category: (json['productType'] as String? ?? '').trim(),
      price: minPrice is Map
          ? Money.fromJson(minPrice.cast<String, dynamic>())
          : const Money(amount: 0, currencyCode: 'USD'),
      availableForSale:
          json['availableForSale'] == true &&
          variants.any((v) => v.availableForSale),
      imageUrl: image is Map ? image['url'] as String? : null,
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
