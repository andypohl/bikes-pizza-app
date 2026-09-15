import '../account/member_service.dart';
import '../api/api_client.dart';

/// The admin side of the REST API (`docs/api.md`): the submissions review
/// (what https://submissions.bikes.pizza/ does) and user administration
/// (https://admin.bikes.pizza/), for the tablet screens in `lib/admin/`.
/// Every call needs the `admin` claim on a session that passed a second
/// factor; the API answers `permission-denied` otherwise. Failures are
/// [ApiException]s.
abstract class AdminService {
  Future<SubmissionPage> submissions({
    String status = '',
    int limit = 20,
    String? after,
  });

  Future<AdminSubmission> submission(String id);

  /// `publish`, `draft` or `reject` a pending submission.
  Future<ReviewResult> review(String id, String action, {String note = ''});

  Future<QueueInfo> queueInfo(String feed);

  /// Takes a queued submission back to pending.
  Future<void> dequeue(String feed, String id);

  /// Whether the website shows its "Submit a bike or pizza" button.
  Future<bool> submitButton();

  Future<bool> setSubmitButton(bool on);

  Future<UserPage> users({int page = 1, int pageSize = 25});

  Future<AdminUser> user(String uid);

  Future<AdminUser> updateUser(
    String uid, {
    String? username,
    String? email,
    List<String>? newsletters,
  });

  Future<void> deleteUser(String uid);
}

DateTime? _date(Object? value) =>
    value is String ? DateTime.tryParse(value) : null;

String? _string(Object? value) => value is String ? value : null;

/// A member submission as the review list shows it. `kind` is `post` for
/// a new bike or pizza and `edit` for a change to a published post.
class AdminSubmission {
  const AdminSubmission({
    required this.id,
    required this.kind,
    required this.feed,
    required this.title,
    required this.from,
    required this.description,
    required this.status,
    this.createdAt,
    this.submitterEmail,
    this.photoUrl,
    this.thumbUrl,
    this.post,
    this.changes,
    this.safeSearch,
    this.people,
    this.queue,
    this.review,
  });

  final String id;
  final String kind;
  final String feed;
  final String title;
  final String from;
  final String description;
  final String status;
  final DateTime? createdAt;
  final String? submitterEmail;
  final String? photoUrl;
  final String? thumbUrl;

  /// The post an edit is for.
  final EditedPost? post;

  /// What an edit changes: `title`, `story`, `bike`, `pizza` (new values)
  /// and `image` (true for a new photo).
  final Map<String, Object?>? changes;

  final Map<String, String>? safeSearch;
  final PeopleSeen? people;
  final QueueEntry? queue;
  final ReviewRecord? review;

  bool get isEdit => kind == 'edit';
  bool get isPending => status == 'pending';
  bool get isQueued => status == 'queued';

  static const feedLabels = {'pizza': 'Pizza', 'bikes': 'Bike', 'news': 'News'};
  static const statusLabels = {
    'pending': 'Pending',
    'queued': 'Queued',
    'posting': 'Posting',
    'approved': 'Posted',
    'rejected': 'Rejected',
  };
  static const _changeLabels = {
    'title': 'title',
    'story': 'story',
    'image': 'photo',
    'bike': 'bike details',
    'pizza': 'pizza style',
  };

  /// "Bike", or "Edit · Bike" for an edit.
  String get feedLabel =>
      '${isEdit ? 'Edit · ' : ''}${feedLabels[feed] ?? feed}';

  String get statusLabel => statusLabels[status] ?? status;

  /// What an edit changes, as words: "title, photo".
  String get changedFields {
    final changed = [
      for (final entry in (changes ?? const {}).entries)
        if (entry.value != false) _changeLabels[entry.key] ?? entry.key,
    ];
    return changed.isEmpty ? 'nothing' : changed.join(', ');
  }

  /// The photo to show: the new one, or for an edit without one the
  /// post's current photo.
  String? get displayPhotoUrl => photoUrl ?? (isEdit ? post?.imageUrl : null);

