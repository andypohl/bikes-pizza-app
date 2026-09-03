import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../models/post.dart';

/// One row in a post list: thumbnail on the left, title and date on the right.
class PostTile extends StatelessWidget {
  const PostTile({super.key, required this.post, this.onTap});

  final Post post;
  final VoidCallback? onTap;

  static const double thumbWidth = 112;
  static const double thumbHeight = 80;

  static final _dateFormat = DateFormat.yMMMd();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            PostThumbnail(
              imageUrl: post.featureImage,
              width: thumbWidth,
              height: thumbHeight,
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    post.title,
                    style: theme.textTheme.titleMedium,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _dateFormat.format(post.publishedAt.toLocal()),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Rounded thumbnail that degrades to a pizza-slice placeholder when the post
/// has no image or the image fails to load.
class PostThumbnail extends StatelessWidget {
  const PostThumbnail({
    super.key,
    required this.imageUrl,
    required this.width,
    required this.height,
  });

  final String? imageUrl;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    final url = imageUrl;
    final placeholder = _Placeholder(width: width, height: height);

    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: SizedBox(
        width: width,
        height: height,
        child: url == null || url.isEmpty
            ? placeholder
            : CachedNetworkImage(
                imageUrl: url,
                fit: BoxFit.cover,
                // Ask the decoder for something close to the display size
                // so a full-resolution photo does not eat memory.
                memCacheWidth: (width * 3).round(),
                placeholder: (_, _) => placeholder,
                errorWidget: (_, _, _) => placeholder,
              ),
      ),
    );
  }
}

class _Placeholder extends StatelessWidget {
  const _Placeholder({required this.width, required this.height});

  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: width,
      height: height,
      color: scheme.surfaceContainerHighest,
      alignment: Alignment.center,
      child: Icon(
        Icons.local_pizza_outlined,
        color: scheme.onSurfaceVariant,
        size: height * 0.4,
      ),
    );
  }
}
