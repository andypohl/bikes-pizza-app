import 'package:flutter/material.dart';

import '../models/post_feed.dart';

/// Where a member submits their own bike or pizza. Placeholder until the
/// submission flow lands.
class SubmitScreen extends StatelessWidget {
  const SubmitScreen({super.key, required this.feed});

  final PostFeed feed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(feed.submitLabel ?? 'Submit')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.add_a_photo_outlined,
                size: 48,
                color: theme.colorScheme.onSurfaceVariant,
              ),
              const SizedBox(height: 16),
              Text('Coming soon', style: theme.textTheme.titleLarge),
              const SizedBox(height: 8),
              Text(
                'Submissions are not open yet. Check back after the next '
                'update.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
