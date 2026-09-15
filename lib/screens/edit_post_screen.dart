import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../auth/auth_service.dart';
import '../auth/session_expiry.dart';
import '../contract.dart';
import '../models/post.dart';
import '../posts/post_editor.dart';
import '../submissions/photo_picker.dart';
import '../submissions/submission_service.dart';

/// Edits a published post: its photo, title, story and structured details.
/// Only what changed is sent. A member's changes go to bikes.pizza for
/// review (the screen then thanks them); an administrator's are applied
/// at once and the screen pops with the post as it now reads.
class EditPostScreen extends StatefulWidget {
  const EditPostScreen({
    super.key,
    required this.postId,
    required this.editor,
    required this.photos,
    required this.auth,
  });

  /// The Sanity document id (`Post.documentId`).
  final String postId;
  final PostEditor editor;
  final PhotoPicker photos;
  final AuthService auth;

  @override
  State<EditPostScreen> createState() => _EditPostScreenState();
}

class _EditPostScreenState extends State<EditPostScreen> {
  final _formKey = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _story = TextEditingController();
  final _brand = TextEditingController();
  String _year = '';
  String _color = '';
  String _type = '';
  String _style = '';
  SubmissionPhoto? _photo;

  EditablePost? _post;
  String? _error;
  bool _admin = false;
  bool _saving = false;
  EditOutcome? _sent;

  @override
  void initState() {
    super.initState();
    for (final c in [_title, _story, _brand]) {
      c.addListener(_changed);
    }
    _load();
  }

  @override
  void dispose() {
    _title.dispose();
    _story.dispose();
    _brand.dispose();
    super.dispose();
  }

  void _changed() => setState(() {});

