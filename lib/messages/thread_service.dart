import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../api/api_client.dart';
import '../auth/auth_service.dart';

/// A direct message thread as the member sees it (docs/api.md, "Direct
/// messages"): the other member, the newest message's preview, the
/// member's own unread count, and whether it is frozen by a block or gone
/// because the other member deleted their account.
class Thread {
  const Thread({
    required this.id,
    this.otherUid,
    this.otherUsername = '',
    this.lastText = '',
    this.lastAt,
    this.unread = 0,
    this.blocked = false,
    this.blockedByMe = false,
    this.gone = false,
    this.conversation = 1,
    this.emailRequestBy,
  });

  final String id;

  /// Null on a gone thread.
  final String? otherUid;
  final String otherUsername;
  final String lastText;
  final DateTime? lastAt;
  final int unread;
  final bool blocked;
  final bool blockedByMe;
  final bool gone;
  final int conversation;

  /// Who asked to continue the current conversation by email, while the
  /// request waits; null otherwise.
  final String? emailRequestBy;

  /// From the API's shape, or a Firestore document's, for [uid].
  factory Thread.fromJson(Map<String, dynamic> json, {required String uid}) {
    final other = json['other'];
    final members = json['members'];
    final usernames = json['usernames'];
    String? otherUid;
    String otherUsername = '';
    if (other is Map) {
      otherUid = other['uid'] as String?;
      otherUsername = other['username'] as String? ?? '';
    } else if (members is List) {
      for (final m in members) {
        if (m is String && m != uid) otherUid = m;
      }
      if (otherUid != null && usernames is Map) {
        otherUsername = usernames[otherUid] as String? ?? '';
      }
    }
    final last = json['last'];
    final unread = json['unread'];
    final blockedBy = json['blockedBy'];
    final request = json['emailRequest'];
    return Thread(
      id: json['id'] as String? ?? '',
      otherUid: otherUid,
      otherUsername: otherUsername,
      lastText: last is Map ? last['text'] as String? ?? '' : '',
      lastAt: DateTime.tryParse(json['lastMessageAt'] as String? ?? ''),
      unread: unread is Map
          ? (unread[uid] as num?)?.toInt() ?? 0
          : (unread as num?)?.toInt() ?? 0,
      blocked:
          json['blocked'] == true ||
          (blockedBy is List && blockedBy.isNotEmpty),
      blockedByMe:
          json['blockedByMe'] == true ||
          (blockedBy is List && blockedBy.contains(uid)),
      gone: json['gone'] == true,
      conversation: (json['conversation'] as num?)?.toInt() ?? 1,
      emailRequestBy: request is Map ? request['by'] as String? : null,
    );
  }
}

/// One entry of a thread: a message, or an event line such as a block.
class Message {
  const Message({
    required this.id,
    required this.at,
    this.kind = 'message',
    this.event,
    this.by,
    this.uid,
    this.text = '',
    this.html = '',
    this.editedAt,
    this.deleted = false,
    this.conversation = 1,
  });

  final String id;
  final String kind;

  /// On an event: `blocked`, `emailed`, `declined`.
  final String? event;
  final String? by;
  final String? uid;
  final String text;
  final String html;
  final DateTime at;
  final DateTime? editedAt;
  final bool deleted;
  final int conversation;

  bool get isEvent => kind == 'event';

  /// Whether the author may still edit it at [now].
  bool editableAt(DateTime now, Duration window) =>
      !isEvent && !deleted && now.difference(at) < window;

  static Message? fromJson(Map<String, dynamic> json) {
    final id = json['id'] as String?;
    if (id == null || id.isEmpty) return null;
    final kind = json['kind'] as String? ?? 'message';
    final at = DateTime.tryParse(
      (kind == 'event' ? json['at'] : json['createdAt']) as String? ??
          json['createdAt'] as String? ??
          '',
    );
    if (at == null) return null;
    final deleted = json['deleted'] == true || json['deletedAt'] is String;
    return Message(
      id: id,
      kind: kind,
      event: json['event'] as String?,
      by: json['by'] as String?,
      uid: json['uid'] as String?,
      text: deleted ? '' : json['text'] as String? ?? '',
      html: deleted ? '' : json['html'] as String? ?? '',
      at: at,
      editedAt: DateTime.tryParse(json['editedAt'] as String? ?? ''),
      deleted: deleted,
      conversation: (json['conversation'] as num?)?.toInt() ?? 1,
    );
  }
}

/// A member the signed-in member has blocked.
class BlockedMember {
  const BlockedMember({required this.uid, required this.username});

  final String uid;
  final String username;
}

/// Direct messages: the member's threads and each thread's messages as
/// live streams, and the writes, which go through the REST API. The real
/// one listens to Firestore; tests use an in-memory fake. Failures of the
/// writes are [ApiException]s.
abstract class ThreadService {
  /// The signed-in member's threads, newest message first, live.
  Stream<List<Thread>> threads();

  /// The newest [limit] entries of a thread, oldest first, live.
  Stream<List<Message>> messages(String threadId, {int limit = 50});

