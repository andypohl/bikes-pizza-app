import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_widget_from_html_core/flutter_widget_from_html_core.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/post_repository.dart';
import '../models/post.dart';
import '../models/post_feed.dart';
import 'post_list_screen.dart';

/// Full post: hero image, title, date, its structured details when it has any,
/// the rendered HTML body and who submitted it. With a [repository], the submitter's username opens the
/// list of everything they have posted.
class PostDetailScreen extends StatelessWidget {
  const PostDetailScreen({super.key, required this.post, this.repository});

  final Post post;
  final PostRepository? repository;

  static final _dateFormat = DateFormat.yMMMMd();

  Future<bool> _open(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return false;
    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  void _openAuthor(BuildContext context, PostAuthor author) {
    final repository = this.repository;
    if (repository == null) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PostListScreen(
          feed: PostFeed.all,
          repository: repository,
          author: author,
        ),
      ),
    );
  }

  /// "Submitted by …", with the username tappable when it can be listed.
  Widget? _credit(BuildContext context, ThemeData theme) {
    final credit = post.credit;
    if (credit == null) return null;
    final author = post.author;
    final linkable =
        author != null && author.username.isNotEmpty && repository != null;
    final style = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return Padding(
      padding: const EdgeInsets.only(top: 24),
      child: Row(
        children: [
          Text('Submitted by ', style: style),
          if (linkable)
            InkWell(
              key: const Key('credit-link'),
              onTap: () => _openAuthor(context, author),
              borderRadius: BorderRadius.circular(4),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2),
                child: Text(
                  credit,
                  style: style?.copyWith(
                    color: theme.colorScheme.primary,
                    decoration: TextDecoration.underline,
                  ),
                ),
              ),
            )
          else
            Text(credit, style: style),
        ],
      ),
    );
  }

  /// The structured details as label/value rows: a bike's brand, year,
  /// color and type, or a pizza's style.
  Widget? _details(ThemeData theme) {
    final specs = post.details?.specs ?? const [];
    if (specs.isEmpty) return null;
    final labelStyle = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return Padding(
      key: const Key('post-details'),
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final spec in specs)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 72,
                    child: Text(spec.label, style: labelStyle),
                  ),
                  Expanded(
                    child: Text(spec.value, style: theme.textTheme.bodyMedium),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final image = post.featureImage;
    final credit = _credit(context, theme);
    final details = _details(theme);

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
                  ?details,
                  const SizedBox(height: 20),
                  if (post.html.isNotEmpty)
                    HtmlWidget(
                      post.html,
                      textStyle: theme.textTheme.bodyLarge,
                      onTapUrl: _open,
                    )
                  else if (post.excerpt.isNotEmpty)
                    Text(post.excerpt, style: theme.textTheme.bodyLarge),
                  ?credit,
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