  Future<void> _load() async {
    setState(() {
      _post = null;
      _error = null;
    });
    try {
      final results = await Future.wait([
        widget.editor.load(widget.postId),
        widget.auth.isAdmin(),
      ]);
      if (!mounted) return;
      final post = results[0] as EditablePost;
      setState(() {
        _post = post;
        _admin = results[1] as bool;
        _title.text = post.title;
        _story.text = post.story;
        _brand.text = post.bike?.brand ?? '';
        _year = post.bike?.year ?? '';
        _color = post.bike?.color ?? '';
        _type = post.bike?.type ?? '';
        _style = post.pizza?.style ?? '';
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.sessionExpired) return handleSessionExpired(context, widget.auth);
      setState(() => _error = e.message);
    }
  }

  /// The changes made so far, or an empty edit when nothing differs.
  PostEdit _edit() {
    final post = _post;
    if (post == null) return const PostEdit();
    final title = _title.text.trim();
    final story = _story.text.trim();
    BikeDetails? bike;
    if (post.bike != null) {
      final now = BikeDetails(
        brand: _brand.text.trim(),
        year: _year,
        color: _color,
        type: _type,
      );
      final was = post.bike!;
      if (now.brand != (was.brand ?? '') ||
          now.year != (was.year ?? '') ||
          now.color != (was.color ?? '') ||
          now.type != (was.type ?? '')) {
        bike = now;
      }
    }
    PizzaDetails? pizza;
    if (post.pizza != null && _style != (post.pizza!.style ?? '')) {
      pizza = PizzaDetails(style: _style);
    }
    return PostEdit(
      title: title != post.title ? title : null,
      story: story != post.story ? story : null,
      photo: _photo,
      bike: bike,
      pizza: pizza,
    );
  }

  /// Members wait for a pending edit to be reviewed; administrators edit
  /// the post directly regardless.
  bool get _locked => !_admin && (_post?.hasPendingEdit ?? false);

  Future<void> _pickPhoto() async {
    final source = await showModalBottomSheet<PhotoSource>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              key: const Key('photo-camera'),
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Take a photo'),
              onTap: () => Navigator.pop(context, PhotoSource.camera),
            ),
            ListTile(
              key: const Key('photo-library'),
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose from library'),
              onTap: () => Navigator.pop(context, PhotoSource.library),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;
    final photo = await widget.photos.pick(source);
    if (photo == null || !mounted) return;
    setState(() => _photo = photo);
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final edit = _edit();
    if (edit.isEmpty) return;
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    setState(() => _saving = true);
    try {
      final outcome = await widget.editor.save(widget.postId, edit);
      if (!mounted) return;
      if (outcome.isPending) {
        setState(() => _sent = outcome);
        return;
      }
      messenger.showSnackBar(const SnackBar(content: Text('Saved.')));
      navigator.pop(outcome.post);
    } on ApiException catch (e) {
      if (e.sessionExpired && mounted) {
        return handleSessionExpired(context, widget.auth);
      }
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final post = _post;
    final error = _error;
    final Widget body;
    if (_sent != null) {
      body = const _SentForReview();
    } else if (error != null) {
      body = Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(error, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton(onPressed: _load, child: const Text('Try again')),
            ],
          ),
        ),
      );
    } else if (post == null) {
      body = const Center(child: CircularProgressIndicator());
    } else {
      body = _buildForm(post);
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Edit post')),
      body: body,
    );
  }

  Widget _buildForm(EditablePost post) {
    final theme = Theme.of(context);
    final busy = _saving || _locked;
    final photo = _photo;
    final imageUrl = post.imageUrl;
    final dirty = !_edit().isEmpty;

    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_locked)
            _Notice(
              key: const Key('pending-notice'),
              icon: Icons.hourglass_top_outlined,
              text:
                  'An edit of this post is waiting for review at bikes.pizza. '
                  'You can send another once it has been reviewed.',
            )
          else if (_admin && post.hasPendingEdit)
            const _Notice(
              key: Key('pending-notice'),
              icon: Icons.hourglass_top_outlined,
              text:
                  "A member's edit of this post is waiting on the review page.",
            ),
          Text('Main photo', style: theme.textTheme.titleSmall),
          const SizedBox(height: 8),
          if (photo != null || (imageUrl != null && imageUrl.isNotEmpty))
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: SizedBox(
                height: 200,
                width: double.infinity,
                child: photo != null
                    ? Image.memory(
                        photo.bytes,
                        key: const Key('photo-preview'),
                        fit: BoxFit.cover,
                      )
                    : CachedNetworkImage(
                        key: const Key('current-photo'),
                        imageUrl: '$imageUrl?w=1200&auto=format&q=80',
                        fit: BoxFit.cover,
                        errorWidget: (_, _, _) => const SizedBox.shrink(),
                      ),
              ),
            ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            key: const Key('pick-photo'),
            onPressed: busy ? null : _pickPhoto,
            icon: const Icon(Icons.photo_camera_back_outlined),
            label: Text(photo == null ? 'Change photo' : 'Choose another'),
          ),
          const SizedBox(height: 20),
          TextFormField(
            key: const Key('title'),
            controller: _title,
            enabled: !busy,
            textCapitalization: TextCapitalization.sentences,
            maxLength: 255,
            decoration: const InputDecoration(
              labelText: 'Title',
              counterText: '',
            ),
            validator: (v) =>
                (v ?? '').trim().isEmpty ? 'Please give it a title.' : null,
          ),
          const SizedBox(height: 12),
          if (post.storyHasFormatting)
            const _Notice(
              key: Key('formatting-notice'),
              icon: Icons.info_outline,
              text:
                  'This story has formatting (headings, links or lists) that '
                  "can't be edited here. If you change the story, it will be "
                  'saved as plain paragraphs.',
            ),
          TextFormField(
            key: const Key('story'),
            controller: _story,
            enabled: !busy,
            textCapitalization: TextCapitalization.sentences,
            minLines: 5,
            maxLines: 14,
            maxLength: 10000,
            decoration: const InputDecoration(
              labelText: 'Description/Story',
              alignLabelWithHint: true,
              counterText: '',
            ),
          ),
          if (post.bike != null) ...[
            const SizedBox(height: 20),
            Text('Bike details', style: theme.textTheme.titleSmall),
            const SizedBox(height: 8),
            TextFormField(
              key: const Key('bike-brand'),
              controller: _brand,
              enabled: !busy,
              textCapitalization: TextCapitalization.words,
              maxLength: 100,
              decoration: const InputDecoration(
                labelText: 'Brand',
                counterText: '',
              ),
            ),
            const SizedBox(height: 12),
            _Choice(
              key: const Key('bike-year'),
              label: 'Year',
              value: _year,
              options: bikeYears,
              enabled: !busy,
              onChanged: (v) => setState(() => _year = v),
            ),
            const SizedBox(height: 12),
            _Choice(
              key: const Key('bike-color'),
              label: 'Color',
              value: _color,
              options: bikeColors,
              enabled: !busy,
              onChanged: (v) => setState(() => _color = v),
            ),
            const SizedBox(height: 12),
            _Choice(
              key: const Key('bike-type'),
              label: 'Type',
              value: _type,
              options: bikeTypes,
              enabled: !busy,
              onChanged: (v) => setState(() => _type = v),
            ),
          ],
          if (post.pizza != null) ...[
            const SizedBox(height: 20),
            Text('Pizza details', style: theme.textTheme.titleSmall),
            const SizedBox(height: 8),
            _Choice(
              key: const Key('pizza-style'),
              label: 'Style',
              value: _style,
              options: pizzaStyles,
              enabled: !busy,
              onChanged: (v) => setState(() => _style = v),
            ),
          ],
          const SizedBox(height: 24),
          FilledButton.icon(
            key: const Key('save'),
            onPressed: busy || !dirty ? null : _save,
            icon: _saving
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Icon(_admin ? Icons.save_outlined : Icons.send_outlined),
            label: Text(
              _saving
                  ? 'Saving…'
                  : _admin
                  ? 'Save'
                  : 'Send for review',
            ),
          ),
          const SizedBox(height: 8),
          Text(
            _admin
                ? 'Changes go live right away.'
                : 'Changes go to bikes.pizza for review before they appear, '
                      'like a new post.',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

/// A dropdown over one of the option lists, with "(not set)" first.
class _Choice extends StatelessWidget {
  const _Choice({
    super.key,
    required this.label,
    required this.value,
    required this.options,
    required this.enabled,
    required this.onChanged,
  });

  final String label;
  final String value;
  final Map<String, String> options;
  final bool enabled;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    // A stored value the list no longer has is still offered, as stored.
    final items = {
      '': '(not set)',
      ...options,
      if (value.isNotEmpty && !options.containsKey(value)) value: value,
    };
    return DropdownButtonFormField<String>(
      initialValue: value,
      decoration: InputDecoration(labelText: label),
      items: [
        for (final entry in items.entries)
          DropdownMenuItem(value: entry.key, child: Text(entry.value)),
      ],
      onChanged: enabled ? (v) => onChanged(v ?? '') : null,
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({super.key, required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Material(
        color: theme.colorScheme.secondaryContainer,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: theme.colorScheme.onSecondaryContainer),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  text,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSecondaryContainer,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Shown to a member once their changes are on their way to review.
class _SentForReview extends StatelessWidget {
  const _SentForReview();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.check_circle_outline,
              size: 56,
              color: theme.colorScheme.primary,
            ),
            const SizedBox(height: 16),
            Text('Thanks!', style: theme.textTheme.headlineSmall),
            const SizedBox(height: 8),
            Text(
              'Your changes are on their way to bikes.pizza for review. '
              'The post updates once they are approved.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 24),
            FilledButton(
              key: const Key('done'),
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Done'),
            ),
          ],
        ),
      ),
    );
  }
}
