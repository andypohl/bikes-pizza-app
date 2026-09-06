import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../auth/auth_service.dart';
import '../store/cart.dart';
import '../store/store_repository.dart';

/// Sends the shopper to Shopify's hosted checkout for [items]. The
/// signed-in member's email pre-fills it when the repository can. Shows a
/// snackbar on failure. Returns once the checkout has been opened.
Future<void> openCheckout(
  BuildContext context, {
  required StoreRepository repository,
  required AuthService auth,
  required List<CartItem> items,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    final url = await repository.checkout(
      items,
      email: auth.currentUser?.email,
    );
    // Shopify's checkout is a web page; an in-app browser view keeps the
    // user close to the app and returns here when they're done.
    await launchUrl(url, mode: LaunchMode.inAppBrowserView);
  } on Object catch (e) {
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          e is StoreException ? e.message : 'Could not start checkout.',
        ),
      ),
    );
  }
}

/// A stepper for how many to add or buy. Stateless as far as the cart is
/// concerned: it only says how many the next action applies to.
class QuantityStepper extends StatelessWidget {
  const QuantityStepper({
    super.key,
    required this.value,
    required this.onChanged,
    this.min = 1,
    this.max = 99,
  });

  final int value;
  final ValueChanged<int> onChanged;
  final int min;
  final int max;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton.filledTonal(
          key: const Key('quantity-dec'),
          tooltip: 'One fewer',
          onPressed: value > min ? () => onChanged(value - 1) : null,
          icon: const Icon(Icons.remove),
          visualDensity: VisualDensity.compact,
        ),
        SizedBox(
          width: 40,
          child: Text(
            '$value',
            key: const Key('quantity'),
            textAlign: TextAlign.center,
            style: theme.textTheme.titleMedium,
          ),
        ),
        IconButton.filledTonal(
          key: const Key('quantity-inc'),
          tooltip: 'One more',
          onPressed: value < max ? () => onChanged(value + 1) : null,
          icon: const Icon(Icons.add),
          visualDensity: VisualDensity.compact,
        ),
      ],
    );
  }
}
