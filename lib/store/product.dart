/// A price in a single currency, as returned by Shopify.
class Money {
  const Money({required this.amount, required this.currencyCode});

  final double amount;
  final String currencyCode;

  factory Money.fromJson(Map<String, dynamic> json) => Money(
        amount: double.tryParse('${json['amount']}') ?? 0,
        currencyCode: json['currencyCode'] as String? ?? 'USD',
      );
}

class ProductVariant {
  const ProductVariant({
    required this.id,
    required this.title,
    required this.price,
    required this.availableForSale,
  });

  /// Shopify GID, e.g. `gid://shopify/ProductVariant/123`. This is what a
  /// cart line refers to.
  final String id;
  final String title;
  final Money price;
  final bool availableForSale;

  factory ProductVariant.fromJson(Map<String, dynamic> json) => ProductVariant(
        id: json['id'] as String? ?? '',
        title: json['title'] as String? ?? '',
        price: Money.fromJson(
          (json['price'] as Map?)?.cast<String, dynamic>() ?? const {},
        ),
        availableForSale: json['availableForSale'] as bool? ?? false,
      );
}

class Product {
  const Product({
    required this.id,
    required this.title,
    required this.handle,
    required this.description,
    required this.price,
    required this.availableForSale,
    this.imageUrl,
    this.variants = const [],
  });

  final String id;
  final String title;
  final String handle;

  /// Plain-text description.
  final String description;

  /// Lowest variant price, for the grid.
  final Money price;
  final bool availableForSale;
  final String? imageUrl;
  final List<ProductVariant> variants;

  /// True when the product has a single default variant, so no picker is
  /// needed.
  bool get hasSingleVariant =>
      variants.length <= 1 ||
      (variants.length == 1 && variants.first.title == 'Default Title');

  factory Product.fromJson(Map<String, dynamic> json) {
    final image = (json['featuredImage'] as Map?)?.cast<String, dynamic>();
    final range = (json['priceRange'] as Map?)?.cast<String, dynamic>();
    final minPrice =
        (range?['minVariantPrice'] as Map?)?.cast<String, dynamic>() ??
            const {};
    final variantEdges = ((json['variants'] as Map?)?['edges'] as List?) ?? [];

    return Product(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '(untitled)',
      handle: json['handle'] as String? ?? '',
      description: (json['description'] as String? ?? '').trim(),
      price: Money.fromJson(minPrice),
      availableForSale: json['availableForSale'] as bool? ?? false,
      imageUrl: image?['url'] as String?,
      variants: variantEdges
          .map((e) => (e as Map)['node'])
          .whereType<Map>()
          .map((n) => ProductVariant.fromJson(n.cast<String, dynamic>()))
          .toList(growable: false),
    );
  }
}
