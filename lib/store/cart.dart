import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'product.dart';

/// One line of the cart: a variant and how many of it.
class CartItem {
  const CartItem({
    required this.variantId,
    required this.numericId,
    required this.handle,
    required this.title,
    required this.variantTitle,
    required this.price,
    required this.quantity,
    this.imageUrl,
  });

  final String variantId;
  final int numericId;
  final String handle;
  final String title;

  /// Empty for Shopify's single default variant.
  final String variantTitle;
  final Money price;
  final int quantity;
  final String? imageUrl;

  Money get total => price.times(quantity);

  CartItem withQuantity(int quantity) => CartItem(
    variantId: variantId,
    numericId: numericId,
    handle: handle,
    title: title,
    variantTitle: variantTitle,
    price: price,
    quantity: quantity,
    imageUrl: imageUrl,
  );

  /// A line for [product]'s [variant].
  factory CartItem.of(
    Product product,
    ProductVariant variant, {
    required int quantity,
  }) => CartItem(
    variantId: variant.id,
    numericId: variant.numericId,
    handle: product.handle,
    title: product.title,
    variantTitle: product.hasChoices ? variant.title : '',
    price: variant.price,
    quantity: quantity,
    imageUrl: variant.imageUrl ?? product.imageUrl,
  );

  Map<String, dynamic> toJson() => {
    'variantId': variantId,
    'numericId': numericId,
    'handle': handle,
    'title': title,
    'variantTitle': variantTitle,
    'price': price.amount,
    'currency': price.currencyCode,
    'quantity': quantity,
    'imageUrl': imageUrl,
  };

  static CartItem? fromJson(Map<dynamic, dynamic> json) {
    final variantId = json['variantId'] as String?;
    final quantity = (json['quantity'] as num?)?.toInt() ?? 0;
    if (variantId == null || variantId.isEmpty || quantity <= 0) return null;
    return CartItem(
      variantId: variantId,
      numericId: (json['numericId'] as num?)?.toInt() ?? 0,
      handle: json['handle'] as String? ?? '',
      title: json['title'] as String? ?? '',
      variantTitle: json['variantTitle'] as String? ?? '',
      price: Money(
        amount: (json['price'] as num?)?.toDouble() ?? 0,
        currencyCode: json['currency'] as String? ?? 'USD',
      ),
      quantity: quantity,
      imageUrl: json['imageUrl'] as String?,
    );
  }
}

/// The shopping cart, kept on the device until checkout hands it to
/// Shopify. Listeners (the Store tab's badge, the cart screen) rebuild on
/// every change.
class Cart extends ChangeNotifier {
  Cart([List<CartItem> items = const []]) : _items = List.of(items);

  static const _key = 'cart.items';

  List<CartItem> _items;

  List<CartItem> get items => List.unmodifiable(_items);
  bool get isEmpty => _items.isEmpty;
  int get count => _items.fold(0, (sum, item) => sum + item.quantity);

  Money get subtotal => _items.fold(
    const Money(amount: 0, currencyCode: 'USD'),
    (sum, item) => sum.plus(item.total),
  );

  /// The cart saved on this device, or an empty one.
  static Future<Cart> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_key);
      if (raw == null) return Cart();
      final decoded = jsonDecode(raw);
      if (decoded is! List) return Cart();
      return Cart(
        decoded.whereType<Map>().map(CartItem.fromJson).nonNulls.toList(),
      );
    } on Object {
      return Cart();
    }
  }

  Future<void> _save() async {
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _key,
        jsonEncode([for (final item in _items) item.toJson()]),
      );
    } on Object {
      // Storage unavailable: the cart lives for this run only.
    }
  }

  /// Adds [quantity] of [item]'s variant, merging with an existing line.
  Future<void> add(CartItem item, {int quantity = 1}) {
    final index = _items.indexWhere((i) => i.variantId == item.variantId);
    if (index >= 0) {
      _items[index] = _items[index].withQuantity(
        _items[index].quantity + quantity,
      );
    } else {
      _items.add(item.withQuantity(quantity));
    }
    return _save();
  }

  Future<void> setQuantity(String variantId, int quantity) {
    _items = [
      for (final item in _items)
        if (item.variantId != variantId)
          item
        else if (quantity > 0)
          item.withQuantity(quantity),
    ];
    return _save();
  }

  Future<void> remove(String variantId) => setQuantity(variantId, 0);

  Future<void> clear() {
    _items = [];
    return _save();
  }

  /// [items] plus [extra], merged by variant: what "buy this and my cart"
  /// checks out.
  static List<CartItem> merged(List<CartItem> items, CartItem extra) {
    var found = false;
    final result = [
      for (final item in items)
        if (item.variantId == extra.variantId && (found = true))
          item.withQuantity(item.quantity + extra.quantity)
        else
          item,
    ];
    if (!found) result.add(extra);
    return result;
  }
}
