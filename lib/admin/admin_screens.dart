import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../api/api_client.dart';
import '../auth/auth_service.dart';
import '../auth/session_expiry.dart';
import '../widgets/status_message.dart';

/// Shared bits of the tablet admin screens (`submissions_screen.dart`,
/// `users_screen.dart`).

final adminDateFormat = DateFormat.yMMMd().add_jm();
final adminDayFormat = DateFormat.yMMMd();

String when(DateTime? date) =>
    date == null ? '' : adminDateFormat.format(date.toLocal());

String day(DateTime? date) =>
    date == null ? '' : adminDayFormat.format(date.toLocal());

/// What an admin screen shows instead of its list when loading failed.
/// The API refuses admin sessions that did not pass a second factor
/// (`permission-denied`), which deserves an explanation rather than a
/// bare error.
class AdminError extends StatelessWidget {
  const AdminError({super.key, required this.error, required this.onRetry});

  final ApiException error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    if (error.code == 'permission-denied') {
      return StatusMessage(
        key: const Key('admin-denied'),
        icon: Icons.lock_outline,
        title: 'Two-factor sign-in needed',
        detail:
            '${error.message} Turn on two-factor authentication under '
            'Settings → Manage account (or add a passkey), then sign out '
            'and back in.',
        actionLabel: 'Try again',
        onAction: onRetry,
      );
    }
    return StatusMessage(
      icon: Icons.cloud_off_outlined,
      title: 'Could not load',
      detail: error.message,
      actionLabel: 'Retry',
      onAction: onRetry,
    );
  }
}

/// Runs an admin call, turning an expired session into a sign-out and
/// any other [ApiException] into a snackbar. Returns null on failure.
Future<T?> guardAdmin<T>(
  BuildContext context,
  AuthService auth,
  Future<T> Function() work,
) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    return await work();
  } on ApiException catch (e) {
    if (e.sessionExpired && context.mounted) {
      await handleSessionExpired(context, auth);
      return null;
    }
    messenger.showSnackBar(SnackBar(content: Text(e.message)));
    return null;
  }
}

/// "Are you sure?" with a red confirm button. True when confirmed.
Future<bool> confirmDanger(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  Key? confirmKey,
}) async {
  final sure = await showDialog<bool>(
    context: context,
    builder: (context) {
      final scheme = Theme.of(context).colorScheme;
      return AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: confirmKey,
            style: FilledButton.styleFrom(
              backgroundColor: scheme.error,
              foregroundColor: scheme.onError,
            ),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(confirmLabel),
          ),
        ],
      );
    },
  );
  return sure ?? false;
}

/// A label/value row in a detail pane.
class DetailRow extends StatelessWidget {
  const DetailRow(this.label, this.value, {super.key});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 96,
            child: Text(
              label,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(child: Text(value, style: theme.textTheme.bodyMedium)),
        ],
      ),
    );
  }
}

/// Previous / Next with a label between, for the paged lists.
class Pager extends StatelessWidget {
  const Pager({
    super.key,
    required this.label,
    required this.onPrevious,
    required this.onNext,
  });

  final String label;
  final VoidCallback? onPrevious;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          OutlinedButton(
            key: const Key('page-previous'),
            onPressed: onPrevious,
            child: const Text('Previous'),
          ),
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          OutlinedButton(
            key: const Key('page-next'),
            onPressed: onNext,
            child: const Text('Next'),
          ),
        ],
      ),
    );
  }
}

/// The right half of a landscape tablet before a row is chosen.
class NothingSelected extends StatelessWidget {
  const NothingSelected(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Text(
        text,
        style: theme.textTheme.bodyLarge?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}
