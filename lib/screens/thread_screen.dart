import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_widget_from_html_core/flutter_widget_from_html_core.dart';
import 'package:intl/intl.dart';

import '../api/api_client.dart';
import '../auth/auth_service.dart';
import '../auth/session_expiry.dart';
import '../contract.dart';
import '../messages/thread_service.dart';
import '../widgets/post_article.dart';

/// One direct message thread: the whole history as a bottom-aligned list
/// (newest at the bottom, older pages loading as the reader scrolls up),
/// own messages on the right, event lines ("(conversation continued by
/// email)", a block) centered in small type, and the composer at the
/// bottom with the same toolbar as comments. Own messages get Edit
/// (within five minutes) and Delete on long press; the menu offers Block
/// and Report. Live: the messages come from [ThreadService.messages].
class ThreadScreen extends StatefulWidget {
  const ThreadScreen({
    super.key,
    required this.thread,
    required this.service,
    required this.auth,
    this.now,
  });

  final Thread thread;
  final ThreadService service;
  final AuthService auth;
  final DateTime Function()? now;

  static const pageSize = 50;

  @override
  State<ThreadScreen> createState() => _ThreadScreenState();
}

class _ThreadScreenState extends State<ThreadScreen> {
  StreamSubscription<List<Message>>? _messages;
  StreamSubscription<Thread?>? _threadUpdates;
  List<Message> _list = const [];
  int _limit = ThreadScreen.pageSize;
  bool _loaded = false;
  String? _error;
  final _text = TextEditingController();
  final _focus = FocusNode();
  Message? _editing;
  bool _sending = false;
  late Thread _thread = widget.thread;

  DateTime get _now => (widget.now ?? DateTime.now)();
  String get _uid => widget.auth.currentUser?.uid ?? '';

  @override
  void initState() {
    super.initState();
    _text.addListener(() => setState(() {}));
    _listen();
    _threadUpdates = widget.service.thread(_thread.id).listen((thread) {
      if (mounted && thread != null) setState(() => _thread = thread);
    }, onError: (_) {});
    if (!_thread.gone) widget.service.markSeen(_thread.id).catchError((_) {});
  }

  void _listen() {
    _messages?.cancel();
    _messages = widget.service
        .messages(_thread.id, limit: _limit)
        .listen(
          (messages) {
            if (!mounted) return;
            final wasAtEnd = _list.isEmpty || messages.length > _list.length;
            setState(() {
              _list = messages;
              _loaded = true;
              _error = null;
            });
            if (wasAtEnd) {
              widget.service.markSeen(_thread.id).catchError((_) {});
            }
          },
          onError: (Object error) {
            if (mounted) {
              setState(() {
                _loaded = true;
                _error = 'Could not load the messages.';
              });
            }
          },
        );
  }

