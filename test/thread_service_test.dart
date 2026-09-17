import 'package:bikes_pizza/messages/thread_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('a thread reads from a Firestore document, for either member', () {
    final doc = {
      'id': 'u1_u2',
      'members': ['u1', 'u2'],
      'usernames': {'u1': 'ada_bikes', 'u2': 'bob'},
      'lastMessageAt': '2026-09-10T10:00:00.000Z',
      'last': {
        'uid': 'u2',
        'text': 'See you',
        'at': '2026-09-10T10:00:00.000Z',
      },
      'unread': {'u1': 2, 'u2': 0},
      'blockedBy': ['u2'],
      'conversation': 3,
    };
    final mine = Thread.fromJson(doc, uid: 'u1');
    expect(mine.otherUid, 'u2');
    expect(mine.otherUsername, 'bob');
    expect(mine.lastText, 'See you');
    expect(mine.lastAt, DateTime.utc(2026, 9, 10, 10));
    expect(mine.unread, 2);
    expect(mine.blocked, isTrue);
    expect(mine.blockedByMe, isFalse);
    expect(mine.conversation, 3);
    final theirs = Thread.fromJson(doc, uid: 'u2');
    expect(theirs.otherUsername, 'ada_bikes');
    expect(theirs.unread, 0);
    expect(theirs.blockedByMe, isTrue);
    final gone = Thread.fromJson({
      'id': 'x',
      'members': ['u1'],
      'gone': true,
    }, uid: 'u1');
    expect(gone.gone, isTrue);
    expect(gone.otherUid, isNull);
  });

  test('a thread reads from the API shape too', () {
    final thread = Thread.fromJson({
      'id': 'u1_u2',
      'other': {'uid': 'u2', 'username': 'bob'},
      'unread': 1,
      'blocked': true,
      'blockedByMe': true,
      'last': null,
    }, uid: 'u1');
    expect(thread.otherUsername, 'bob');
    expect(thread.unread, 1);
    expect(thread.blockedByMe, isTrue);
    expect(thread.lastText, '');
  });

  test('messages and events parse from Firestore and the API', () {
    final message = Message.fromJson({
      'id': 'm1',
      'kind': 'message',
      'uid': 'u1',
      'text': 'hi',
      'html': '<p>hi</p>',
      'createdAt': '2026-09-10T10:00:00.000Z',
      'editedAt': '2026-09-10T10:01:00.000Z',
      'deletedAt': null,
      'conversation': 2,
    })!;
    expect(message.isEvent, isFalse);
    expect(message.at, DateTime.utc(2026, 9, 10, 10));
    expect(message.editedAt, DateTime.utc(2026, 9, 10, 10, 1));
    expect(message.conversation, 2);
    expect(
      message.editableAt(
        DateTime.utc(2026, 9, 10, 10, 4),
        const Duration(minutes: 5),
      ),
      isTrue,
    );
    final deleted = Message.fromJson({
      'id': 'm2',
      'uid': 'u1',
      'text': 'secret',
      'html': '<p>secret</p>',
      'createdAt': '2026-09-10T10:00:00.000Z',
      'deletedAt': '2026-09-10T11:00:00.000Z',
    })!;
    expect(deleted.deleted, isTrue);
    expect(deleted.text, '');
    expect(deleted.html, '');
    final apiDeleted = Message.fromJson({
      'id': 'm3',
      'uid': 'u1',
      'createdAt': '2026-09-10T10:00:00.000Z',
      'deleted': true,
    })!;
    expect(apiDeleted.deleted, isTrue);
    final event = Message.fromJson({
      'id': 'e1',
      'kind': 'event',
      'event': 'blocked',
      'by': 'u2',
      'at': '2026-09-10T12:00:00.000Z',
      'createdAt': '2026-09-10T12:00:00.000Z',
    })!;
    expect(event.isEvent, isTrue);
    expect(event.event, 'blocked');
    expect(event.at, DateTime.utc(2026, 9, 10, 12));
    expect(
      event.editableAt(
        DateTime.utc(2026, 9, 10, 12),
        const Duration(minutes: 5),
      ),
      isFalse,
    );
    expect(Message.fromJson({'id': 'x'}), isNull);
    expect(Message.fromJson({'createdAt': '2026-09-10T10:00:00.000Z'}), isNull);
  });
}
