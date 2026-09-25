import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_client.dart';
import '../auth/auth_service.dart';
import '../contract.dart';
import '../models/post.dart';
import '../posts/concern_service.dart';

/// Reports a concern to the moderators: about [post] when opened from a
/// post's page (the post is then fixed), otherwise about a post, a member
/// or anything else that the member names. A signed-out visitor is told
/// how to sign in and given the email address instead, so a report is
/// always possible from here.
class ReportConcernScreen extends StatefulWidget {
  const ReportConcernScreen({
    super.key,
    required this.concerns,
    required this.auth,
    this.post,
  });

  final ConcernService concerns;
  final AuthService auth;
  final Post? post;

  /// Where reports go when the form cannot be used.
  static const String address = 'remove.post@bikes.pizza';

  @override
  State<ReportConcernScreen> createState() => _ReportConcernScreenState();
}

class _ReportConcernScreenState extends State<ReportConcernScreen> {
  String _kind = 'post';
  String? _reason;
  final _target = TextEditingController();
  final _details = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _target.dispose();
    _details.dispose();
    super.dispose();
  }

  bool get _complete {
    if (_reason == null) return false;
    if (widget.post != null) return true;
    if (_kind == 'other') return _details.text.trim().isNotEmpty;
    return _target.text.trim().isNotEmpty;
  }

  Future<void> _send() async {
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    final post = widget.post;
    final report = ConcernReport(
      kind: post == null ? _kind : 'post',
      reason: _reason!,
      target: post?.id ?? _target.text.trim(),
      details: _details.text.trim(),
    );
    setState(() => _sending = true);
    try {
      await widget.concerns.report(report);
      if (!mounted) return;
      navigator.pop();
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            report.reason == 'child_safety'
                ? 'Thanks. Child safety reports are handled first.'
                : "Thanks. We'll look at it, normally within 24 hours.",
          ),
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _sending = false);
      messenger.showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<bool> _email() {
    final uri = Uri(
      scheme: 'mailto',
      path: ReportConcernScreen.address,
      queryParameters: {
        'subject': 'Report: ${widget.post?.title ?? 'a concern'}',
      },
    );
    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final post = widget.post;
    return Scaffold(
      appBar: AppBar(title: const Text('Report a concern')),
      body: StreamBuilder<AppUser?>(
        stream: widget.auth.userChanges,
        initialData: widget.auth.currentUser,
        builder: (context, snapshot) {
          final signedIn = snapshot.data != null;
          return ListView(
            key: const Key('report-form'),
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
            children: [
              Text(
                'Tell us about objectionable content, abuse, a photo used '
                'without permission, or a concern about a child. Reports '
                'are read by a person.',
                style: theme.textTheme.bodyMedium,
              ),
              const SizedBox(height: 16),
              if (post != null) ...[
                Text('About', style: theme.textTheme.labelLarge),
                const SizedBox(height: 4),
                Text(post.title, key: const Key('report-about')),
              ] else ...[
                Text('What is it about?', style: theme.textTheme.labelLarge),
                const SizedBox(height: 8),
                SegmentedButton<String>(
                  key: const Key('report-kind'),
                  segments: [
                    for (final entry in concernKinds.entries)
                      ButtonSegment(value: entry.key, label: Text(entry.value)),
                  ],
                  selected: {_kind},
                  showSelectedIcon: false,
                  onSelectionChanged: (picked) =>
                      setState(() => _kind = picked.single),
                ),
                if (_kind != 'other') ...[
                  const SizedBox(height: 12),
                  TextField(
                    key: const Key('report-target'),
                    controller: _target,
                    maxLength: concernMaxTarget,
                    decoration: InputDecoration(
                      labelText: _kind == 'post'
                          ? 'Which post? A link or its title'
                          : 'Which member? Their username',
                      border: const OutlineInputBorder(),
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                ],
              ],
              const SizedBox(height: 16),
              Text('Why?', style: theme.textTheme.labelLarge),
              RadioGroup<String>(
                groupValue: _reason,
                onChanged: (value) => setState(() => _reason = value),
                child: Column(
                  children: [
                    for (final entry in concernReasons.entries)
                      RadioListTile<String>(
                        key: Key('reason-${entry.key}'),
                        title: Text(entry.value),
                        value: entry.key,
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                key: const Key('report-details'),
                controller: _details,
                maxLength: concernMaxDetails,
                maxLines: 5,
                minLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Anything more?',
                  border: OutlineInputBorder(),
                  alignLabelWithHint: true,
                ),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 16),
              if (signedIn)
                FilledButton(
                  key: const Key('report-send'),
                  onPressed: _complete && !_sending ? _send : null,
                  child: Text(_sending ? 'Sending…' : 'Send report'),
                )
              else ...[
                Text(
                  'Sign in from Settings to send this report, or email it to us.',
                  key: const Key('report-signed-out'),
                  style: theme.textTheme.bodyMedium,
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  key: const Key('report-email'),
                  onPressed: _email,
                  icon: const Icon(Icons.mail_outline),
                  label: const Text(ReportConcernScreen.address),
                ),
              ],
              const SizedBox(height: 16),
              Text(
                'If a child is in immediate danger, contact your local police '
                'or emergency services first.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
