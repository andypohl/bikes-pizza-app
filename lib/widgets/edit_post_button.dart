import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../data/portable_text_html.dart';
import '../models/post.dart';
import '../posts/post_editor.dart';
import '../screens/edit_post_screen.dart';
import '../submissions/photo_picker.dart';

/// An "Edit" button for a post, shown only to the member the post is
/// credited to and to administrators. Opens [EditPostScreen]; when an
/// edit is applied at once (an administrator's), [onSaved] gets the post
/// as it now reads so the screen can show it without fetching again.
class EditPostButton extends StatefulWidget {
  const EditPostButton({
    super.key,
    required this.post,
    required this.auth,
    required this.editor,
    required this.photos,
    required this.onSaved,
    this.asTextButton = false,
  });

  final Post post;
  final AuthService auth;
  final PostEditor editor;
  final PhotoPicker photos;
  final ValueChanged<Post> onSaved;

  /// A labelled text button (in a page body) instead of an icon button
  /// (in an app bar).
  final bool asTextButton;

  @override
  State<EditPostButton> createState() => _EditPostButtonState();
}

class _EditPostButtonState extends State<EditPostButton> {
  String? _adminFor;
  Future<bool>? _admin;

  /// Whether [uid]'s account is an administrator, asked once per account.
  Future<bool> _isAdmin(String uid) {
    if (_adminFor != uid || _admin == null) {
      _adminFor = uid;
      _admin = widget.auth.isAdmin();
    }
    return _admin!;
  }

  Future<void> _open() async {
    final saved = await Navigator.of(context).push<EditablePost>(
      MaterialPageRoute(
        builder: (_) => EditPostScreen(
          postId: widget.post.documentId,
          editor: widget.editor,
          photos: widget.photos,
          auth: widget.auth,
        ),
      ),
    );
    if (saved != null) widget.onSaved(postAfterEdit(widget.post, saved));
  }

  Widget _button() => widget.asTextButton
      ? TextButton.icon(
          key: const Key('edit-post'),
          onPressed: _open,
          icon: const Icon(Icons.edit_outlined),
          label: const Text('Edit'),
        )
      : IconButton(
          key: const Key('edit-post'),
          tooltip: 'Edit',
          icon: const Icon(Icons.edit_outlined),
          onPressed: _open,
        );

  @override
  Widget build(BuildContext context) {
    if (widget.post.documentId.isEmpty) return const SizedBox.shrink();
    return StreamBuilder<AppUser?>(
      stream: widget.auth.userChanges,
      initialData: widget.auth.currentUser,
      builder: (context, snapshot) {
        final user = snapshot.data;
        if (user == null || !user.emailVerified) return const SizedBox.shrink();
        if (widget.post.isBy(user.uid)) return _button();
        return FutureBuilder<bool>(
          future: _isAdmin(user.uid),
          builder: (context, admin) =>
              admin.data == true ? _button() : const SizedBox.shrink(),
        );
      },
    );
  }
}

/// [post] as it reads after [saved] was applied: the title, story, photo
/// and details from the server, everything else as before. A story that
/// still has formatting was not changed, so its HTML is kept.
Post postAfterEdit(Post post, EditablePost saved) {
  final image = saved.imageUrl;
  return post.copyWith(
    title: saved.title,
    excerpt: Post.summarize(saved.story),
    html: saved.storyHasFormatting ? null : plainTextToHtml(saved.story),
    featureImage: image == null || image.isEmpty
        ? null
        : '$image?${Post.imageParams}',
    imageAspectRatio: saved.imageAspectRatio,
    bike: saved.bike,
    pizza: saved.pizza,
    clearBike: saved.bike?.isEmpty ?? false,
    clearPizza: saved.pizza?.isEmpty ?? false,
  );
}
