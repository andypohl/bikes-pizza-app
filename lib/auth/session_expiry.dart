import 'package:flutter/material.dart';

import 'auth_service.dart';

const sessionExpiredMessage = 'Your session has expired. Please sign in again.';

/// Handles a server reply that the user's session is no longer valid (for
/// example after a password reset revoked it): signs out so the UI stops
/// looking signed in, returns to the app shell, and says why.
Future<void> handleSessionExpired(
  BuildContext context,
  AuthService auth,
) async {
  final navigator = Navigator.of(context);
  final messenger = ScaffoldMessenger.of(context);
  await auth.signOut();
  if (!navigator.mounted) return;
  navigator.popUntil((route) => route.isFirst);
  messenger.showSnackBar(const SnackBar(content: Text(sessionExpiredMessage)));
}
