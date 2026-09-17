import 'dart:async';

import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../auth/auth_service.dart';
import '../auth/session_expiry.dart';
import '../contract.dart';
import '../models/post.dart';
import '../posts/reaction_service.dart';

/// The reaction palettes of a post (`reactionPalettes` in the contract:
/// "I've had this pizza", "This bike looks", ...), each a row of chips
/// with how many members picked each option. A signed-in member taps to
/// pick; a "pick one" palette swaps the choice, the others toggle it, and
/// tapping a picked chip takes the pick back. The tallies start from what
/// the post carries and are refreshed, with the member's own picks and
/// who picked what, from [reactions] once someone is signed in; hovering
/// a chip (or holding it, on touch) then names some of the members who
/// picked it. Without a service the chips only show the tallies.
class ReactionsPanel extends StatefulWidget {
  const ReactionsPanel({
    super.key,
    required this.post,
    this.reactions,
    this.auth,
  });

  final Post post;
  final ReactionService? reactions;
  final AuthService? auth;

  /// The palettes a post takes; empty for feeds without any (news).
  static List<ReactionPalette> palettesFor(Post post) =>
      reactionPalettes[post.feed] ?? const [];

  @override
  State<ReactionsPanel> createState() => _ReactionsPanelState();
}

class _ReactionsPanelState extends State<ReactionsPanel> {
  late PostReactions _state = PostReactions(counts: widget.post.reactions);
  StreamSubscription<AppUser?>? _users;
  String? _loadedFor;
  int _requests = 0;

  bool get _signedIn => widget.auth?.currentUser != null;

  @override
  void initState() {
    super.initState();
    _users = widget.auth?.userChanges.listen((_) => _refresh());
    _refresh();
  }

  @override
  void didUpdateWidget(covariant ReactionsPanel old) {
    super.didUpdateWidget(old);
    if (old.post.id != widget.post.id) {
      _state = PostReactions(counts: widget.post.reactions);
      _loadedFor = null;
      _refresh();
    }
  }

  @override
  void dispose() {
    _users?.cancel();
    super.dispose();
  }

  /// Fetches the tallies and the member's picks when someone is signed
  /// in; when nobody is, forgets any picks shown for the last member.
  Future<void> _refresh() async {
    final service = widget.reactions;
    final uid = widget.auth?.currentUser?.uid;
    if (service == null) return;
    if (uid == null) {
      if (_loadedFor != null && mounted) {
        setState(() {
          _state = PostReactions(counts: _state.counts);
          _loadedFor = null;
        });
      }
      return;
    }
    if (uid == _loadedFor) return;
    _loadedFor = uid;
    final request = ++_requests;
    try {
      final fresh = await service.fetch(widget.post.id);
      if (mounted && request == _requests) setState(() => _state = fresh);
    } on ApiException {
      // The tallies from the post stand; the member can still tap.
    }
  }

  Future<void> _tap(ReactionPalette palette, String value) async {
    final service = widget.reactions;
    final auth = widget.auth;
    if (service == null) return;
    if (!_signedIn) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Sign in from Settings to react.')),
      );
      return;
    }
    final before = _state;
    final current = before.mine[palette.key] ?? const <String>[];
    final List<String> next;
    if (current.contains(value)) {
      next = [
        for (final v in current)
          if (v != value) v,
      ];
    } else if (palette.pickOne) {
      next = [value];
    } else {
      next = [...current, value];
    }
    final picks = {...before.mine, palette.key: next};
    final request = ++_requests;
    setState(() => _state = before.withPicks(palette, next));
    try {
      final saved = await service.set(widget.post.id, picks);
      if (mounted && request == _requests) setState(() => _state = saved);
    } on ApiException catch (error) {
      if (!mounted) return;
      if (request == _requests) setState(() => _state = before);
      if (error.sessionExpired && auth != null) {
        await handleSessionExpired(context, auth);
        return;
      }
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final palettes = ReactionsPanel.palettesFor(widget.post);
    if (palettes.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final canPick = widget.reactions != null;
    return Padding(
      key: const Key('reactions'),
      padding: const EdgeInsets.only(top: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final palette in palettes) ...[
            Text(
              palette.prompt,
              style: theme.textTheme.labelLarge?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                for (final option in palette.options)
                  _ReactionChip(
                    key: Key('reaction-${palette.key}-${option.value}'),
                    title: option.title,
                    count: _state.count(palette.key, option.value),
                    picked: _state.picked(palette.key, option.value),
                    who: _state.names(palette.key, option.value)?.line,
                    onTap: canPick ? () => _tap(palette, option.value) : null,
                  ),
              ],
            ),
            if (palette != palettes.last) const SizedBox(height: 14),
          ],
        ],
      ),
    );
  }
}

/// One option: its title, how many picked it (when anyone has) and
/// whether the member did. With [who], a tooltip names the pickers on
/// hover or long press.
class _ReactionChip extends StatelessWidget {
  const _ReactionChip({
    super.key,
    required this.title,
    required this.count,
    required this.picked,
    this.who,
    this.onTap,
  });

  final String title;
  final int count;
  final bool picked;
  final String? who;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final chip = FilterChip(
      label: Text(count > 0 ? '$title · $count' : title),
      selected: picked,
      showCheckmark: false,
      visualDensity: VisualDensity.compact,
      selectedColor: theme.colorScheme.primaryContainer,
      onSelected: onTap == null ? null : (_) => onTap!(),
    );
    final who = this.who;
    if (who == null) return chip;
    return Tooltip(
      message: who,
      waitDuration: const Duration(milliseconds: 300),
      child: chip,
    );
  }
}
