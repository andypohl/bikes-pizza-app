import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../auth/auth_service.dart';
import '../auth/session_expiry.dart';
import '../models/post_feed.dart';
import '../widgets/layout.dart';
import '../widgets/post_article.dart';
import '../widgets/post_tile.dart';
import '../widgets/status_message.dart';
import 'admin_screens.dart';
import 'admin_service.dart';

/// The submissions review, as https://submissions.bikes.pizza/ does it,
/// for administrators on a tablet: each feed's queue, the website's
/// submit button switch, the submissions filtered by status with paging,
/// and a detail view with the review actions. On a landscape tablet the
/// detail opens beside the list; otherwise on its own screen.
class SubmissionsScreen extends StatefulWidget {
  const SubmissionsScreen({
    super.key,
    required this.admin,
    required this.auth,
    this.pageSize = 20,
  });

  final AdminService admin;
  final AuthService auth;
  final int pageSize;

  @override
  State<SubmissionsScreen> createState() => _SubmissionsScreenState();
}

class _SubmissionsScreenState extends State<SubmissionsScreen> {
  static const _filters = [
    ('pending', 'Pending'),
    ('queued', 'Queued'),
    ('approved', 'Posted'),
    ('rejected', 'Rejected'),
    ('', 'All'),
  ];
  static const _feeds = ['bikes', 'pizza'];

  String _status = 'pending';
  List<AdminSubmission>? _items;
  ApiException? _error;
  bool _busy = false;

  /// The cursor that fetched each loaded page, page 0 having none.
  final _cursors = <String?>[null];
  int _page = 0;
  String? _nextCursor;