  factory AdminSubmission.fromJson(Map<String, dynamic> json) {
    final image = json['image'];
    final post = json['post'];
    final changes = json['changes'];
    final safeSearch = json['safeSearch'];
    final people = json['people'];
    final queue = json['queue'];
    final review = json['review'];
    final submittedBy = json['submittedBy'];
    return AdminSubmission(
      id: json['id'] as String? ?? '',
      kind: json['kind'] as String? ?? 'post',
      feed: json['feed'] as String? ?? '',
      title: json['title'] as String? ?? '',
      from: json['from'] as String? ?? '',
      description: json['description'] as String? ?? '',
      status: json['status'] as String? ?? '',
      createdAt: _date(json['createdAt']),
      submitterEmail: submittedBy is Map ? _string(submittedBy['email']) : null,
      photoUrl: image is Map ? _string(image['photoUrl']) : null,
      thumbUrl: image is Map ? _string(image['thumbUrl']) : null,
      post: post is Map<String, dynamic> ? EditedPost.fromJson(post) : null,
      changes: changes is Map<String, dynamic> ? changes : null,
      safeSearch: safeSearch is Map
          ? {
              for (final e in safeSearch.entries)
                if (e.value is String) e.key as String: e.value as String,
            }
          : null,
      people: people is Map<String, dynamic>
          ? PeopleSeen.fromJson(people)
          : null,
      queue: queue is Map<String, dynamic> ? QueueEntry.fromJson(queue) : null,
      review: review is Map<String, dynamic>
          ? ReviewRecord.fromJson(review)
          : null,
    );
  }
}

/// The published post an edit submission changes.
class EditedPost {
  const EditedPost({
    required this.id,
    required this.title,
    this.url,
    this.imageUrl,
  });

  final String id;
  final String title;
  final String? url;
  final String? imageUrl;

  factory EditedPost.fromJson(Map<String, dynamic> json) => EditedPost(
    id: json['id'] as String? ?? '',
    title: json['title'] as String? ?? '',
    url: _string(json['url']),
    imageUrl: _string(json['imageUrl']),
  );
}

/// What Vision saw in the photo: faces and person-like objects.
class PeopleSeen {
  const PeopleSeen({
    required this.faces,
    required this.faceConfidence,
    required this.persons,
    required this.personScore,
  });

  final int faces;
  final double faceConfidence;
  final int persons;
  final double personScore;

  factory PeopleSeen.fromJson(Map<String, dynamic> json) => PeopleSeen(
    faces: (json['faces'] as num?)?.toInt() ?? 0,
    faceConfidence: (json['faceConfidence'] as num?)?.toDouble() ?? 0,
    persons: (json['persons'] as num?)?.toInt() ?? 0,
    personScore: (json['personScore'] as num?)?.toDouble() ?? 0,
  );

  /// "1 face (0.9) · 2 persons (0.7)", or "none seen".
  String get summary {
    final seen = [
      if (faces > 0) '$faces face${faces == 1 ? '' : 's'} ($faceConfidence)',
      if (persons > 0)
        '$persons person${persons == 1 ? '' : 's'} ($personScore)',
    ];
    return seen.isEmpty ? 'none seen' : seen.join(' · ');
  }
}

class QueueEntry {
  const QueueEntry({this.at, this.byEmail, this.note = '', this.lastError});

  final DateTime? at;
  final String? byEmail;
  final String note;
  final String? lastError;

  factory QueueEntry.fromJson(Map<String, dynamic> json) => QueueEntry(
    at: _date(json['at']),
    byEmail: _string(json['byEmail']) ?? _string(json['by']),
    note: json['note'] as String? ?? '',
    lastError: _string(json['lastError']),
  );
}

class ReviewRecord {
  const ReviewRecord({
    required this.action,
    this.at,
    this.byEmail,
    this.note = '',
    this.postId,
    this.postUrl,
    this.postStatus,
  });

  final String action;
  final DateTime? at;
  final String? byEmail;
  final String note;
  final String? postId;
  final String? postUrl;
  final String? postStatus;

  factory ReviewRecord.fromJson(Map<String, dynamic> json) => ReviewRecord(
    action: json['action'] as String? ?? '',
    at: _date(json['at']),
    byEmail: _string(json['byEmail']) ?? _string(json['by']),
    note: json['note'] as String? ?? '',
    postId: _string(json['postId']),
    postUrl: _string(json['postUrl']),
    postStatus: _string(json['postStatus']),
  );
}

