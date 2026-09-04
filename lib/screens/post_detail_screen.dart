import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_widget_from_html_core/flutter_widget_from_html_core.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/post.dart';

/// Full post: hero image, title, date and the rendered HTML body.
class PostDetailScreen extends StatelessWidget {
  const PostDetailScreen({super.key, required this.post});

  final Post post;

  static final _dateFormat = DateFormat.yMMMMd();

  Future<bool> _open(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return false;
    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final image = post.featureImage;

    return Scaffold(
      appBar: AppBar(
        actions: [
          if (post.url.isNotEmpty)
            IconButton(
              tooltip: 'Open on bikes.pizza',
              icon: const Icon(Icons.open_in_browser),
              onPressed: () => _open(post.url),
            ),
        ],
      ),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (image != null && image.isNotEmpty)
              AspectRatio(
                aspectRatio: 16 / 9,
                child: CachedNetworkImage(
                  imageUrl: image,
                  fit: BoxFit.cover,
                  errorWidget: (_, _, _) => const SizedBox.shrink(),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(post.title, style: theme.textTheme.headlineSmall),
                  const SizedBox(height: 6),
                  Text(
                    _dateFormat.format(post.publishedAt.toLocal()),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 20),
                  if (post.html.isNotEmpty)
                    HtmlWidget(
                      post.html,
                      textStyle: theme.textTheme.bodyLarge,
                      onTapUrl: _open,
                    )
                  else if (post.excerpt.isNotEmpty)
                    Text(post.excerpt, style: theme.textTheme.bodyLarge),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