  @override
  void dispose() {
    _messages?.cancel();
    _threadUpdates?.cancel();
    _text.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _loadOlder() {
    if (_list.length < _limit) return;
    _limit += ThreadScreen.pageSize;
    _listen();
  }

  Future<void> _fail(ApiException error) async {
    if (!mounted) return;
    if (error.sessionExpired) {
      await handleSessionExpired(context, widget.auth);
      return;
    }
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(error.message)));
  }

  Future<void> _send() async {
    final text = _text.text.trim();
    if (text.isEmpty || text.length > messageMaxLength || _sending) return;
    setState(() => _sending = true);
    try {
      final editing = _editing;
      if (editing != null) {
        await widget.service.edit(_thread.id, editing.id, text);
      } else {
        await widget.service.send(_thread.id, text);
      }
      if (!mounted) return;
      _text.clear();
      setState(() => _editing = null);
    } on ApiException catch (error) {
      await _fail(error);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _wrap(String before, String after) {
    final value = _text.value;
    final selection = value.selection.isValid
        ? value.selection
        : TextSelection.collapsed(offset: value.text.length);
    final selected = selection.textInside(value.text);
    _text.value = value
        .replaced(selection, '$before$selected$after')
        .copyWith(
          selection: TextSelection.collapsed(
            offset: selection.start + before.length + selected.length,
          ),
        );
    _focus.requestFocus();
  }

  Future<void> _link() async {
    final value = _text.value;
    final selection = value.selection.isValid
        ? value.selection
        : TextSelection.collapsed(offset: value.text.length);
    final selected = selection.textInside(value.text);
    final controller = TextEditingController();
    final url = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add a link'),
        content: TextField(
          key: const Key('link-url'),
          controller: controller,
          autofocus: true,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(hintText: 'https://'),
          onSubmitted: (v) => Navigator.of(context).pop(v.trim()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('link-add'),
            onPressed: () => Navigator.of(context).pop(controller.text.trim()),
            child: const Text('Add'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (url == null || url.isEmpty || !mounted) return;
    final label = selected.isEmpty ? 'link' : selected;
    _text.value = value
        .replaced(selection, '[$label]($url)')
        .copyWith(
          selection: TextSelection.collapsed(
            offset: selection.start + label.length + url.length + 4,
          ),
        );
    _focus.requestFocus();
  }

  Future<void> _onMessageMenu(Message message) async {
    final canEdit = message.editableAt(_now, messageEditWindow);
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (canEdit)
              ListTile(
                key: const Key('message-edit'),
                leading: const Icon(Icons.edit_outlined),
                title: const Text('Edit'),
                onTap: () => Navigator.of(context).pop('edit'),
              ),
            ListTile(
              key: const Key('message-delete'),
              leading: const Icon(Icons.delete_outline),
              title: const Text('Delete'),
              onTap: () => Navigator.of(context).pop('delete'),
            ),
          ],
        ),
      ),
    );
    if (!mounted || choice == null) return;
    if (choice == 'edit') {
      setState(() {
        _editing = message;
        _text.text = message.text;
      });
      _focus.requestFocus();
      return;
    }
    try {
      await widget.service.delete(_thread.id, message.id);
    } on ApiException catch (error) {
      await _fail(error);
    }
  }

  Future<void> _block() async {
    final on = !_thread.blockedByMe;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          on
              ? 'Block ${_thread.otherUsername}?'
              : 'Unblock ${_thread.otherUsername}?',
        ),
        content: Text(
          on
              ? 'Neither of you can message the other, and their comments '
                    'are hidden from you, until you unblock them.'
              : 'You can message each other again.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('block-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(on ? 'Block' : 'Unblock'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await widget.service.block(_thread.otherUsername, on: on);
      if (!mounted) return;
      setState(() {
        _thread = Thread(
          id: _thread.id,
          otherUid: _thread.otherUid,
          otherUsername: _thread.otherUsername,
          lastText: _thread.lastText,
          lastAt: _thread.lastAt,
          unread: _thread.unread,
          blocked: on,
          blockedByMe: on,
          gone: _thread.gone,
          conversation: _thread.conversation,
        );
      });
    } on ApiException catch (error) {
      await _fail(error);
    }
  }

  Future<void> _askEmail() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Continue in email?'),
        content: Text(
          '${_thread.otherUsername} will be asked to agree. If they do, '
          'the conversation so far is emailed to them, and replying goes '
          'to you: your email address will be shown to them.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('email-ask-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Ask'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await widget.service.requestEmail(_thread.id);
    } on ApiException catch (error) {
      await _fail(error);
    }
  }

  Future<void> _agreeEmail() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Continue in email?'),
        content: Text(
          'The conversation so far will be emailed to you, with '
          '${_thread.otherUsername}\'s address as the reply address. When '
          'you reply, they will see your email address. The conversation '
          'here ends; you can always start a new one.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Not now'),
          ),
          FilledButton(
            key: const Key('email-agree-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Agree'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await widget.service.agreeEmail(_thread.id);
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Sent. Check your email.')));
    } on ApiException catch (error) {
      await _fail(error);
    }
  }

  Future<void> _withdrawEmail() async {
    try {
      await widget.service.withdrawEmail(_thread.id);
    } on ApiException catch (error) {
      await _fail(error);
    }
  }

  Future<void> _report() async {
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => SimpleDialog(
        title: const Text('Report this conversation'),
        children: [
          for (final entry in commentReportReasons.entries)
            SimpleDialogOption(
              key: Key('report-${entry.key}'),
              onPressed: () => Navigator.of(context).pop(entry.key),
              child: Text(entry.value),
            ),
        ],
      ),
    );
    if (reason == null || !mounted) return;
    try {
      await widget.service.report(_thread.id, reason);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Thanks. We'll take a look.")),
      );
    } on ApiException catch (error) {
      await _fail(error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final thread = _thread;
    final closed = thread.gone || thread.blocked;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          thread.otherUsername.isEmpty ? 'Conversation' : thread.otherUsername,
        ),
        actions: [
          if (!thread.gone)
            PopupMenuButton<String>(
              key: const Key('thread-menu'),
              onSelected: (choice) => switch (choice) {
                'block' => _block(),
                _ => _report(),
              },
              itemBuilder: (context) => [
                PopupMenuItem(
                  value: 'block',
                  child: Text(thread.blockedByMe ? 'Unblock' : 'Block'),
                ),
                const PopupMenuItem(value: 'report', child: Text('Report')),
              ],
            ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: !_loaded
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                ? Center(child: Text(_error!))
                : _MessageList(
                    key: const Key('messages'),
                    messages: _list,
                    uid: _uid,
                    thread: thread,
                    hasOlder: _list.length >= _limit,
                    onOlder: _loadOlder,
                    onMenu: _onMessageMenu,
                  ),
          ),
          if (thread.gone)
            _Note(
              key: const Key('thread-gone'),
              text:
                  'This conversation is gone: the other member deleted '
                  'their account.',
            )
          else if (thread.blocked)
            _Note(
              key: const Key('thread-blocked'),
              text: thread.blockedByMe
                  ? 'You blocked ${thread.otherUsername}. Unblock them from '
                        'the menu to keep talking.'
                  : 'This conversation is closed.',
            )
          else ...[
            if (thread.emailRequestBy == _uid)
              _EmailCard(
                key: const Key('email-waiting'),
                text:
                    'Waiting for ${thread.otherUsername} to agree to '
                    'continue in email.',
                actions: [
                  TextButton(
                    key: const Key('email-cancel'),
                    onPressed: _withdrawEmail,
                    child: const Text('Cancel'),
                  ),
                ],
              )
            else if (thread.emailRequestBy != null)
              _EmailCard(
                key: const Key('email-request'),
                text:
                    '${thread.otherUsername} would like to continue this '
                    'conversation by email. Agreeing shares your email '
                    'address with them.',
                actions: [
                  TextButton(
                    key: const Key('email-decline'),
                    onPressed: _withdrawEmail,
                    child: const Text('Not now'),
                  ),
                  FilledButton(
                    key: const Key('email-agree'),
                    onPressed: _agreeEmail,
                    child: const Text('Agree'),
                  ),
                ],
              )
            else if (_list.any(
              (m) => !m.isEvent && m.conversation == thread.conversation,
            ))
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  key: const Key('email-ask'),
                  onPressed: _askEmail,
                  icon: const Icon(Icons.alternate_email, size: 16),
                  label: const Text('Continue this conversation in email'),
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                  ),
                ),
              ),
            _Composer(
              controller: _text,
              focus: _focus,
              editing: _editing != null,
              sending: _sending,
              onCancelEdit: () => setState(() {
                _editing = null;
                _text.clear();
              }),
              onBold: () => _wrap('**', '**'),
              onItalic: () => _wrap('_', '_'),
              onLink: _link,
              onSend: _send,
            ),
          ],
          if (closed) SizedBox(height: MediaQuery.paddingOf(context).bottom),
        ],
      ),
    );
  }
}

