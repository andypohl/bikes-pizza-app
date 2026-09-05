import 'package:flutter/material.dart';

import '../account/member_service.dart';
import '../auth/auth_service.dart';
import '../auth/session_expiry.dart';
import '../models/post_feed.dart';
import '../submissions/photo_picker.dart';
import '../submissions/submission_service.dart';

/// Form where a member submits their own bike or pizza. On success the
/// submission is stored for review (and the reviewer emailed); the member
/// sees a thank-you.
class SubmitScreen extends StatefulWidget {
  const SubmitScreen({
    super.key,
    required this.feed,
    required this.submissions,
    required this.photos,
    required this.auth,
    this.members,
  });

  final PostFeed feed;
  final SubmissionService submissions;
  final PhotoPicker photos;
  final AuthService auth;

  /// When given, the "From" field starts as the member's username.
  final MemberService? members;

  @override
  State<SubmitScreen> createState() => _SubmitScreenState();
}

class _SubmitScreenState extends State<SubmitScreen> {
  final _formKey = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _from = TextEditingController();
  final _description = TextEditingController();
  SubmissionPhoto? _photo;
  bool _photoMissing = false;
  bool _sending = false;
  SubmissionResult? _result;

  @override
  void initState() {
    super.initState();
    _prefillFrom();
  }

  Future<void> _prefillFrom() async {
    final members = widget.members;
    if (members == null) return;
    try {
      final profile = await members.load();
      if (mounted && _from.text.isEmpty) _from.text = profile.username;
    } on MemberException {
      // Left blank; the member types a name.
    }
  }

  @override
  void dispose() {
    _title.dispose();
    _from.dispose();
    _description.dispose();
    super.dispose();
  }

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
    setState(() {
      _photo = photo;
      _photoMissing = false;
    });
  }

  Future<void> _submit() async {
    final valid = _formKey.currentState!.validate();
    final photo = _photo;
    setState(() => _photoMissing = photo == null);
    if (!valid || photo == null) return;

    final messenger = ScaffoldMessenger.of(context);
    setState(() => _sending = true);
    try {
      final result = await widget.submissions.submit(
        Submission(
          feed: widget.feed,
          title: _title.text.trim(),
          from: _from.text.trim(),
          description: _description.text.trim(),
          photo: photo,
        ),
      );
      if (mounted) setState(() => _result = result);
    } on SubmissionException catch (e) {
      if (e.sessionExpired && mounted) {
        return handleSessionExpired(context, widget.auth);
      }
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final label = widget.feed.submitLabel ?? 'Submit';
    return Scaffold(
      appBar: AppBar(title: Text(label)),
      body: _result != null ? _ThankYou(feed: widget.feed) : _buildForm(),
    );
  }

  Widget _buildForm() {
    final theme = Theme.of(context);
    final photo = _photo;
    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Main photo', style: theme.textTheme.titleSmall),
          const SizedBox(height: 8),
          if (photo != null) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: SizedBox(
                height: 200,
                width: double.infinity,
                child: Image.memory(
                  photo.bytes,
                  key: const Key('photo-preview'),
                  fit: BoxFit.cover,
                ),
              ),
            ),
            const SizedBox(height: 8),
          ],
          OutlinedButton.icon(
            key: const Key('pick-photo'),
            onPressed: _sending ? null : _pickPhoto,
            icon: Icon(
              photo == null
                  ? Icons.add_a_photo_outlined
                  : Icons.photo_camera_back_outlined,
            ),
            label: Text(photo == null ? 'Add photo' : 'Change photo'),
          ),
          if (_photoMissing)
            Padding(
              padding: const EdgeInsets.only(top: 6, left: 12),
              child: Text(
                'Please add a photo.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.error,
                ),
              ),
            ),
          const SizedBox(height: 20),
          TextFormField(
            key: const Key('title'),
            controller: _title,
            enabled: !_sending,
            textCapitalization: TextCapitalization.sentences,
            maxLength: 255,
            // Keep the label up so the grey example text is always visible.
            decoration: InputDecoration(
              labelText: 'Title',
              hintText: widget.feed.submitTitleHint,
              floatingLabelBehavior: FloatingLabelBehavior.always,
              counterText: '',
            ),
            validator: (v) =>
                (v ?? '').trim().isEmpty ? 'Please give it a title.' : null,
          ),
          const SizedBox(height: 12),
          TextFormField(
            key: const Key('from'),
            controller: _from,
            enabled: !_sending,
            textCapitalization: TextCapitalization.words,
            maxLength: 100,
            decoration: const InputDecoration(
              labelText: 'From',
              hintText: '(your name/nickname)',
              floatingLabelBehavior: FloatingLabelBehavior.always,
              counterText: '',
            ),
            validator: (v) =>
                (v ?? '').trim().isEmpty ? 'Tell us who this is from.' : null,
          ),
          const SizedBox(height: 12),
          TextFormField(
            key: const Key('description'),
            controller: _description,
            enabled: !_sending,
            textCapitalization: TextCapitalization.sentences,
            minLines: 5,
            maxLines: 12,
            maxLength: 10000,
            decoration: const InputDecoration(
              labelText: 'Description/Story',
              alignLabelWithHint: true,
              counterText: '',
            ),
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            key: const Key('submit'),
            onPressed: _sending ? null : _submit,
            icon: _sending
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.send_outlined),
            label: Text(_sending ? 'Sending…' : 'Submit'),
          ),
          const SizedBox(height: 8),
          Text(
            'Submissions go to bikes.pizza for review before anything '
            'is published.',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

class _ThankYou extends StatelessWidget {
  const _ThankYou({required this.feed});

  final PostFeed feed;

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
              'Your ${feed.submitNoun} is on its way to bikes.pizza. '
              'Keep an eye on the blog.',
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
