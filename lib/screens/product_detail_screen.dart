import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../store/cart.dart';
import '../store/product.dart';
import '../store/store_repository.dart';
import 'checkout.dart';
import 'store_screen.dart' show ProductImage, formatMoney;

/// Product page: photo, price, description, a variant picker when there is
/// a choice, a quantity, and two buttons. Add to cart puts that many in
/// the cart (the Store tab's badge goes up by that many); Buy it now goes
/// straight to checkout with that many of this item, first asking whether
/// to bring the cart along when it is not empty.
class ProductDetailScreen extends StatefulWidget {
  const ProductDetailScreen({
    super.key,
    required this.product,
    required this.repository,
    required this.auth,
    required this.cart,
  });

  final Product product;
  final StoreRepository repository;
  final AuthService auth;
  final Cart cart;

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

enum _BuyChoice { item, all }

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  ProductVariant? _variant;
  int _quantity = 1;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final variants = widget.product.variants;
    _variant = variants.isEmpty
        ? null
        : variants.firstWhere(
            (v) => v.availableForSale,
            orElse: () => variants.first,
          );
  }

  CartItem? get _line {
    final variant = _variant;
    if (variant == null) return null;
    return CartItem.of(widget.product, variant, quantity: _quantity);
  }

  Future<void> _addToCart() async {
    final line = _line;
    if (line == null) return;
    final messenger = ScaffoldMessenger.of(context);
    await widget.cart.add(line, quantity: line.quantity);
    messenger
      ..clearSnackBars()
      ..showSnackBar(
        SnackBar(
          content: Text(
            line.quantity == 1
                ? 'Added to your cart.'
                : 'Added ${line.quantity} to your cart.',
          ),
        ),
      );
  }

  Future<void> _buyNow() async {
    final line = _line;
    if (line == null) return;
    var items = [line];
    if (!widget.cart.isEmpty) {
      final choice = await showDialog<_BuyChoice>(
        context: context,
        builder: (context) {
          final n = widget.cart.count;
          return AlertDialog(
            title: const Text('Check out what?'),
            content: Text(
              'You have ${n == 1 ? '1 item' : '$n items'} in your cart. '
              'Buy just this item, or everything together?',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Cancel'),
              ),
              TextButton(
                key: const Key('buy-with-cart'),
                onPressed: () => Navigator.of(context).pop(_BuyChoice.all),
                child: const Text('This item and my cart'),
              ),
              FilledButton(
                key: const Key('buy-just-this'),
                onPressed: () => Navigator.of(context).pop(_BuyChoice.item),
                child: const Text('Just this item'),
              ),
            ],
          );
        },
      );
      if (choice == null) return;
      if (choice == _BuyChoice.all) {
        items = Cart.merged(widget.cart.items, line);
      }
    }
    if (!mounted) return;
    setState(() => _busy = true);
    try {
      await openCheckout(
        context,
        repository: widget.repository,
        auth: widget.auth,
        items: items,
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final product = widget.product;
    final variant = _variant;
    final available = variant != null && variant.availableForSale;
    final canAct = !_busy && available;

    return Scaffold(
      appBar: AppBar(),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AspectRatio(
              aspectRatio: 4 / 3,
              child: ProductImage(
                url: variant?.imageUrl ?? product.imageUrl,
                width: 1200,
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(product.title, style: theme.textTheme.headlineSmall),
                  const SizedBox(height: 6),
                  Text(
                    formatMoney(variant?.price ?? product.price),
                    key: const Key('price'),
                    style: theme.textTheme.titleLarge?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  if (product.description.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    Text(product.description, style: theme.textTheme.bodyLarge),
                  ],
                  if (product.hasChoices) ...[
                    const SizedBox(height: 20),
                    Text('Choose', style: theme.textTheme.labelLarge),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final v in product.variants)
                          ChoiceChip(
                            label: Text(
                              v.availableForSale
                                  ? v.title
                                  : '${v.title} (sold out)',
                            ),
                            selected: v.id == variant?.id,
                            onSelected: v.availableForSale
                                ? (_) => setState(() => _variant = v)
                                : null,
                          ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      Text('Quantity', style: theme.textTheme.labelLarge),
                      const SizedBox(width: 12),
                      QuantityStepper(
                        value: _quantity,
                        onChanged: (n) => setState(() => _quantity = n),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: FilledButton.tonal(
                          key: const Key('add-to-cart'),
                          onPressed: canAct ? _addToCart : null,
                          child: Text(available ? 'Add to cart' : 'Sold out'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: FilledButton(
                          key: const Key('buy-now'),
                          onPressed: canAct ? _buyNow : null,
                          child: _busy
                              ? const SizedBox(
                                  height: 18,
                                  width: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Text('Buy it now'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Checkout opens on our Shopify store.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