class SubmissionPage {
  const SubmissionPage({required this.items, this.nextCursor});

  final List<AdminSubmission> items;
  final String? nextCursor;

  bool get hasNext => nextCursor != null && nextCursor!.isNotEmpty;

  factory SubmissionPage.fromJson(Map<String, dynamic> json) {
    final items = json['items'];
    return SubmissionPage(
      items: [
        if (items is List)
          for (final i in items.whereType<Map<String, dynamic>>())
            AdminSubmission.fromJson(i),
      ],
      nextCursor: _string(json['nextCursor']),
    );
  }
}

/// A feed's queue: how many wait and when it next posts.
class QueueInfo {
  const QueueInfo({
    required this.feed,
    required this.length,
    this.nextPostAt,
    this.countdown = '',
  });

  final String feed;
  final int length;
  final DateTime? nextPostAt;
  final String countdown;

  factory QueueInfo.fromJson(Map<String, dynamic> json) => QueueInfo(
    feed: json['feed'] as String? ?? '',
    length: (json['length'] as num?)?.toInt() ?? 0,
    nextPostAt: _date(json['nextPostAt']),
    countdown: json['countdown'] as String? ?? '',
  );
}

/// What a review action came to.
class ReviewResult {
  const ReviewResult({
    required this.status,
    this.position,
    this.feed,
    this.countdown,
    this.postUrl,
    this.postId,
    this.postStatus,
  });

  final String status;
  final int? position;
  final String? feed;
  final String? countdown;
  final String? postUrl;
  final String? postId;
  final String? postStatus;

  factory ReviewResult.fromJson(Map<String, dynamic> json) => ReviewResult(
    status: json['status'] as String? ?? '',
    position: (json['position'] as num?)?.toInt(),
    feed: _string(json['feed']),
    countdown: _string(json['countdown']),
    postUrl: _string(json['postUrl']),
    postId: _string(json['postId']),
    postStatus: _string(json['postStatus']),
  );

  /// One line for the snackbar.
  String get message {
    switch (status) {
      case 'queued':
        final feed = AdminSubmission.feedLabels[this.feed] ?? this.feed ?? '';
        return 'Queued at position $position for $feed; next post in $countdown.';
      case 'approved':
        return postStatus == 'draft'
            ? 'Saved as a draft in Sanity.'
            : 'Published: ${postUrl ?? postId ?? ''}';
      case 'rejected':
        return 'Rejected.';
      default:
        return 'Done.';
    }
  }
}

/// One of a member's posts, as the users screen lists them.
class UserPost {
  const UserPost({required this.title, this.publishedAt, this.url});

  final String title;
  final DateTime? publishedAt;
  final String? url;

  factory UserPost.fromJson(Map<String, dynamic> json) => UserPost(
    title: json['title'] as String? ?? '',
    publishedAt: _date(json['publishedAt']),
    url: _string(json['url']),
  );
}

/// A member as the users screen shows them; [newsletters] and [posts] are
/// filled in for one user by [AdminService.user].
class AdminUser {
  const AdminUser({
    required this.uid,
    required this.email,
    this.emailVerified = false,
    this.username = '',
    this.subscribed = false,
    this.providers = const [],
    this.createdAt,
    this.lastSignInAt,
    this.postCount = 0,
    this.latestPost,
    this.newsletters = const [],
    this.posts = const [],
  });

  final String uid;
  final String email;
  final bool emailVerified;
  final String username;
  final bool subscribed;

  /// Sign-in methods as words: `Email`, `Google`, `Apple`.
  final List<String> providers;
  final DateTime? createdAt;
  final DateTime? lastSignInAt;
  final int postCount;
  final UserPost? latestPost;
  final List<Newsletter> newsletters;
  final List<UserPost> posts;

  /// What to call them: the username, else the email, else the uid.
  String get name =>
      username.isNotEmpty ? username : (email.isNotEmpty ? email : uid);

  bool get hasPassword => providers.contains('Email');

