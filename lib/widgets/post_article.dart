import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_widget_from_html_core/flutter_widget_from_html_core.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../auth/auth_service.dart';
import '../data/post_repository.dart';
import '../models/post.dart';
import '../models/post_feed.dart';
import '../posts/comment_service.dart';
import '../posts/profile_service.dart';
import '../posts/reaction_service.dart';
import '../screens/post_list_screen.dart';
import '../screens/profile_screen.dart';
import 'comments_panel.dart';
import 'reactions_panel.dart';
import 'unread_dot.dart';

/// A post laid out in full: hero image, its additional pictures when it
/// has any (each opening a full-screen viewer), title, date, its
/// structured details when it has any, its reaction palettes when its
/// feed has any, the rendered HTML body and who submitted it. Not
/// scrollable itself; the post screen and the news reader each put it in
/// their own scroll view. With a [repository], the submitter's username
/// opens the list of everything they have posted; with [reactions] (and
/// [auth] to know who is signed in) members can react, and with
/// [comments] read and write the comments under a bike or pizza post.
class PostArticle extends StatelessWidget {
  const PostArticle({
    super.key,
    required this.post,
    this.repository,
    this.reactions,
    this.comments,
    this.profiles,
    this.auth,
    this.unread = false,
  });

  final Post post;
  final PostRepository? repository;
  final ReactionService? reactions;
  final CommentService? comments;

  /// Lets usernames open a profile; without it the credit opens the
  /// member's post list.
  final ProfileService? profiles;
  final AuthService? auth;

  /// Puts the blue unread dot before the title.
  final bool unread;

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
    final profiles = this.profiles;
    if (profiles != null && credit.username.isNotEmpty) {
      openProfile(context, credit.username);
      return;
    }
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

  /// Opens [username]'s profile, when profiles are available.
  void openProfile(BuildContext context, String username) {
    final profiles = this.profiles;
    final repository = this.repository;
    if (profiles == null || repository == null) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ProfileScreen(
          username: username,
          profiles: profiles,
          repository: repository,
          auth: auth,
          reactions: reactions,
          comments: comments,
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
        if (post.images.isNotEmpty) _MorePictures(post: post),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (unread)
                    const Padding(
                      key: Key('unread-dot'),
                      padding: EdgeInsets.only(top: 11, right: 8),
                      child: UnreadDot(),
                    ),
                  Expanded(
                    child: Text(
                      post.title,
                      style: theme.textTheme.headlineSmall,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                _dateFormat.format(post.publishedAt.toLocal()),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              ?details,
              if (ReactionsPanel.palettesFor(post).isNotEmpty)
                ReactionsPanel(post: post, reactions: reactions, auth: auth),
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
              if (post.takesComments)
                CommentsPanel(
                  post: post,
                  comments: comments,
                  auth: auth,
                  onOpenProfile: profiles == null || repository == null
                      ? null
                      : (username) => openProfile(context, username),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// The additional pictures as a row of thumbnails under the main photo;
/// tapping one opens the viewer at that picture.
class _MorePictures extends StatelessWidget {
  const _MorePictures({required this.post});

  final Post post;

  static const double thumbHeight = 84;

  void _open(BuildContext context, int index) {
    showDialog<void>(
      context: context,
      builder: (_) => _PictureViewer(post: post, index: index),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      key: const Key('more-pictures'),
      height: thumbHeight + 12,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
        scrollDirection: Axis.horizontal,
        itemCount: post.images.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final image = post.images[i];
          return InkWell(
            key: Key('more-picture-$i'),
            borderRadius: BorderRadius.circular(8),
            onTap: () => _open(context, i),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(
                width: thumbHeight * 4 / 3,
                height: thumbHeight,
                child: CachedNetworkImage(
                  imageUrl: image.url(400),
                  fit: BoxFit.cover,
                  alignment: Alignment(
                    image.focusX * 2 - 1,
                    image.focusY * 2 - 1,
                  ),
                  memCacheWidth: (thumbHeight * 4).round(),
                  errorWidget: (_, _, _) => const SizedBox.shrink(),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// The additional pictures full screen, one per page, pinch-to-zoom.
class _PictureViewer extends StatefulWidget {
  const _PictureViewer({required this.post, required this.index});

  final Post post;
  final int index;

  @override
  State<_PictureViewer> createState() => _PictureViewerState();
}

class _PictureViewerState extends State<_PictureViewer> {
  late final _controller = PageController(initialPage: widget.index);
  late int _page = widget.index;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final images = widget.post.images;
    return Dialog.fullscreen(
      key: const Key('picture-viewer'),
      backgroundColor: Colors.black,
      child: Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
          backgroundColor: Colors.black,
          foregroundColor: Colors.white,
          leading: const CloseButton(),
          title: Text('${_page + 1} of ${images.length}'),
        ),
        body: PageView.builder(
          controller: _controller,
          itemCount: images.length,
          onPageChanged: (page) => setState(() => _page = page),
          itemBuilder: (context, i) => InteractiveViewer(
            maxScale: 4,
            child: Center(
              child: CachedNetworkImage(
                imageUrl: images[i].largestUrl,
                fit: BoxFit.contain,
                errorWidget: (_, _, _) => const SizedBox.shrink(),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
