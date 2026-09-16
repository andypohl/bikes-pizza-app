import 'dart:typed_data';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../contract.dart';

/// One picture shown in an [AdditionalPicturesField]: already on the post
/// (loaded by URL) or just chosen on the device (its bytes).
class PictureThumb {
  const PictureThumb.network(String this.url) : bytes = null;

  const PictureThumb.memory(Uint8List this.bytes) : url = null;

  final String? url;
  final Uint8List? bytes;
}

/// The "Additional pictures" section of the submit and edit forms: the
/// pictures chosen so far as thumbnails, each with a remove button, and a
/// button to add one more until [max] is reached.
class AdditionalPicturesField extends StatelessWidget {
  const AdditionalPicturesField({
    super.key,
    required this.pictures,
    required this.onAdd,
    required this.onRemove,
    this.enabled = true,
    this.max = imageMaxExtra,
  });

  final List<PictureThumb> pictures;
  final VoidCallback onAdd;
  final ValueChanged<int> onRemove;
  final bool enabled;
  final int max;

  static const double thumbWidth = 108;
  static const double thumbHeight = 81;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final full = pictures.length >= max;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Additional pictures', style: theme.textTheme.titleSmall),
        const SizedBox(height: 4),
        Text(
          'Optional, up to $max more; they are checked like the main photo.',
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 8),
        if (pictures.isNotEmpty) ...[
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final (i, picture) in pictures.indexed)
                _Thumb(
                  key: Key('picture-$i'),
                  picture: picture,
                  onRemove: enabled ? () => onRemove(i) : null,
                  removeKey: Key('remove-picture-$i'),
                ),
            ],
          ),
          const SizedBox(height: 8),
        ],
        OutlinedButton.icon(
          key: const Key('add-picture'),
          onPressed: enabled && !full ? onAdd : null,
          icon: const Icon(Icons.add_photo_alternate_outlined),
          label: Text(full ? 'No more than $max' : 'Add picture'),
        ),
      ],
    );
  }
}

class _Thumb extends StatelessWidget {
  const _Thumb({
    super.key,
    required this.picture,
    required this.onRemove,
    required this.removeKey,
  });

  final PictureThumb picture;
  final VoidCallback? onRemove;
  final Key removeKey;

  @override
  Widget build(BuildContext context) {
    final bytes = picture.bytes;
    final url = picture.url;
    return Stack(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: SizedBox(
            width: AdditionalPicturesField.thumbWidth,
            height: AdditionalPicturesField.thumbHeight,
            child: bytes != null
                ? Image.memory(bytes, fit: BoxFit.cover)
                : url != null
                ? CachedNetworkImage(
                    imageUrl: url,
                    fit: BoxFit.cover,
                    memCacheWidth: (AdditionalPicturesField.thumbWidth * 3)
                        .round(),
                    errorWidget: (_, _, _) => const SizedBox.shrink(),
                  )
                : const SizedBox.shrink(),
          ),
        ),
        Positioned(
          top: 2,
          right: 2,
          child: Material(
            color: Theme.of(context).colorScheme.surface
                .withValues(alpha: 0.85),
            shape: const CircleBorder(),
            child: IconButton(
              key: removeKey,
              tooltip: 'Remove',
              visualDensity: VisualDensity.compact,
              iconSize: 18,
              icon: const Icon(Icons.close),
              onPressed: onRemove,
            ),
          ),
        ),
      ],
    );
  }
}
