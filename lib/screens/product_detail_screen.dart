import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../auth/auth_service.dart';
import '../store/product.dart';
import '../store/store_repository.dart';
import 'store_screen.dart' show ProductImage, formatMoney;

/// Product page with a variant picker and a Buy button that hands off to
/// Shopify's hosted checkout.
class ProductDetailScreen extends StatefulWidget {
  const ProductDetailScreen({
    super.key,
    required this.product,
    required this.repository,
    required this.auth,
  });

  final Product product;
  final StoreRepository repository;
  final AuthService auth;

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  ProductVariant? _variant;
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

  Future<void> _buy() async {
    final variant = _variant;
    if (variant == null) return;
    setState(() => _busy = true);
    try {
      final url = await widget.repository.createCheckout(
        variantId: variant.id,
        email: widget.auth.currentUser?.email,
      );
      // Shopify's checkout is a web page; an in-app browser view keeps the
      // user close to the app and returns here when they're done.
      await launchUrl(url, mode: LaunchMode.inAppBrowserView);
    } on Object catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e is StoreException ? e.message : 'Could not start checkout.',
          ),
        ),
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
    final canBuy =
        !_busy && variant != null && variant.availableForSale;

    return Scaffold(
      appBar: AppBar(),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AspectRatio(
              aspectRatio: 1,
              child: ProductImage(url: product.imageUrl),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(product.title, style: theme.textTheme.headlineSmall),
                  const SizedBox(height: 6),
                  Text(
                    variant == null
                        ? formatMoney(product.price)
                        : formatMoney(variant.price),
                    style: theme.textTheme.titleLarge?.copyWith(
                      color: theme.colorScheme.primary,
                    ),
                  ),
                  if (!product.hasSingleVariant) ...[
                    const SizedBox(height: 16),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final v in product.variants)
                          ChoiceChip(
                            label: Text(v.title),
                            selected: v.id == variant?.id,
                            onSelected: v.availableForSale
                                ? (_) => setState(() => _variant = v)
                                : null,
                          ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 20),
                  FilledButton.icon(
                    key: const Key('buy-now'),
                    onPressed: canBuy ? _buy : null,
                    icon: _busy
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.shopping_bag_outlined),
                    label: Text(
                      variant != null && !variant.availableForSale
                          ? 'Sold out'
                          : 'Buy now',
                    ),
                  ),
                  if (product.description.isNotEmpty) ...[
                    const SizedBox(height: 24),
                    Text(product.description, style: theme.textTheme.bodyLarge),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