  List<QueueInfo> _queues = const [];
  bool? _submitButton;
  AdminSubmission? _selected;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final page = await widget.admin.submissions(
        status: _status,
        limit: widget.pageSize,
        after: _cursors[_page],
      );
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _nextCursor = page.nextCursor;
      });
      _loadExtras();
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.sessionExpired) return handleSessionExpired(context, widget.auth);
      setState(() {
        _items = null;
        _error = e;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The queue lines and the submit switch; a failure leaves them blank.
  Future<void> _loadExtras() async {
    try {
      final queues = await Future.wait(_feeds.map(widget.admin.queueInfo));
      final submitButton = await widget.admin.submitButton();
      if (!mounted) return;
      setState(() {
        _queues = queues;
        _submitButton = submitButton;
      });
    } on ApiException {
      if (mounted) setState(() => _queues = const []);
    }
  }

  void _filter(String status) {
    setState(() {
      _status = status;
      _cursors
        ..clear()
        ..add(null);
      _page = 0;
      _selected = null;
    });
    _load();
  }

  void _next() {
    final cursor = _nextCursor;
    if (cursor == null) return;
    setState(() {
      _page += 1;
      if (_cursors.length <= _page) _cursors.add(cursor);
      _selected = null;
    });
    _load();
  }

  void _previous() {
    if (_page == 0) return;
    setState(() {
      _page -= 1;
      _selected = null;
    });
    _load();
  }

  Future<void> _toggleSubmitButton(bool on) async {
    setState(() => _submitButton = on);
    final result = await guardAdmin(
      context,
      widget.auth,
      () => widget.admin.setSubmitButton(on),
    );
    if (mounted) setState(() => _submitButton = result ?? !on);
  }

  void _open(AdminSubmission submission) {
    if (isLandscapeTablet(context)) {
      setState(() => _selected = submission);
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => Scaffold(
          appBar: AppBar(title: Text(submission.title)),
          body: SubmissionDetail(
            submission: submission,
            admin: widget.admin,
            auth: widget.auth,
            onDone: (message) {
              Navigator.of(context).pop();
              _acted(message);
            },
          ),
        ),
      ),
    );
  }

  /// After a review action: say what happened and refresh the list.
  void _acted(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
    setState(() => _selected = null);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final split = isLandscapeTablet(context);
    final selected = _selected;
    final list = _buildList(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Submissions'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh),
            onPressed: _busy ? null : _load,
          ),
        ],
      ),
      body: split
          ? Row(
              children: [
                Expanded(child: list),
                const VerticalDivider(width: 1, thickness: 1),
                Expanded(
                  child: selected == null
                      ? const NothingSelected(
                          'Choose a submission to review it here.',
                        )
                      : Column(
                          key: ValueKey(selected.id),
                          children: [
                            Padding(
                              padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.end,
                                children: [
                                  IconButton(
                                    key: const Key('close-submission'),
                                    tooltip: 'Close',
                                    icon: const Icon(Icons.close),
                                    onPressed: () =>
                                        setState(() => _selected = null),
                                  ),
                                ],
                              ),
                            ),
                            Expanded(
                              child: SubmissionDetail(
                                submission: selected,
                                admin: widget.admin,
                                auth: widget.auth,
                                onDone: _acted,
                              ),
                            ),
                          ],
                        ),
                ),
              ],
            )
          : list,
    );
  }

  Widget _buildList(BuildContext context) {
    final theme = Theme.of(context);
    final items = _items;
    final error = _error;
    final split = isLandscapeTablet(context);

    final Widget body;
    if (error != null) {
      body = AdminError(error: error, onRetry: _load);
    } else if (items == null) {
      body = const Center(child: CircularProgressIndicator());
    } else if (items.isEmpty) {
      body = StatusMessage(
        icon: Icons.inbox_outlined,
        title: 'Nothing here',
        detail:
            'No ${_status.isEmpty ? '' : '${AdminSubmission.statusLabels[_status]?.toLowerCase()} '}submissions.',
        actionLabel: 'Refresh',
        onAction: _load,
      );
    } else {
      body = ListView.separated(
        itemCount: items.length,
        separatorBuilder: (_, _) => const Divider(height: 1, indent: 16),
        itemBuilder: (context, index) {
          final s = items[index];
          final thumb = s.thumbUrl ?? s.post?.imageUrl;
          return InkWell(
            key: Key('submission-${s.id}'),
            onTap: () => _open(s),
            child: Ink(
              color: split && s.id == _selected?.id
                  ? theme.colorScheme.secondaryContainer
                  : null,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Row(
                children: [
                  PostThumbnail(
                    imageUrl: thumb,
                    width: PostTile.thumbWidth,
                    height: PostTile.thumbHeight,
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          s.title,
                          style: theme.textTheme.titleMedium,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${s.feedLabel} · from ${s.from} · ${when(s.createdAt)}',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Chip(
                    label: Text(s.statusLabel),
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ),
            ),
          );
        },
      );
    }

    return Column(
      children: [
        if (_queues.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Text(
              [
                for (final q in _queues)
                  '${feedNounLabel(q.feed)} queue: '
                      '${q.length} waiting · next post in ${q.countdown}',
              ].join('\n'),
              key: const Key('queues'),
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        SwitchListTile(
          key: const Key('submit-button-setting'),
          title: const Text('Website submit button'),
          subtitle: const Text('Show "Submit a bike or pizza" on bikes.pizza'),
          value: _submitButton ?? false,
          onChanged: _submitButton == null ? null : _toggleSubmitButton,
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Row(
            children: [
              for (final (value, label) in _filters)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: ChoiceChip(
                    key: Key('filter-${value.isEmpty ? 'all' : value}'),
                    label: Text(label),
                    selected: _status == value,
                    onSelected: _busy ? null : (_) => _filter(value),
                  ),
                ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(child: body),
        Pager(
          label: items == null || items.isEmpty ? '' : 'Page ${_page + 1}',
          onPrevious: _page > 0 && !_busy ? _previous : null,
          onNext: _nextCursor != null && !_busy ? _next : null,
        ),
      ],
    );
  }
}

/// One submission in full with the review actions: Queue to post (Apply
/// edit for an edit), Reject after a confirmation, and for a queued one Remove from queue. [onDone] gets a
/// message once an action has gone through.
class SubmissionDetail extends StatefulWidget {
  const SubmissionDetail({
    super.key,
    required this.submission,
    required this.admin,
    required this.auth,
    required this.onDone,
  });

  final AdminSubmission submission;
  final AdminService admin;
  final AuthService auth;
  final ValueChanged<String> onDone;

  @override
  State<SubmissionDetail> createState() => _SubmissionDetailState();
}

class _SubmissionDetailState extends State<SubmissionDetail> {
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _review(String action) async {
    final s = widget.submission;
    if (action == 'reject') {
      final sure = await confirmDanger(
        context,
        title: 'Reject this submission?',
        message: '"${s.title}" from ${s.from} will not be posted.',
        confirmLabel: 'Reject',
        confirmKey: const Key('confirm-reject'),
      );
      if (!sure || !mounted) return;
    }
    setState(() => _busy = true);
    final result = await guardAdmin(
      context,
      widget.auth,
      () => widget.admin.review(s.id, action, note: _note.text),
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (result != null) widget.onDone(result.message);
  }

  Future<void> _dequeue() async {
    final s = widget.submission;
    setState(() => _busy = true);
    final ok = await guardAdmin(context, widget.auth, () async {
      await widget.admin.dequeue(s.feed, s.id);
      return true;
    });
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok == true) {
      widget.onDone('Removed from the queue; it is pending again.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final s = widget.submission;
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final photo = s.displayPhotoUrl;
    final safeSearch = s.safeSearch;
    final people = s.people;
    final review = s.review;
    final queue = s.queue;

    String pretty(String? v) =>
        (v ?? 'unknown').toLowerCase().replaceAll('_', ' ');

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(s.title, style: theme.textTheme.headlineSmall),
        const SizedBox(height: 4),
        Text(
          '${s.feedLabel} · from ${s.from}'
          '${s.submitterEmail == null ? '' : ' <${s.submitterEmail}>'}'
          ' · ${when(s.createdAt)}',
          style: muted,
        ),
        if (s.isEdit && s.post != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Wrap(
              key: const Key('edit-of'),
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text('Edit of ', style: muted),
                InkWell(
                  onTap: s.post!.url == null
                      ? null
                      : () => PostArticle.open(s.post!.url!),
                  child: Text(
                    s.post!.title,
                    style: muted?.copyWith(
                      color: theme.colorScheme.primary,
                      decoration: TextDecoration.underline,
                    ),
                  ),
                ),
                Text(' · changes: ${s.changedFields}', style: muted),
              ],
            ),
          ),
        if (photo != null) ...[
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 360),
              child: CachedNetworkImage(
                imageUrl: photo,
                fit: BoxFit.contain,
                errorWidget: (_, _, _) => const SizedBox.shrink(),
              ),
            ),
          ),
        ],
        const SizedBox(height: 12),
        Text(
          s.description.isEmpty ? '(no description)' : s.description,
          style: theme.textTheme.bodyLarge,
        ),
        if (safeSearch != null) ...[
          const SizedBox(height: 12),
          Text(
            'SafeSearch: adult ${pretty(safeSearch['adult'])} · '
            'racy ${pretty(safeSearch['racy'])} · '
            'violence ${pretty(safeSearch['violence'])}',
            style: muted,
          ),
        ],
        if (people != null) Text('People: ${people.summary}', style: muted),
        if (review != null) ...[
          const SizedBox(height: 8),
          Text(
            [
              '${s.statusLabel} by ${review.byEmail ?? ''} on ${when(review.at)}',
              if (review.postUrl != null) review.postUrl!,
              if (review.note.isNotEmpty) 'Note: ${review.note}',
            ].join(' · '),
            style: muted,
          ),
        ] else if (queue != null) ...[
          const SizedBox(height: 8),
          Text(
            [
              'Queued by ${queue.byEmail ?? ''} on ${when(queue.at)}',
              if (queue.note.isNotEmpty) 'Note: ${queue.note}',
              if (queue.lastError != null)
                'Last attempt failed: ${queue.lastError}',
            ].join(' · '),
            style: muted,
          ),
        ],
        if (s.isPending) ...[
          const SizedBox(height: 16),
          TextField(
            key: const Key('review-note'),
            controller: _note,
            enabled: !_busy,
            maxLength: 1000,
            decoration: const InputDecoration(
              labelText: 'Note (kept with the submission)',
              counterText: '',
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton(
                key: const Key('review-publish'),
                onPressed: _busy ? null : () => _review('publish'),
                child: Text(s.isEdit ? 'Apply edit' : 'Queue to post'),
              ),
              OutlinedButton(
                key: const Key('review-reject'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: theme.colorScheme.error,
                ),
                onPressed: _busy ? null : () => _review('reject'),
                child: const Text('Reject'),
              ),
            ],
          ),
        ],
        if (s.isQueued) ...[
          const SizedBox(height: 16),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton(
              key: const Key('review-dequeue'),
              onPressed: _busy ? null : _dequeue,
              child: const Text('Remove from queue'),
            ),
          ),
        ],
        const SizedBox(height: 24),
      ],
    );
  }
}