  /// One thread as it changes (unread counts, blocks, an email request),
  /// live; null once it no longer exists.
  Stream<Thread?> thread(String threadId);

  /// The thread with [username], created if there is none.
  Future<Thread> open(String username);

  Future<Message> send(String threadId, String text);

  Future<Message> edit(String threadId, String messageId, String text);

  Future<void> delete(String threadId, String messageId);

  Future<void> markSeen(String threadId);

  Future<void> report(String threadId, String reason);

  Future<void> block(String username, {required bool on});

  Future<List<BlockedMember>> blocks();

  /// Asks the other member to continue the current conversation by email.
  Future<void> requestEmail(String threadId);

  /// Takes the request back, or declines the other member's.
  Future<void> withdrawEmail(String threadId);

  /// Agrees to the other member's request: the email goes out and the
  /// conversation ends.
  Future<void> agreeEmail(String threadId);
}

/// [ThreadService] over the REST API for the writes and Firestore for the
/// live reads (the security rules let a thread's members read it).
class LiveThreadService implements ThreadService {
  LiveThreadService(this._api, this._auth, {FirebaseFirestore? firestore})
    : _firestore = firestore ?? FirebaseFirestore.instance;

  final ApiClient _api;
  final AuthService _auth;
  final FirebaseFirestore _firestore;

  String get _uid => _auth.currentUser?.uid ?? '';

  @override
  Stream<List<Thread>> threads() {
    final uid = _uid;
    if (uid.isEmpty) return Stream.value(const []);
    return _firestore
        .collection('threads')
        .where('members', arrayContains: uid)
        .orderBy('lastMessageAt', descending: true)
        .snapshots()
        .map(
          (snap) => [
            for (final doc in snap.docs)
              Thread.fromJson({...doc.data(), 'id': doc.id}, uid: uid),
          ],
        );
  }

  @override
  Stream<List<Message>> messages(String threadId, {int limit = 50}) =>
      _firestore
          .collection('threads')
          .doc(threadId)
          .collection('messages')
          .orderBy('createdAt', descending: true)
          .limit(limit)
          .snapshots()
          .map(
            (snap) => [
              for (final doc in snap.docs.reversed)
                ?Message.fromJson({...doc.data(), 'id': doc.id}),
            ],
          );

  @override
  Stream<Thread?> thread(String threadId) {
    final uid = _uid;
    return _firestore
        .collection('threads')
        .doc(threadId)
        .snapshots()
        .map(
          (snap) => snap.exists
              ? Thread.fromJson({...?snap.data(), 'id': snap.id}, uid: uid)
              : null,
        );
  }

  String _thread(String id) => '/threads/${Uri.encodeComponent(id)}';

  Message _message(Map<String, dynamic> json) {
    final message = json['message'];
    final parsed = message is Map<String, dynamic>
        ? Message.fromJson(message)
        : null;
    if (parsed == null) {
      throw ApiException('Unexpected reply from bikes.pizza.');
    }
    return parsed;
  }

  @override
  Future<Thread> open(String username) async {
    final json = await _api.post('/me/threads', body: {'username': username});
    final thread = json['thread'];
    if (thread is! Map<String, dynamic>) {
      throw ApiException('Unexpected reply from bikes.pizza.');
    }
    return Thread.fromJson(thread, uid: _uid);
  }

  @override
  Future<Message> send(String threadId, String text) async => _message(
    await _api.post('${_thread(threadId)}/messages', body: {'text': text}),
  );

  @override
  Future<Message> edit(String threadId, String messageId, String text) async =>
      _message(
        await _api.patch(
          '${_thread(threadId)}/messages/${Uri.encodeComponent(messageId)}',
          body: {'text': text},
        ),
      );

  @override
  Future<void> delete(String threadId, String messageId) => _api.delete(
    '${_thread(threadId)}/messages/${Uri.encodeComponent(messageId)}',
  );

  @override
  Future<void> markSeen(String threadId) =>
      _api.post('${_thread(threadId)}/seen');

  @override
  Future<void> report(String threadId, String reason) =>
      _api.post('${_thread(threadId)}/report', body: {'reason': reason});

  @override
  Future<void> block(String username, {required bool on}) async {
    final path = '/members/${Uri.encodeComponent(username)}/block';
    if (on) {
      await _api.post(path);
    } else {
      await _api.delete(path);
    }
  }

  @override
  Future<void> requestEmail(String threadId) =>
      _api.post('${_thread(threadId)}/email');

  @override
  Future<void> withdrawEmail(String threadId) =>
      _api.delete('${_thread(threadId)}/email');

  @override
  Future<void> agreeEmail(String threadId) =>
      _api.post('${_thread(threadId)}/email/agree');

  @override
  Future<List<BlockedMember>> blocks() async {
    final json = await _api.get('/me/blocks');
    final blocked = json['blocked'];
    return [
      if (blocked is List)
        for (final b in blocked)
          if (b is Map && b['uid'] is String)
            BlockedMember(
              uid: b['uid'] as String,
              username: b['username'] as String? ?? '',
            ),
    ];
  }
}