  factory AdminUser.fromJson(Map<String, dynamic> json) {
    final providers = json['providers'];
    final latest = json['latestPost'];
    final newsletters = json['newsletters'];
    final posts = json['posts'];
    return AdminUser(
      uid: json['uid'] as String? ?? '',
      email: json['email'] as String? ?? '',
      emailVerified: json['emailVerified'] == true,
      username: json['username'] as String? ?? '',
      subscribed: json['subscribed'] == true,
      providers: [if (providers is List) ...providers.whereType<String>()],
      createdAt: _date(json['createdAt']),
      lastSignInAt: _date(json['lastSignInAt']),
      postCount: (json['postCount'] as num?)?.toInt() ?? 0,
      latestPost: latest is Map<String, dynamic>
          ? UserPost.fromJson(latest)
          : null,
      newsletters: [
        if (newsletters is List)
          for (final n in newsletters.whereType<Map>())
            Newsletter(
              id: n['id'] as String? ?? '',
              name: n['name'] as String? ?? '',
              description: n['description'] as String? ?? '',
              subscribed: n['subscribed'] == true,
            ),
      ],
      posts: [
        if (posts is List)
          for (final p in posts.whereType<Map<String, dynamic>>())
            UserPost.fromJson(p),
      ],
    );
  }
}

class UserPage {
  const UserPage({
    required this.page,
    required this.pages,
    required this.total,
    required this.users,
  });

  final int page;
  final int pages;
  final int total;
  final List<AdminUser> users;

  factory UserPage.fromJson(Map<String, dynamic> json) {
    final users = json['users'];
    return UserPage(
      page: (json['page'] as num?)?.toInt() ?? 1,
      pages: (json['pages'] as num?)?.toInt() ?? 1,
      total: (json['total'] as num?)?.toInt() ?? 0,
      users: [
        if (users is List)
          for (final u in users.whereType<Map<String, dynamic>>())
            AdminUser.fromJson(u),
      ],
    );
  }
}

/// [AdminService] on the REST API.
class ApiAdminService implements AdminService {
  ApiAdminService(this._api);

  final ApiClient _api;

  static String _id(String id) => Uri.encodeComponent(id);

  @override
  Future<SubmissionPage> submissions({
    String status = '',
    int limit = 20,
    String? after,
  }) async => SubmissionPage.fromJson(
    await _api.get(
      '/submissions',
      query: {
        if (status.isNotEmpty) 'status': status,
        'limit': '$limit',
        if (after != null && after.isNotEmpty) 'after': after,
      },
    ),
  );

  @override
  Future<AdminSubmission> submission(String id) async =>
      AdminSubmission.fromJson(await _api.get('/submissions/${_id(id)}'));

  @override
  Future<ReviewResult> review(
    String id,
    String action, {
    String note = '',
  }) async => ReviewResult.fromJson(
    await _api.post(
      '/submissions/${_id(id)}/review',
      body: {'action': action, 'note': note},
    ),
  );

  @override
  Future<QueueInfo> queueInfo(String feed) async =>
      QueueInfo.fromJson(await _api.get('/queue/${_id(feed)}/countdown-time'));

  @override
  Future<void> dequeue(String feed, String id) =>
      _api.post('/queue/${_id(feed)}/remove', body: {'id': id});

  @override
  Future<bool> submitButton() async =>
      (await _api.get('/site/settings'))['submitButton'] == true;

  @override
  Future<bool> setSubmitButton(bool on) async =>
      (await _api.post(
        '/site/settings',
        body: {'submitButton': on},
      ))['submitButton'] ==
      true;

  @override
  Future<UserPage> users({int page = 1, int pageSize = 25}) async =>
      UserPage.fromJson(
        await _api.get(
          '/admin/users',
          query: {'page': '$page', 'pageSize': '$pageSize'},
        ),
      );

  @override
  Future<AdminUser> user(String uid) async =>
      AdminUser.fromJson(await _api.get('/admin/users/${_id(uid)}'));

  @override
  Future<AdminUser> updateUser(
    String uid, {
    String? username,
    String? email,
    List<String>? newsletters,
  }) async => AdminUser.fromJson(
    await _api.patch(
      '/admin/users/${_id(uid)}',
      body: {
        'username': ?username,
        'email': ?email,
        'newsletters': ?newsletters,
      },
    ),
  );

  @override
  Future<void> deleteUser(String uid) =>
      _api.delete('/admin/users/${_id(uid)}');
}
