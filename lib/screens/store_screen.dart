import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../auth/auth_service.dart';
import '../store/cart.dart';
import '../store/product.dart';
import '../store/store_repository.dart';
import 'cart_screen.dart';
import 'product_detail_screen.dart';

String formatMoney(Money money) =>
    NumberFormat.simpleCurrency(name: money.currencyCode).format(money.amount);

/// Label of the chip that shows everything.
const allProducts = 'All products';

/// The store, laid out like the website's shop: a chip per category with
/// "All products" first, then a grid of photos with the name and price
/// under each. The app bar's cart badge counts what is in the cart.
class StoreScreen extends StatefulWidget {
  const StoreScreen({
    super.key,
    required this.repository,
    required this.auth,
    required this.cart,
  });

  final StoreRepository repository;
  final AuthService auth;
  final Cart cart;

  @override
  State<StoreScreen> createState() => _StoreScreenState();
}

class _StoreScreenState extends State<StoreScreen> {
  List<Product> _products = const [];
  String _category = allProducts;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = _products.isEmpty;
      _error = null;
    });
    try {
      final products = await widget.repository.fetchProducts();
      if (!mounted) return;
      setState(() {
        _products = products;
        _loading = false;
        if (!_categories.contains(_category)) _category = allProducts;
      });
    } on Object catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e is StoreException ? e.message : 'Could not load the store.';
      });
    }
  }

  /// The categories with a product, in first-seen order.
  List<String> get _categories => [
    allProducts,
    ...{
      for (final product in _products)
        if (product.category.isNotEmpty) product.category,
    },
  ];

  List<Product> get _shown => _category == allProducts
      ? _products
      : _products.where((p) => p.category == _category).toList();

  void _open(Product product) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ProductDetailScreen(
          product: product,
          repository: widget.repository,
          auth: widget.auth,
          cart: widget.cart,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Store'),
        actions: [
          CartAction(
            cart: widget.cart,
            repository: widget.repository,
            auth: widget.auth,
          ),
        ],
      ),
      body: _buildBody(context),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());

    if (_error != null && _products.isEmpty) {
      return _Message(
        icon: Icons.cloud_off_outlined,
        title: 'Could not load the store',
        detail: _error!,
        onRetry: _refresh,
      );
    }
    if (_products.isEmpty) {
      return _Message(
        icon: Icons.storefront_outlined,
        title: 'Nothing in the shop yet',
        detail: 'Check back soon.',
        onRetry: _refresh,
      );
    }

    final categories = _categories;
    final shown = _shown;
    return RefreshIndicator(
      onRefresh: _refresh,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          if (categories.length > 1)
            SliverToBoxAdapter(
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Row(
                  children: [
                    for (final category in categories) ...[
                      ChoiceChip(
                        label: Text(category),
                        selected: category == _category,
                        onSelected: (_) => setState(() => _category = category),
                      ),
                      const SizedBox(width: 8),
                    ],
                  ],
                ),
              ),
            ),
          SliverPadding(
            padding: const EdgeInsets.all(16),
            sliver: SliverGrid(
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                maxCrossAxisExtent: 240,
                mainAxisSpacing: 20,
                crossAxisSpacing: 16,
                childAspectRatio: 0.82,
              ),
              delegate: SliverChildBuilderDelegate(
                (context, index) => ProductTile(
                  product: shown[index],
                  onTap: () => _open(shown[index]),
                ),
                childCount: shown.length,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The app bar's cart button: a badge with how many items are in the cart,
/// opening the cart screen. Shown wherever you can shop, so the cart is
/// one tap away from the store and from any product.
class CartAction extends StatelessWidget {
  const CartAction({
    super.key,
    required this.cart,
    required this.repository,
    required this.auth,
  });

  final Cart cart;
  final StoreRepository repository;
  final AuthService auth;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: cart,
      builder: (context, _) => IconButton(
        key: const Key('cart-button'),
        tooltip: 'Cart',
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) =>
                CartScreen(cart: cart, repository: repository, auth: auth),
          ),
        ),
        icon: Badge.count(
          key: const Key('cart-badge'),
          count: cart.count,
          isLabelVisible: cart.count > 0,
          child: const Icon(Icons.shopping_cart_outlined),
        ),
      ),
    );
  }
}

/// A product in the grid: the photo cropped to the gallery's ratio, with
/// the name and price below it.
class ProductTile extends StatelessWidget {
  const ProductTile({super.key, required this.product, this.onTap});

  final Product product;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: AspectRatio(
              aspectRatio: 4 / 3,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  ProductImage(url: product.imageUrl, width: 800, height: 600),
                  if (!product.availableForSale)
                    Positioned(
                      top: 8,
                      left: 8,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.7),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: const Text(
                          'Sold out',
                          style: TextStyle(color: Colors.white, fontSize: 12),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  product.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleSmall,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                formatMoney(product.price),
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A Shopify product image, resized on their CDN, with a placeholder.
class ProductImage extends StatelessWidget {
  const ProductImage({
    super.key,
    required this.url,
    required this.width,
    this.height,
  });

  final String? url;
  final int width;
  final int? height;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final placeholder = Container(
      color: scheme.surfaceContainerHighest,
      alignment: Alignment.center,
      child: Icon(Icons.local_pizza_outlined, color: scheme.onSurfaceVariant),
    );
    final u = url;
    if (u == null || u.isEmpty) return placeholder;
    return CachedNetworkImage(
      imageUrl: shopifyImage(u, width, height: height),
      fit: BoxFit.cover,
      placeholder: (_, _) => placeholder,
      errorWidget: (_, _, _) => placeholder,
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({
    required this.icon,
    required this.title,
    required this.detail,
    required this.onRetry,
  });

  final IconData icon;
  final String title;
  final String detail;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(height: 16),
            Text(title, style: theme.textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(detail, textAlign: TextAlign.center),
            const SizedBox(height: 20),
            FilledButton.tonal(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}
