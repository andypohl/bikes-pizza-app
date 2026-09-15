import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_widget_from_html_core/flutter_widget_from_html_core.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/post_repository.dart';
import '../models/post.dart';
import '../models/post_feed.dart';
import '../screens/post_list_screen.dart';

/// A post laid out in full: hero image, title, date, its structured details
/// when it has any, the rendered HTML body and who submitted it. Not
/// scrollable itself; the post screen and the news reader each put it in
/// their own scroll view. With a [repository], the submitter's username
/// opens the list of everything they have posted.
class PostArticle extends StatelessWidget {
  const PostArticle({super.key, required this.post, this.repository});

  final Post post;
  final PostRepository? repository;

  /// The photo is never taller than this, on any screen; the website caps
  /// its article images at the same height.
  static const double imageMaxHeight = 360;

  static final _dateFormat = DateFormat.yMMMMd();

  /// Opens [url] outside the app; false when it is not a URL at all.
  static Future<bool> open(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return false;
    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  void _openMember(BuildContext context, PostCredit credit) {
    final repository = this.repository;
    if (repository == null) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PostListScreen(
          feed: PostFeed.all,
          repository: repository,
          credit: credit,
        ),
      ),
    );
  }

  /// "Submitted by …", with the username tappable when it can be listed.
  Widget? _credit(BuildContext context, ThemeData theme) {
    final label = post.creditLabel;
    if (label == null) return null;
    final credit = post.credit;
    final linkable =
        credit != null && credit.username.isNotEmpty && repository != null;
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
              onTap: () => _openMember(context, credit),
              borderRadius: BorderRadius.circular(4),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2),
                child: Text(
                  label,
                  style: style?.copyWith(
                    color: theme.colorScheme.primary,
                    decoration: TextDecoration.underline,
                  ),
                ),
              ),
            )
          else
            Text(label, style: style),
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
    final image = post.image;
    final credit = _credit(context, theme);
    final details = _details(theme);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // The photo at its own proportions, as wide as the text at most
        // and never taller than [imageMaxHeight], centered.
        if (image != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: imageMaxHeight),
                child: AspectRatio(
                  aspectRatio: image.aspectRatio,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: CachedNetworkImage(
                      imageUrl: image.url(1200),
                      fit: BoxFit.cover,
                      errorWidget: (_, _, _) => const SizedBox.shrink(),
                    ),
                  ),
                ),
              ),
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
                  onTapUrl: open,
                )
              else if (post.summary.isNotEmpty)
                Text(post.summary, style: theme.textTheme.bodyLarge),
              ?credit,
            ],
          ),
        ),
      ],
    );
  }
}