/// The messages, bottom-aligned: a reversed list so the newest sits at
/// the bottom and scrolling up reaches the past; the top asks for older
/// pages.
class _MessageList extends StatelessWidget {
  const _MessageList({
    super.key,
    required this.messages,
    required this.uid,
    required this.thread,
    required this.hasOlder,
    required this.onOlder,
    required this.onMenu,
  });

  final List<Message> messages;
  final String uid;
  final Thread thread;
  final bool hasOlder;
  final VoidCallback onOlder;
  final ValueChanged<Message> onMenu;

  static final _timeFormat = DateFormat.MMMd().add_jm();

  String _eventLine(Message m) => switch (m.event) {
    'emailed' => '(conversation continued by email)',
    'declined' => '(the request to continue by email was declined)',
    'blocked' =>
      m.by == uid
          ? '(you blocked ${thread.otherUsername})'
          : '(${thread.otherUsername} blocked this conversation)',
    _ => '(${m.event})',
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (messages.isEmpty) {
      return Center(
        child: Text(
          'Say hello.',
          style: theme.textTheme.bodyLarge?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      );
    }
    final extra = hasOlder ? 1 : 0;
    return ListView.builder(
      reverse: true,
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
      itemCount: messages.length + extra,
      itemBuilder: (context, i) {
        if (i == messages.length) {
          return Center(
            child: TextButton(
              key: const Key('messages-older'),
              onPressed: onOlder,
              child: const Text('Load older messages'),
            ),
          );
        }
        final message = messages[messages.length - 1 - i];
        if (message.isEvent) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Center(
              child: Text(
                _eventLine(message),
                key: Key('event-${message.id}'),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          );
        }
        final mine = message.uid == uid;
        final bubble = mine
            ? theme.colorScheme.primaryContainer
            : theme.colorScheme.surfaceContainerHighest;
        final ink = mine
            ? theme.colorScheme.onPrimaryContainer
            : theme.colorScheme.onSurface;
        return Align(
          alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
          child: GestureDetector(
            key: Key('message-${message.id}'),
            onLongPress: mine && !message.deleted
                ? () => onMenu(message)
                : null,
            child: Container(
              constraints: const BoxConstraints(maxWidth: 320),
              margin: const EdgeInsets.symmetric(vertical: 3),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: bubble,
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(16),
                  topRight: const Radius.circular(16),
                  bottomLeft: Radius.circular(mine ? 16 : 4),
                  bottomRight: Radius.circular(mine ? 4 : 16),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (message.deleted)
                    Text(
                      'Message deleted',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontStyle: FontStyle.italic,
                        color: ink.withValues(alpha: 0.7),
                      ),
                    )
                  else
                    HtmlWidget(
                      message.html,
                      textStyle: theme.textTheme.bodyMedium?.copyWith(
                        color: ink,
                      ),
                      onTapUrl: PostArticle.open,
                    ),
                  const SizedBox(height: 2),
                  Text(
                    '${_timeFormat.format(message.at.toLocal())}'
                    '${message.editedAt != null ? ' · edited' : ''}',
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: ink.withValues(alpha: 0.7),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// The continue-by-email request as a card above the composer.
class _EmailCard extends StatelessWidget {
  const _EmailCard({super.key, required this.text, required this.actions});

  final String text;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(text, style: theme.textTheme.bodyMedium),
            Row(mainAxisAlignment: MainAxisAlignment.end, children: actions),
          ],
        ),
      ),
    );
  }
}

class _Note extends StatelessWidget {
  const _Note({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      color: theme.colorScheme.surfaceContainer,
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: theme.textTheme.bodyMedium?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}

/// The field a message is written in, the toolbar and the Send button.
class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.focus,
    required this.editing,
    required this.sending,
    required this.onCancelEdit,
    required this.onBold,
    required this.onItalic,
    required this.onLink,
    required this.onSend,
  });

  final TextEditingController controller;
  final FocusNode focus;
  final bool editing;
  final bool sending;
  final VoidCallback onCancelEdit;
  final VoidCallback onBold;
  final VoidCallback onItalic;
  final VoidCallback onLink;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final length = controller.text.trim().length;
    final tooLong = length > messageMaxLength;
    return Material(
      color: theme.colorScheme.surfaceContainer,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (editing)
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Editing your message',
                        key: const Key('composer-mode'),
                        style: theme.textTheme.bodySmall,
                      ),
                    ),
                    IconButton(
                      key: const Key('composer-cancel'),
                      tooltip: 'Cancel',
                      iconSize: 18,
                      visualDensity: VisualDensity.compact,
                      icon: const Icon(Icons.close),
                      onPressed: onCancelEdit,
                    ),
                  ],
                ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      key: const Key('message-text'),
                      controller: controller,
                      focusNode: focus,
                      minLines: 1,
                      maxLines: 5,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: const InputDecoration(
                        hintText: 'Message',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    key: const Key('message-send'),
                    tooltip: editing ? 'Save' : 'Send',
                    icon: Icon(editing ? Icons.check : Icons.send),
                    onPressed: length == 0 || tooLong || sending
                        ? null
                        : onSend,
                  ),
                ],
              ),
              Row(
                children: [
                  IconButton(
                    key: const Key('message-bold'),
                    tooltip: 'Bold',
                    iconSize: 18,
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(Icons.format_bold),
                    onPressed: onBold,
                  ),
                  IconButton(
                    key: const Key('message-italic'),
                    tooltip: 'Italic',
                    iconSize: 18,
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(Icons.format_italic),
                    onPressed: onItalic,
                  ),
                  IconButton(
                    key: const Key('message-link'),
                    tooltip: 'Link',
                    iconSize: 18,
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(Icons.link),
                    onPressed: onLink,
                  ),
                  const Spacer(),
                  Text(
                    '$length/$messageMaxLength',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: tooLong
                          ? theme.colorScheme.error
                          : theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
