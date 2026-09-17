import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../auth/auth_service.dart';
import '../auth/session_expiry.dart';
import '../messages/thread_service.dart';
import '../widgets/status_message.dart';

/// Settings → Blocked members: who the member has blocked, each with an
/// Unblock button.
class BlockedMembersScreen extends StatefulWidget {
  const BlockedMembersScreen({
    super.key,
    required this.service,
    required this.auth,
  });

  final ThreadService service;
  final AuthService auth;

  @override
  State<BlockedMembersScreen> createState() => _BlockedMembersScreenState();
}

class _BlockedMembersScreenState extends State<BlockedMembersScreen> {
  List<BlockedMember>? _blocked;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _blocked = null;
      _error = null;
    });
    try {
      final blocked = await widget.service.blocks();
      if (mounted) setState(() => _blocked = blocked);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.sessionExpired) return handleSessionExpired(context, widget.auth);
      setState(() => _error = e.message);
    }
  }

  Future<void> _unblock(BlockedMember member) async {
    try {
      await widget.service.block(member.username, on: false);
      if (!mounted) return;
      setState(
        () => _blocked = [
          for (final b in _blocked ?? const <BlockedMember>[])
            if (b.uid != member.uid) b,
        ],
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final blocked = _blocked;
    final error = _error;
    final Widget body;
    if (error != null) {
      body = StatusMessage(
        icon: Icons.cloud_off_outlined,
        title: 'Could not load the list',
        detail: error,
        actionLabel: 'Retry',
        onAction: _load,
      );
    } else if (blocked == null) {
      body = const Center(child: CircularProgressIndicator());
    } else if (blocked.isEmpty) {
      body = StatusMessage(
        icon: Icons.block_outlined,
        title: 'Nobody is blocked',
        detail:
            'Block a member from their conversation to stop them '
            'messaging you and hide their comments.',
        actionLabel: 'Refresh',
        onAction: _load,
      );
    } else {
      body = ListView(
        children: [
          for (final member in blocked)
            ListTile(
              key: Key('blocked-${member.uid}'),
              leading: const Icon(Icons.block_outlined),
              title: Text(member.username),
              trailing: TextButton(
                key: Key('unblock-${member.uid}'),
                onPressed: () => _unblock(member),
                child: const Text('Unblock'),
              ),
            ),
        ],
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Blocked members')),
      body: body,
    );
  }
}
