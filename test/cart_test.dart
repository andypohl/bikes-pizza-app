import 'package:flutter_test/flutter_test.dart';
import 'package:pizza_predator/store/cart.dart';
import 'package:pizza_predator/store/product.dart';
import 'package:shared_preferences/shared_preferences.dart';

CartItem _item(int id, {int quantity = 1, double price = 10}) => CartItem(
  variantId: 'gid://shopify/ProductVariant/$id',
  numericId: id,
  handle: 'p$id',
  title: 'P$id',
  variantTitle: '',
  price: Money(amount: price, currencyCode: 'USD'),
  quantity: quantity,
);

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('adds, merges, counts and totals lines', () async {
    final cart = Cart();
    var changes = 0;
    cart.addListener(() => changes++);

    await cart.add(_item(1), quantity: 2);
    await cart.add(_item(2, price: 5));
    await cart.add(_item(1)); // merges into the existing line

    expect(cart.count, 4);
    expect(cart.items.map((i) => '${i.numericId}x${i.quantity}'), [
      '1x3',
      '2x1',
    ]);
    expect(cart.subtotal.amount, 35);
    expect(changes, 3);

    await cart.setQuantity('gid://shopify/ProductVariant/1', 1);
    expect(cart.count, 2);
    await cart.setQuantity('gid://shopify/ProductVariant/1', 0);
    expect(cart.items.length, 1);
    await cart.remove('gid://shopify/ProductVariant/2');
    expect(cart.isEmpty, isTrue);
  });

  test('survives a restart through shared preferences', () async {
    final cart = Cart();
    await cart.add(_item(7, price: 3), quantity: 2);

    final reloaded = await Cart.load();
    expect(reloaded.count, 2);
    expect(reloaded.items.single.title, 'P7');
    expect(reloaded.subtotal.amount, 6);
  });

  test('merges an item into the cart lines for a combined checkout', () {
    final lines = Cart.merged([
      _item(1, quantity: 2),
      _item(2),
    ], _item(1, quantity: 3));
    expect(lines.map((i) => '${i.numericId}x${i.quantity}'), ['1x5', '2x1']);
    final added = Cart.merged([_item(1)], _item(9));
    expect(added.map((i) => i.numericId), [1, 9]);
  });
}
