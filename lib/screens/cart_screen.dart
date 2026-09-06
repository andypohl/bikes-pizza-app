import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../store/cart.dart';
import '../store/store_repository.dart';
import 'checkout.dart';
import 'store_screen.dart' show ProductImage, formatMoney;

/// The cart: each line with its quantity (which these controls reflect and
/// change), the subtotal, and Checkout for everything in it.
class CartScreen extends StatefulWidget {
  const CartScreen({
    super.key,
    required this.cart,
    required this.repository,
    required this.auth,
  });

  final Cart cart;
  final StoreRepository repository;
  final AuthService auth;

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  bool _busy = false;

  Future<void> _checkout() async {
    setState(() => _busy = true);
    try {
      await openCheckout(
        context,
        repository: widget.repository,
        auth: widget.auth,
        items: widget.cart.items,
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Your cart')),
      body: ListenableBuilder(
        listenable: widget.cart,
        builder: (context, _) {
          final items = widget.cart.items;
          if (items.isEmpty) {
            return Center(
              child: Text(
                'Your cart is empty.',
                style: theme.textTheme.bodyLarge?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            );
          }
          return Column(
            children: [
              Expanded(
                child: ListView.separated(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: items.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (context, index) =>
                      _CartLine(item: items[index], cart: widget.cart),
                ),
              ),
              SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('Subtotal', style: theme.textTheme.titleMedium),
                          Text(
                            formatMoney(widget.cart.subtotal),
                            key: const Key('cart-subtotal'),
                            style: theme.textTheme.titleMedium,
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      FilledButton(
                        key: const Key('cart-checkout'),
                        onPressed: _busy ? null : _checkout,
                        child: const Text('Checkout'),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Checkout opens on our Shopify store. Shipping and '
                        'tax are added there.',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _CartLine extends StatelessWidget {
  const _CartLine({required this.item, required this.cart});

  final CartItem item;
  final Cart cart;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: SizedBox(
              width: 80,
              height: 60,
              child: ProductImage(url: item.imageUrl, width: 160, height: 120),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.title, style: theme.textTheme.titleSmall),
                if (item.variantTitle.isNotEmpty)
                  Text(
                    item.variantTitle,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    QuantityStepper(
                      key: Key('cart-qty-${item.numericId}'),
                      value: item.quantity,
                      min: 0,
                      onChanged: (n) => cart.setQuantity(item.variantId, n),
                    ),
                    const Spacer(),
                    TextButton(
                      key: Key('cart-remove-${item.numericId}'),
                      onPressed: () => cart.remove(item.variantId),
                      child: const Text('Remove'),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(formatMoney(item.total), style: theme.textTheme.titleSmall),
        ],
      ),
    );
  }
}
