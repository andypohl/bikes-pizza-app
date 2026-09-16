import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:bikes_pizza/account/member_service.dart';
import 'package:bikes_pizza/admin/admin_service.dart';
import 'package:bikes_pizza/admin/submissions_screen.dart';
import 'package:bikes_pizza/admin/users_screen.dart';
import 'package:bikes_pizza/api/api_client.dart';
import 'package:bikes_pizza/app_settings.dart';
import 'package:bikes_pizza/auth/auth_service.dart';
import 'package:bikes_pizza/auth/passkey_service.dart';
import 'package:bikes_pizza/data/post_repository.dart';
import 'package:bikes_pizza/main.dart';
import 'package:bikes_pizza/models/post.dart';
import 'package:bikes_pizza/models/post_feed.dart';
import 'package:bikes_pizza/posts/post_editor.dart';
import 'package:bikes_pizza/screens/edit_post_screen.dart';
import 'package:bikes_pizza/screens/news_screen.dart';
import 'package:bikes_pizza/screens/post_detail_screen.dart';
import 'package:bikes_pizza/store/cart.dart';
import 'package:bikes_pizza/store/product.dart';
import 'package:bikes_pizza/store/store_repository.dart';
import 'package:bikes_pizza/submissions/photo_picker.dart';
import 'package:bikes_pizza/submissions/submission_service.dart';
import 'package:bikes_pizza/widgets/post_article.dart';
import 'package:bikes_pizza/widgets/post_tile.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// In-memory repository so widget tests never touch the network.
class FakePostRepository implements PostRepository {
  FakePostRepository(this.byFeed, {this.newsPages});

  final Map<PostFeed, List<Post>> byFeed;

  /// When set, the news feed is served page by page from this list.
  final List<List<Post>>? newsPages;
  final requestedFeeds = <PostFeed>[];
  final requestedUids = <String>[];
  final requestedNewsPages = <int>[];

  @override
  Future<PostPage> fetchPosts(
    PostFeed feed, {
    int page = 1,
    String? uid,
  }) async {
    requestedFeeds.add(feed);
    if (uid != null) requestedUids.add(uid);
    final pages = newsPages;
    if (feed == PostFeed.news && pages != null && uid == null) {
      requestedNewsPages.add(page);
      return PostPage(
        posts: page <= pages.length ? pages[page - 1] : [],
        hasMore: page < pages.length,
      );
    }
    final posts = uid == null
        ? byFeed[feed] ?? []
        : [
            for (final list in byFeed.values)
              for (final p in list)
                if (p.isBy(uid)) p,
          ];
    return PostPage(posts: page == 1 ? posts : [], hasMore: false);
  }
}

/// In-memory auth that accepts one known credential pair.
class FakeAuthService implements AuthService {
  final _controller = StreamController<AppUser?>.broadcast();
  AppUser? _user;

  @override
  AppUser? get currentUser => _user;

  @override
  Stream<AppUser?> get userChanges => _controller.stream;

  void _set(AppUser? user) {
    _user = user;
    _controller.add(user);
  }

  /// When set, sign-ins are parked until [resolveSecondFactor].
  bool requireSecondFactor = false;
  AppUser? _parked;
  int cancelledSecondFactors = 0;

  @override
  Future<void> signIn({required String email, required String password}) async {
    if (password != 'correct-horse') {
      throw AuthException(
        'Email or password is incorrect.',
        badCredentials: true,
      );
    }
    _complete(
      AppUser(uid: 'u1', email: email, providerIds: const ['password']),
    );
  }

  /// Whether a parked sign-in reports the address it was for; providers
  /// do not always name one.
  bool secondFactorKnowsEmail = true;

  /// Signs [user] in, or parks the sign-in behind the second factor.
  void _complete(AppUser user) {
    if (requireSecondFactor) {
      _parked = user;
      throw SecondFactorRequired(
        email: secondFactorKnowsEmail ? user.email : null,
      );
    }
    _set(user);
  }

  @override
  Future<void> resolveSecondFactor(String code) async {
    final user = _parked;
    if (user == null) throw AuthException('Sign in first.');
    if (code != '123456') {
      throw AuthException(
        'That code is not right. Try the current one from your app.',
      );
    }
    _parked = null;
    _set(user);
  }

  @override
  void cancelSecondFactor() {
    _parked = null;
    cancelledSecondFactors++;
  }

  final factors = <SecondFactor>[];
  bool enrolling = false;

  @override
  Future<List<SecondFactor>> enrolledFactors() async => List.of(factors);

  @override
  Future<TotpEnrollment> startTotpEnrollment() async {
    enrolling = true;
    return const TotpEnrollment(
      secretKey: 'ABCDEFGHIJKLMNOP',
      qrCodeUrl: 'otpauth://totp/bikes.pizza:member?secret=ABCDEFGHIJKLMNOP',
    );
  }

  @override
  Future<void> finishTotpEnrollment(String code) async {
    if (!enrolling) throw AuthException('Start two-factor setup first.');
    if (code != '123456') {
      throw AuthException(
        'That code is not right. Try the current one from your app.',
      );
    }
    enrolling = false;
    factors.add(const SecondFactor(id: 'f1', name: 'Authenticator app'));
  }

  @override
  Future<void> removeSecondFactor(SecondFactor factor) async {
    factors.removeWhere((f) => f.id == factor.id);
  }

  bool admin = false;

  @override
  Future<bool> isAdmin() async => admin;

  @override
  Future<String?> idToken() async =>
      _user == null ? null : 'token-${_user!.uid}';

  @override
  Future<void> createAccount({
    required String email,
    required String password,
  }) async =>
      _set(AppUser(uid: 'u2', email: email, providerIds: const ['password']));

  final resetEmails = <String>[];

  @override
  Future<void> sendPasswordReset(String email) async => resetEmails.add(email);

  int passwordChanges = 0;

  @override
  Future<void> changePassword({
    required String current,
    required String next,
  }) async {
    if (current != 'correct-horse') {
      throw AuthException(
        'Email or password is incorrect.',
        badCredentials: true,
      );
    }
    passwordChanges++;
  }

  int verificationEmails = 0;

  @override
  Future<void> sendEmailVerification() async => verificationEmails++;

  /// Simulates the user having clicked the verification link.
  @override
  Future<void> reloadUser() async {
    final user = _user;
    if (user != null) {
      _set(
        AppUser(
          uid: user.uid,
          email: user.email,
          emailVerified: true,
          providerIds: user.providerIds,
        ),
      );
    }
  }

  int googleCalls = 0;
  int appleCalls = 0;
  bool cancelProviders = false;

  @override
  Future<void> signInWithGoogle() async {
    googleCalls++;
    if (cancelProviders) throw AuthException.cancelled();
    _complete(
      const AppUser(
        uid: 'g1',
        email: 'g@example.com',
        emailVerified: true,
        providerIds: ['google.com'],
      ),
    );
  }

  @override
  Future<void> signInWithApple() async {
    appleCalls++;
    if (cancelProviders) throw AuthException.cancelled();
    _set(
      const AppUser(
        uid: 'a1',
        email: 'a@example.com',
        emailVerified: true,
        providerIds: ['apple.com'],
      ),
    );
  }

  @override
  Future<void> signOut() async => _set(null);
}

/// In-memory member profile; records updates and deletions.
class FakeMemberService implements MemberService {
  bool fail = false;
  bool failDelete = false;
  bool expireSession = false;
  int loads = 0;
  int deletions = 0;
  final updates = <({String? username, List<String>? newsletters})>[];
  MemberProfile profile = const MemberProfile(
    email: 'member@example.com',
    username: 'oldname',
    newsletters: [
      Newsletter(
        id: 'weekly',
        name: 'Weekly',
        description: 'Every Friday',
        subscribed: true,
      ),
    ],
  );

  @override
  Future<MemberProfile> load() async {
    loads++;
    if (expireSession) {
      throw MemberException('Session gone.', sessionExpired: true);
    }
    if (fail) throw MemberException('Could not reach your account right now.');
    return profile;
  }

  @override
  Future<MemberProfile> update({
    String? username,
    List<String>? newsletters,
  }) async {
    if (username == 'taken') throw MemberException('That username is taken.');
    updates.add((username: username, newsletters: newsletters));
    profile = MemberProfile(
      email: profile.email,
      username: username ?? profile.username,
      newsletters: [
        for (final n in profile.newsletters)
          Newsletter(
            id: n.id,
            name: n.name,
            description: n.description,
            subscribed: newsletters?.contains(n.id) ?? n.subscribed,
          ),
      ],
    );
    return profile;
  }

  @override
  Future<void> deleteAccount() async {
    if (failDelete) {
      throw MemberException('Could not delete your account right now.');
    }
    deletions++;
  }
}

/// In-memory passkeys; signing in with one signs the fake auth in.
class FakePasskeyService implements PasskeyService {
  FakePasskeyService({this.supported = true});

  bool supported;
  FakeAuthService? auth;
  bool failSignIn = false;
  bool cancel = false;
  int signIns = 0;
  List<Passkey> passkeys = [
    Passkey(
      id: 'k1',
      name: 'Safari on Mac',
      createdAt: DateTime(2026, 8, 1),
      lastUsedAt: DateTime(2026, 9, 1),
    ),
  ];

  @override
  Future<bool> get available async => supported;

  @override
  Future<List<Passkey>> list() async => List.of(passkeys);

  @override
  Future<List<Passkey>> add() async {
    if (cancel) throw PasskeyException.cancelled();
    passkeys = [
      Passkey(id: 'k${passkeys.length + 1}', name: 'The app on iPhone or iPad'),
      ...passkeys,
    ];
    return List.of(passkeys);
  }

  @override
  Future<List<Passkey>> remove(String id) async {
    passkeys = [
      for (final p in passkeys)
        if (p.id != id) p,
    ];
    return List.of(passkeys);
  }

  /// Accounts this fake device holds a passkey for; null means any.
  Set<String>? onDevice;

  /// The email the last sign-in was scoped to.
  String? scopedTo;

  @override
  Future<bool> signIn({String? email, bool onlyIfPresent = false}) async {
    scopedTo = email;
    if (email != null && onDevice != null && !onDevice!.contains(email)) {
      // As the server and the platform answer: nothing to try here.
      if (onlyIfPresent || onDevice!.isEmpty) return false;
      throw PasskeyException('This device has no passkey for bikes.pizza yet.');
    }
    if (cancel) throw PasskeyException.cancelled();
    if (failSignIn) {
      throw PasskeyException('This device has no passkey for bikes.pizza yet.');
    }
    signIns++;
    auth?._set(
      AppUser(
        uid: 'u9',
        email: email ?? 'passkey@example.com',
        emailVerified: true,
        providerIds: const ['password'],
      ),
    );
    return true;
  }
}

/// Records submissions; can be told to fail.
class FakeSubmissionService implements SubmissionService {
  final submissions = <Submission>[];
  bool fail = false;
  bool expireSession = false;

  @override
  Future<SubmissionResult> submit(Submission submission) async {
    if (expireSession) {
      throw SubmissionException('Session gone.', sessionExpired: true);
    }
    if (fail) throw SubmissionException('Could not send your submission.');
    submissions.add(submission);
    return const SubmissionResult(submissionId: 's1', notified: true);
  }
}

/// In-memory post editor: serves [posts] for editing, records saves, and
/// answers them as a member's (pending review) or an administrator's
/// (applied) according to [applies].
class FakePostEditor implements PostEditor {
  final posts = <String, EditablePost>{};
  List<PostSummary> mine = [];
  final saved = <(String, PostEdit)>[];
  bool applies = false;
  bool fail = false;

  @override
  Future<List<PostSummary>> myPosts() async {
    if (fail) throw ApiException('Could not reach bikes.pizza.');
    return mine;
  }

  @override
  Future<EditablePost> load(String id) async {
    final post = posts[id];
    if (post == null) {
      throw ApiException('That post no longer exists.', code: 'not-found');
    }
    return post;
  }

  @override
  Future<EditOutcome> save(String id, PostEdit edit) async {
    if (fail) throw ApiException('Could not save that.');
    saved.add((id, edit));
    if (!applies) return const EditOutcome.pending('s1');
    final was = posts[id]!;
    final now = EditablePost(
      id: was.id,
      title: edit.title ?? was.title,
      feed: was.feed,
      url: was.url,
      publishedAt: was.publishedAt,
      story: edit.story ?? was.story,
      images: edit.pictures == null
          ? was.images
          : [
              for (final picture in edit.pictures!)
                switch (picture) {
                  KeptPicture(:final image) => image,
                  NewPicture() => _image('https://example.com/new/'),
                },
            ],
      bike: edit.bike ?? was.bike,
      pizza: edit.pizza ?? was.pizza,
    );
    posts[id] = now;
    return EditOutcome.applied(now);
  }
}

/// In-memory admin API: a few submissions and users; records reviews,
/// queue changes, updates and deletions. [deny] answers every call as the
/// API does for an admin session without a second factor.
class FakeAdminService implements AdminService {
  bool deny = false;
  bool submitButtonOn = true;
  final reviews = <(String, String, String)>[];
  final dequeued = <String>[];
  final updates = <(String, String?, String?, List<String>?)>[];
  final deleted = <String>[];
  final listedStatuses = <String>[];

  final items = <AdminSubmission>[
    const AdminSubmission(
      id: 's1',
      kind: 'post',
      feed: 'bikes',
      title: 'Trek 970',
      from: 'Ada',
      description: 'A fine bike.',
      status: 'pending',
      submitterEmail: 'ada@example.com',
      pictures: [
        SubmissionPicture(
          kept: false,
          thumbUrl: 'https://f/t1',
          photoUrl: 'https://f/p1',
          safeSearch: {'adult': 'VERY_UNLIKELY', 'racy': 'UNLIKELY'},
          people: PeopleSeen(
            faces: 0,
            faceConfidence: 0,
            persons: 0,
            personScore: 0,
          ),
        ),
        SubmissionPicture(kept: true, thumbUrl: 'https://f/t2'),
      ],
    ),
    const AdminSubmission(
      id: 'e1',
      kind: 'edit',
      feed: 'pizza',
      title: 'Detroit slice, renamed',
      from: 'Bob',
      description: 'Story',
      status: 'pending',
      post: EditedPost(id: 'p1', title: 'Detroit slice'),
      changes: {'title': 'Detroit slice, renamed', 'image': false},
    ),
    const AdminSubmission(
      id: 's2',
      kind: 'post',
      feed: 'pizza',
      title: 'Grandma pie',
      from: 'Cy',
      description: '',
      status: 'queued',
      queue: QueueEntry(byEmail: 'admin@example.com', note: 'yum'),
    ),
  ];

  final accounts = <AdminUser>[
    const AdminUser(
      uid: 'u1',
      email: 'ada@example.com',
      emailVerified: true,
      username: 'ada_bikes',
      subscribed: true,
      providers: ['Email'],
      postCount: 2,
      latestPost: UserPost(title: 'Trek 970'),
      newsletters: [
        Newsletter(id: 'news', name: 'Newsletter', subscribed: true),
      ],
      posts: [
        UserPost(title: 'Trek 970'),
        UserPost(title: 'Old Trek'),
      ],
    ),
    const AdminUser(
      uid: 'u2',
      email: 'bob@example.com',
      providers: ['Google'],
      newsletters: [Newsletter(id: 'news', name: 'Newsletter')],
    ),
  ];

  void _check() {
    if (deny) {
      throw ApiException(
        'Two-factor authentication is required for this.',
        code: 'permission-denied',
      );
    }
  }

  @override
  Future<SubmissionPage> submissions({
    String status = '',
    int limit = 20,
    String? after,
  }) async {
    _check();
    listedStatuses.add(status);
    return SubmissionPage(
      items: [
        for (final s in items)
          if (status.isEmpty || s.status == status) s,
      ],
    );
  }

  @override
  Future<AdminSubmission> submission(String id) async =>
      items.firstWhere((s) => s.id == id);

  @override
  Future<ReviewResult> review(
    String id,
    String action, {
    String note = '',
  }) async {
    _check();
    reviews.add((id, action, note));
    return switch (action) {
      'publish' => const ReviewResult(
        status: 'queued',
        position: 1,
        feed: 'bikes',
        countdown: '2h 0m 0s',
      ),
      _ => const ReviewResult(status: 'rejected'),
    };
  }

  @override
  Future<QueueInfo> queueInfo(String feed) async {
    _check();
    return QueueInfo(
      feed: feed,
      length: feed == 'bikes' ? 2 : 0,
      countdown: '1h 5m 0s',
    );
  }

  @override
  Future<void> dequeue(String feed, String id) async {
    _check();
    dequeued.add(id);
  }

  @override
  Future<bool> submitButton() async {
    _check();
    return submitButtonOn;
  }

  @override
  Future<bool> setSubmitButton(bool on) async {
    _check();
    return submitButtonOn = on;
  }

  @override
  Future<UserPage> users({int page = 1, int pageSize = 25}) async {
    _check();
    return UserPage(page: page, pages: 3, total: 60, users: accounts);
  }

  @override
  Future<AdminUser> user(String uid) async {
    _check();
    return accounts.firstWhere((u) => u.uid == uid);
  }

  @override
  Future<AdminUser> updateUser(
    String uid, {
    String? username,
    String? email,
    List<String>? newsletters,
  }) async {
    _check();
    updates.add((uid, username, email, newsletters));
    final was = accounts.firstWhere((u) => u.uid == uid);
    return AdminUser(
      uid: uid,
      email: email ?? was.email,
      username: username ?? was.username,
      providers: was.providers,
      newsletters: [
        for (final n in was.newsletters)
          Newsletter(
            id: n.id,
            name: n.name,
            subscribed: newsletters?.contains(n.id) ?? n.subscribed,
          ),
      ],
      posts: was.posts,
    );
  }

  @override
  Future<void> deleteUser(String uid) async {
    _check();
    deleted.add(uid);
  }
}

/// Returns a tiny PNG, or nothing when [cancel] is set.
class FakePhotoPicker implements PhotoPicker {
  bool cancel = false;
  final sources = <PhotoSource>[];

  // 1x1 transparent PNG.
  static final png = base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  );

  @override
  Future<SubmissionPhoto?> pick(PhotoSource source) async {
    sources.add(source);
    if (cancel) return null;
    return SubmissionPhoto(
      bytes: png,
      contentType: 'image/png',
      filename: 'photo.png',
    );
  }
}

/// In-memory store with two products; records checkout requests.
class FakeStoreRepository implements StoreRepository {
  /// Each checkout as "variant x quantity" lines, e.g. `v-m x2`.
  final checkouts = <String>[];
  String? lastEmail;
  bool empty = false;

  static const _usd = Money(amount: 20, currencyCode: 'USD');

  static const products = [
    Product(
      id: 'p1',
      title: 'Pizza Predator Tee',
      handle: 'tee',
      description: 'Soft cotton.',
      category: 'Apparel',
      price: _usd,
      availableForSale: true,
      variants: [
        ProductVariant(
          id: 'v-s',
          numericId: 1,
          title: 'S',
          price: _usd,
          availableForSale: true,
        ),
        ProductVariant(
          id: 'v-m',
          numericId: 2,
          title: 'M',
          price: _usd,
          availableForSale: true,
        ),
      ],
    ),
    Product(
      id: 'p2',
      title: 'Sticker Pack',
      handle: 'stickers',
      description: '',
      category: 'Stickers',
      price: Money(amount: 5, currencyCode: 'USD'),
      availableForSale: false,
      variants: [
        ProductVariant(
          id: 'v-st',
          numericId: 3,
          title: 'Default Title',
          price: Money(amount: 5, currencyCode: 'USD'),
          availableForSale: false,
        ),
      ],
    ),
  ];

  @override
  Future<List<Product>> fetchProducts() async => empty ? const [] : products;

  @override
  Future<Uri> checkout(List<CartItem> items, {String? email}) async {
    checkouts.add(items.map((i) => '${i.variantId} x${i.quantity}').join(', '));
    lastEmail = email;
    return Uri.parse('https://example.myshopify.com/checkouts/1');
  }
}

Post _post(
  String title,
  DateTime date, {
  PostCredit? credit,
  BikeDetails? bike,
  PizzaDetails? pizza,
  List<PostImage> images = const [],
}) => Post(
  id: title,
  images: images,
  feed: bike != null
      ? 'bikes'
      : pizza != null
      ? 'pizza'
      : 'news',
  title: title,
  url: 'https://example.com/$title/',
  publishedAt: date,
  html: '<p>$title body</p>',
  credit: credit,
  bike: bike,
  pizza: pizza,
);

// The Google sign-in of the fake auth service is this member.
const _ada = PostCredit(uid: 'g1', username: 'ada_bikes');

/// A 16:9 photo with renditions at [base], as the functions would record
/// it. (The news feed test's scroll distances assume this height.)
PostImage _image(String base) => PostImage(
  base: base,
  version: base,
  width: 1600,
  height: 900,
  sizes: const [400, 800],
);

EditablePost _editable(
  String id, {
  String title = 'Newest post',
  String feed = 'bikes',
  String story = 'Newest post body',
  bool formatted = false,
  String? pendingEditId,
  BikeDetails? bike = const BikeDetails(brand: 'GT', year: '1990s'),
  List<PostImage> images = const [],
}) => EditablePost(
  id: id,
  images: images,
  title: title,
  feed: feed,
  url: 'https://example.com/$title/',
  publishedAt: DateTime(2025, 4, 12),
  story: story,
  storyHasFormatting: formatted,
  pendingEditId: pendingEditId,
  bike: feed == 'bikes' ? bike : null,
  pizza: feed == 'pizza' ? const PizzaDetails(style: 'detroit') : null,
);

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  late FakeAuthService auth;
  FakeStoreRepository? store;
  Cart cart = Cart();
  FakeMemberService? members;
  FakePasskeyService? passkeys;
  late FakeSubmissionService submissions;
  late FakePhotoPicker photos;
  late FakePostEditor editor;
  late FakeAdminService admin;

  setUp(() {
    PackageInfo.setMockInitialValues(
      appName: 'bikes.pizza',
      packageName: 'com.pizzapredator.bikes_pizza',
      version: '1.0.0',
      buildNumber: '1',
      buildSignature: '',
    );
    store = null;
    cart = Cart();
    members = null;
    passkeys = null;
    submissions = FakeSubmissionService();
    photos = FakePhotoPicker();
    admin = FakeAdminService();
    editor = FakePostEditor()
      ..posts['Newest post'] = _editable('Newest post')
      ..posts['Older post'] = _editable(
        'Older post',
        title: 'Older post',
        story: 'Older post body',
      );
  });

  /// Scrolls the account screen's list until [finder] is on screen; the
  /// list is lazy, so widgets below the fold are not built until then.
  Future<void> scrollTo(WidgetTester tester, Finder finder) async {
    await tester.scrollUntilVisible(
      finder,
      120,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
  }

  /// Sizes the test surface: a portrait tablet by default (the All tab is
  /// present and posts open on their own screen), or a phone, or a
  /// landscape tablet (posts open beside the list).
  void useSize(WidgetTester tester, Size logical) {
    tester.view.physicalSize = logical * tester.view.devicePixelRatio;
    addTearDown(tester.view.resetPhysicalSize);
  }

  Future<FakePostRepository> pumpApp(
    WidgetTester tester, {
    List<Post>? news,
    List<List<Post>>? newsPages,
    Size size = const Size(800, 1200),
  }) async {
    useSize(tester, size);
    auth = FakeAuthService();
    passkeys?.auth = auth;
    final repo = FakePostRepository(newsPages: newsPages, {
      PostFeed.all: [
        _post('Newest post', DateTime(2025, 4, 12), credit: _ada),
        _post('Older post', DateTime(2025, 3, 3)),
      ],
      PostFeed.news: news ?? [_post('Older post', DateTime(2025, 3, 3))],
      PostFeed.pizza: [
        _post(
          'Detroit style',
          DateTime(2025, 2, 1),
          pizza: const PizzaDetails(style: 'detroit'),
        ),
      ],
      PostFeed.bikes: [
        _post(
          '1992 GT Outpost',
          DateTime(2025, 1, 5),
          bike: const BikeDetails(
            brand: 'GT',
            year: '1990s',
            color: 'orange',
            type: 'mtb',
          ),
        ),
      ],
    });
    await tester.pumpWidget(
      BikesPizzaApp(
        settings: AppSettings(),
        repository: repo,
        auth: auth,
        store: store ??= FakeStoreRepository(),
        cart: cart,
        members: members,
        passkeys: passkeys,
        submissions: submissions,
        photos: photos,
        editor: editor,
        admin: admin,
      ),
    );
    await tester.pumpAndSettle();
    return repo;
  }

  testWidgets('shows six bottom navigation destinations, All first', (
    tester,
  ) async {
    await pumpApp(tester);

    expect(find.byType(NavigationBar), findsOneWidget);
    for (final label in [
      'All',
      'News',
      'Pizza',
      'Bikes',
      'Store',
      'Settings',
    ]) {
      expect(
        find.descendant(
          of: find.byType(NavigationBar),
          matching: find.text(label),
        ),
        findsOneWidget,
      );
    }
    Finder inBar(String label) => find
        .descendant(of: find.byType(NavigationBar), matching: find.text(label))
        .first;
    expect(
      tester.getTopLeft(inBar('All')).dx,
      lessThan(tester.getTopLeft(inBar('News')).dx),
    );
  });

  const phone = Size(390, 844);
  const landscapeTablet = Size(1200, 800);

  testWidgets('phones leave out the All tab and start on News', (tester) async {
    await pumpApp(tester, size: phone);

    Finder inBar(String label) => find.descendant(
      of: find.byType(NavigationBar),
      matching: find.text(label),
    );
    expect(inBar('All'), findsNothing);
    for (final label in ['News', 'Pizza', 'Bikes', 'Store', 'Settings']) {
      expect(inBar(label), findsOneWidget);
    }
    // News is selected, showing its newest article in full.
    expect(find.text('Older post'), findsOneWidget);
    expect(find.byType(PostTile), findsNothing);
  });

  testWidgets('News lists the articles in full, newest first', (tester) async {
    await pumpApp(
      tester,
      size: phone,
      news: [
        _post('Store opens', DateTime(2026, 9, 1)),
        _post('Hello world', DateTime(2026, 8, 1)),
      ],
    );

    expect(find.text('Store opens'), findsOneWidget);
    expect(find.text('Hello world'), findsOneWidget);
    expect(find.byType(PostArticle), findsNWidgets(2));
    expect(
      tester.getTopLeft(find.text('Store opens')).dy,
      lessThan(tester.getTopLeft(find.text('Hello world')).dy),
    );
    expect(find.byType(PostTile), findsNothing);
  });

  testWidgets('News keeps a window of pages while scrolling', (tester) async {
    // Twelve one-article pages, each tall enough to need scrolling, read
    // through a window of three pages. The feed's "more" spinner never
    // settles, so the test pumps fixed durations instead of settling.
    Post article(int n) => Post(
      id: 'a$n',
      feed: 'news',
      title: 'Article $n',
      url: '',
      publishedAt: DateTime(2026, 1, 13 - n),
      html: '<p>${List.filled(120, 'word').join(' ')}</p>',
      image: _image('https://example.com/o/posts%2Fa$n%2Fv%2F'),
    );
    final pages = [
      for (var n = 1; n <= 12; n++) [article(n)],
    ];
    final repo = await pumpApp(tester, size: phone, newsPages: pages);
    await tester.pumpWidget(
      MaterialApp(home: NewsScreen(repository: repo, maxPages: 3)),
    );
    await tester.pump(const Duration(seconds: 1));
    final list = find.byType(Scrollable).first;
    Future<void> settle() async {
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 300));
      }
    }

    Future<void> scrollTo(String title, double delta) async {
      await tester.scrollUntilVisible(
        find.text(title),
        delta,
        scrollable: list,
        maxScrolls: 80,
      );
      await settle();
    }

    expect(find.text('Article 1'), findsOneWidget);

    // Going down loads page after page; once the window is full the
    // earliest page is dropped each time. (The list only builds what is
    // near the screen, so the window is checked through the requests:
    // a dropped page has to be fetched again on the way back up.)
    await scrollTo('Article 4', 600);
    expect(repo.requestedNewsPages, containsAll([1, 2, 3, 4]));
    final deepest = repo.requestedNewsPages.reduce(max);
    expect(find.text('Article $deepest'), findsOneWidget);

    repo.requestedNewsPages.clear();
    await scrollTo('Article ${deepest - 2}', -600);
    // A short drag, not past the top: that would be a pull to refresh.
    await tester.drag(list, const Offset(0, 300));
    await settle();
    expect(repo.requestedNewsPages, contains(deepest - 3));
    await scrollTo('Article ${deepest - 3}', -600);
    expect(find.text('Article ${deepest - 3}'), findsOneWidget);
  });

  testWidgets('landscape tablets open a post beside the list', (tester) async {
    await pumpApp(tester, size: landscapeTablet);

    await tester.tap(find.text('Pizza'));
    await tester.pumpAndSettle();
    expect(find.text('Choose a post to read it here.'), findsOneWidget);

    await tester.tap(find.text('Detroit style'));
    await tester.pumpAndSettle();
    // No screen was pushed: the list is still there, the post beside it.
    expect(find.byType(PostDetailScreen), findsNothing);
    expect(find.byType(PostTile), findsOneWidget);
    expect(find.byKey(const Key('post-pane')), findsOneWidget);
    expect(find.byKey(const Key('post-details')), findsOneWidget);
    expect(find.text('Detroit style'), findsNWidgets(2)); // row and article

    await tester.tap(find.byKey(const Key('close-post')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('post-pane')), findsNothing);
    expect(find.text('Choose a post to read it here.'), findsOneWidget);
    expect(find.byType(PostTile), findsOneWidget);
  });

  testWidgets('portrait tablets open a post on its own screen', (tester) async {
    await pumpApp(tester, size: const Size(800, 1200));

    await tester.tap(find.text('Pizza'));
    await tester.pumpAndSettle();
    expect(find.text('Choose a post to read it here.'), findsNothing);

    await tester.tap(find.text('Detroit style'));
    await tester.pumpAndSettle();
    expect(find.byType(PostDetailScreen), findsOneWidget);
    expect(find.byKey(const Key('post-pane')), findsNothing);
  });

  testWidgets('All tab lists every post with thumbnails', (tester) async {
    await pumpApp(tester);

    expect(find.text('bikes.pizza'), findsOneWidget);
    expect(find.byType(PostTile), findsNWidgets(2));
    expect(find.byType(PostThumbnail), findsNWidgets(2));

    // Newest first.
    final newest = tester.getTopLeft(find.text('Newest post'));
    final older = tester.getTopLeft(find.text('Older post'));
    expect(newest.dy, lessThan(older.dy));
  });

  testWidgets('tapping a post opens its detail screen', (tester) async {
    await pumpApp(tester);

    await tester.tap(find.text('Newest post'));
    await tester.pumpAndSettle();

    expect(find.text('Newest post body', findRichText: true), findsOneWidget);
    expect(find.byIcon(Icons.open_in_browser), findsOneWidget);
  });

  testWidgets('the credit on a post opens everything that member posted', (
    tester,
  ) async {
    final repo = await pumpApp(tester);
    await tester.tap(find.text('Older post'));
    await tester.pumpAndSettle();
    // Written in the Studio: no credit line at all.
    expect(find.textContaining('Submitted by'), findsNothing);
    await tester.pageBack();
    await tester.pumpAndSettle();

    await tester.tap(find.text('Newest post'));
    await tester.pumpAndSettle();
    expect(find.text('Submitted by '), findsOneWidget);
    await tester.tap(find.byKey(const Key('credit-link')));
    await tester.pumpAndSettle();

    expect(find.widgetWithText(AppBar, 'Posts by ada_bikes'), findsOneWidget);
    expect(repo.requestedUids, ['g1']);
    expect(find.text('Newest post'), findsOneWidget);
    expect(find.text('Older post'), findsNothing);
  });

  testWidgets('bike posts show their details in the list and on the post', (
    tester,
  ) async {
    await pumpApp(tester);
    await tester.tap(find.text('Bikes'));
    await tester.pumpAndSettle();
    expect(find.text('GT · Mountain · 1990s'), findsOneWidget);

    await tester.tap(find.text('1992 GT Outpost'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('post-details')), findsOneWidget);
    expect(find.text('Brand'), findsOneWidget);
    expect(find.text('GT'), findsOneWidget);
    expect(find.text('Color'), findsOneWidget);
    expect(find.text('Orange'), findsOneWidget);
    expect(find.text('Mountain'), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();

    // A pizza shows its style the same way.
    await tester.tap(find.text('Pizza'));
    await tester.pumpAndSettle();
    expect(find.text('Detroit'), findsOneWidget);
    await tester.tap(find.text('Detroit style'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('post-details')), findsOneWidget);
    expect(find.text('Style'), findsOneWidget);
    expect(find.text('Detroit'), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();

    // Posts without details keep the plain layout.
    await tester.tap(find.text('All'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Older post'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('post-details')), findsNothing);
  });

  testWidgets('News, Pizza and Bikes tabs request their own feeds', (
    tester,
  ) async {
    final repo = await pumpApp(tester);

    await tester.tap(find.text('News'));
    await tester.pumpAndSettle();
    expect(find.text('Older post'), findsOneWidget);
    expect(find.text('Newest post'), findsNothing);

    await tester.tap(find.text('Pizza'));
    await tester.pumpAndSettle();
    expect(find.text('Detroit style'), findsOneWidget);

    await tester.tap(find.text('Bikes'));
    await tester.pumpAndSettle();
    expect(find.text('1992 GT Outpost'), findsOneWidget);
    expect(find.text('Detroit style'), findsNothing);

    expect(repo.requestedFeeds, containsAll(PostFeed.values));
  });

  testWidgets('an empty store says so', (tester) async {
    store = FakeStoreRepository()..empty = true;
    await pumpApp(tester);

    await tester.tap(find.text('Store'));
    await tester.pumpAndSettle();

    expect(find.text('Nothing in the shop yet'), findsOneWidget);
  });

  testWidgets('Store tab lists products with prices, sold-out state and '
      'category chips', (tester) async {
    await pumpApp(tester);

    await tester.tap(find.text('Store'));
    await tester.pumpAndSettle();

    expect(find.text('Pizza Predator Tee'), findsOneWidget);
    expect(find.text('\$20.00'), findsOneWidget);
    expect(find.text('Sticker Pack'), findsOneWidget);
    expect(find.text('Sold out'), findsOneWidget);
    // No badge while the cart is empty.
    expect(find.text('0'), findsNothing);

    // Chips: All products first, then one per category.
    expect(find.widgetWithText(ChoiceChip, 'All products'), findsOneWidget);
    await tester.tap(find.widgetWithText(ChoiceChip, 'Stickers'));
    await tester.pumpAndSettle();
    expect(find.text('Sticker Pack'), findsOneWidget);
    expect(find.text('Pizza Predator Tee'), findsNothing);
  });

  testWidgets('adding to the cart bumps the badge by the quantity and stays '
      'on the page', (tester) async {
    await pumpApp(tester);
    await tester.tap(find.text('Store'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pizza Predator Tee'));
    await tester.pumpAndSettle();

    expect(find.text('Soft cotton.'), findsOneWidget);
    await scrollTo(tester, find.text('M'));
    await tester.tap(find.text('M'));
    await scrollTo(tester, find.byKey(const Key('quantity-inc')));
    await tester.tap(find.byKey(const Key('quantity-inc')));
    await tester.pump();
    expect(tester.widget<Text>(find.byKey(const Key('quantity'))).data, '2');

    await scrollTo(tester, find.byKey(const Key('add-to-cart')));
    await tester.tap(find.byKey(const Key('add-to-cart')));
    await tester.pumpAndSettle();

    expect(find.text('Added 2 to your cart.'), findsOneWidget);
    expect(cart.count, 2);
    expect(cart.items.single.variantId, 'v-m');
    // Still on the product page; the cart did not open.
    expect(find.byKey(const Key('buy-now')), findsOneWidget);
    expect(find.text('Your cart'), findsNothing);

    // The product page's own cart button shows the count and opens the cart.
    final badge = find.byKey(const Key('cart-badge'));
    expect(tester.widget<Badge>(badge).isLabelVisible, isTrue);
    expect(
      find.descendant(of: badge, matching: find.text('2')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('cart-button')));
    await tester.pumpAndSettle();
    expect(find.text('Your cart'), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();

    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(
      find.descendant(
        of: find.byKey(const Key('cart-badge')),
        matching: find.text('2'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('Buy it now with an empty cart checks out that quantity with '
      'the signed-in email', (tester) async {
    await pumpApp(tester);
    await auth.signIn(email: 'andy@example.com', password: 'correct-horse');

    await tester.tap(find.text('Store'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pizza Predator Tee'));
    await tester.pumpAndSettle();

    await scrollTo(tester, find.text('M'));
    await tester.tap(find.text('M'));
    await scrollTo(tester, find.byKey(const Key('quantity-inc')));
    await tester.tap(find.byKey(const Key('quantity-inc')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('quantity-inc')));
    await tester.pump();
    await scrollTo(tester, find.byKey(const Key('buy-now')));
    await tester.tap(find.byKey(const Key('buy-now')));
    // url_launcher has no platform implementation under test, so the busy
    // spinner never settles; a few frames are enough for the checkout call.
    await tester.pump();
    await tester.pump();

    expect(find.text('Check out what?'), findsNothing);
    expect(store!.checkouts, ['v-m x3']);
    expect(store!.lastEmail, 'andy@example.com');
    expect(cart.isEmpty, isTrue); // buying does not touch the cart
  });

  testWidgets('Buy it now with items in the cart asks, and can include '
      'them', (tester) async {
    await pumpApp(tester);
    await cart.add(
      CartItem.of(
        FakeStoreRepository.products[0],
        FakeStoreRepository.products[0].variants[0],
        quantity: 1,
      ),
    );

    await tester.tap(find.text('Store'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pizza Predator Tee'));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('M'));
    await tester.tap(find.text('M'));
    await tester.pump();
    await scrollTo(tester, find.byKey(const Key('buy-now')));

    await tester.tap(find.byKey(const Key('buy-now')));
    await tester.pumpAndSettle();
    expect(find.text('Check out what?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(store!.checkouts, isEmpty);

    // Checkout never settles under test (url_launcher has no platform
    // implementation), so each test gets one real checkout.
    await tester.tap(find.byKey(const Key('buy-now')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('buy-with-cart')));
    await tester.pump();
    await tester.pump();
    expect(store!.checkouts, ['v-s x1, v-m x1']);
    expect(cart.count, 1); // the cart itself is untouched
  });

  testWidgets('Buy it now can check out just this item, leaving the cart', (
    tester,
  ) async {
    await pumpApp(tester);
    await cart.add(
      CartItem.of(
        FakeStoreRepository.products[0],
        FakeStoreRepository.products[0].variants[0],
        quantity: 1,
      ),
    );

    await tester.tap(find.text('Store'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pizza Predator Tee'));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('M'));
    await tester.tap(find.text('M'));
    await tester.pump();
    await scrollTo(tester, find.byKey(const Key('buy-now')));

    await tester.tap(find.byKey(const Key('buy-now')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('buy-just-this')));
    await tester.pump();
    await tester.pump();
    expect(store!.checkouts, ['v-m x1']);
    expect(cart.count, 1);
  });

  testWidgets('the cart screen adjusts quantities and checks everything out', (
    tester,
  ) async {
    await pumpApp(tester);
    await cart.add(
      CartItem.of(
        FakeStoreRepository.products[0],
        FakeStoreRepository.products[0].variants[1],
        quantity: 1,
      ),
    );

    await tester.tap(find.text('Store'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('cart-button')));
    await tester.pumpAndSettle();

    expect(find.text('Your cart'), findsOneWidget);
    expect(find.text('M'), findsOneWidget); // the variant
    expect(find.byKey(const Key('cart-subtotal')), findsOneWidget);

    await tester.tap(find.byKey(const Key('quantity-inc')));
    await tester.pumpAndSettle();
    expect(cart.count, 2);
    expect(
      tester.widget<Text>(find.byKey(const Key('cart-subtotal'))).data,
      '\$40.00',
    );

    await tester.tap(find.byKey(const Key('cart-checkout')));
    await tester.pump();
    await tester.pump();
    expect(store!.checkouts, ['v-m x2']);

    await tester.tap(find.byKey(const Key('cart-remove-2')));
    await tester.pumpAndSettle();
    expect(find.text('Your cart is empty.'), findsOneWidget);
  });

  testWidgets('sold-out product cannot be bought or added', (tester) async {
    await pumpApp(tester);

    await tester.tap(find.text('Store'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sticker Pack'));
    await tester.pumpAndSettle();

    expect(
      tester.widget<FilledButton>(find.byKey(const Key('buy-now'))).onPressed,
      isNull,
    );
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('add-to-cart')))
          .onPressed,
      isNull,
    );
  });

  testWidgets('user can sign in from Settings and sign out again', (
    tester,
  ) async {
    await pumpApp(tester);

    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);
    // The About tile shows the version the app was built with.
    expect(find.text('Version 1.0.0 (build 1)'), findsOneWidget);

    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byType(TextFormField).at(0),
      'andy@example.com',
    );
    await tester.enterText(find.byType(TextFormField).at(1), 'wrong-password');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('Email or password is incorrect.'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField).at(1), 'correct-horse');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();

    // Back on Settings, now signed in.
    expect(find.text('andy@example.com'), findsOneWidget);
    expect(find.text('Sign out'), findsOneWidget);

    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);
  });

  testWidgets('sign-in screen validates input before submitting', (
    tester,
  ) async {
    await pumpApp(tester);
    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();

    expect(find.text('Enter a valid email address'), findsOneWidget);
    expect(find.text('Password must be at least 6 characters'), findsOneWidget);
  });

  testWidgets('creating an account asks for the password twice', (
    tester,
  ) async {
    await pumpApp(tester);
    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('New here? Create an account'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField).at(0), 'new@example.com');
    await tester.enterText(find.byType(TextFormField).at(1), 'secret-one');
    await tester.enterText(
      find.byKey(const Key('confirm-password')),
      'secret-two',
    );
    await tester.enterText(find.byKey(const Key('username')), 'newbie');
    await tester.tap(find.widgetWithText(FilledButton, 'Create account'));
    await tester.pumpAndSettle();
    expect(find.text('Passwords do not match'), findsOneWidget);
    expect(auth.currentUser, isNull);

    await tester.enterText(
      find.byKey(const Key('confirm-password')),
      'secret-one',
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Create account'));
    await tester.pumpAndSettle();
    expect(auth.currentUser?.email, 'new@example.com');
    // Back on Settings, signed in.
    expect(find.text('new@example.com'), findsOneWidget);
  });

  Future<void> openSignIn(WidgetTester tester) async {
    await pumpApp(tester);
    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
  }

  testWidgets('Google button signs in and returns to Settings', (tester) async {
    await openSignIn(tester);

    await tester.ensureVisible(find.byKey(const Key('google-sign-in')));
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();

    expect(auth.googleCalls, 1);
    // Names are not kept, so the tile shows the email alone.
    expect(find.text('g@example.com'), findsOneWidget);
    expect(find.text('Signed in'), findsOneWidget);
  });

  testWidgets('cancelling a provider shows no error', (tester) async {
    await openSignIn(tester);
    auth.cancelProviders = true;

    await tester.ensureVisible(find.byKey(const Key('google-sign-in')));
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('google-sign-in')), findsOneWidget);
    expect(find.textContaining('cancel'), findsNothing);
  });

  testWidgets('Apple button is hidden on Android', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    await openSignIn(tester);

    expect(find.byKey(const Key('apple-sign-in')), findsNothing);
    // Must be reset inside the test body; flutter_test checks it before
    // tearDown callbacks run.
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('Apple button is shown on iOS and signs in', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    await openSignIn(tester);

    await tester.ensureVisible(find.byKey(const Key('apple-sign-in')));
    await tester.tap(find.byKey(const Key('apple-sign-in')));
    await tester.pumpAndSettle();

    expect(auth.appleCalls, 1);
    expect(find.text('a@example.com'), findsOneWidget);
    debugDefaultTargetPlatformOverride = null;
  });

  Future<void> openAccount(WidgetTester tester) async {
    await tester.tap(find.byKey(const Key('manage-account')));
    await tester.pumpAndSettle();
  }

  testWidgets('accounts with two-factor authentication get a code step', (
    tester,
  ) async {
    await openSignIn(tester);
    auth.requireSecondFactor = true;

    await tester.enterText(
      find.byType(TextFormField).at(0),
      'andy@example.com',
    );
    await tester.enterText(find.byType(TextFormField).at(1), 'correct-horse');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();

    expect(find.text('Enter your authenticator code'), findsOneWidget);
    expect(auth.currentUser, isNull);

    // A wrong code keeps the step open with a message.
    await tester.enterText(find.byKey(const Key('mfa-code')), '000000');
    await tester.tap(find.byKey(const Key('mfa-verify')));
    await tester.pumpAndSettle();
    expect(find.textContaining('That code is not right'), findsOneWidget);
    expect(auth.currentUser, isNull);

    // Backing out drops the parked sign-in and returns to the form.
    await tester.tap(find.text('Use a different account'));
    await tester.pumpAndSettle();
    expect(auth.cancelledSecondFactors, 1);
    expect(find.byType(TextFormField), findsNWidgets(2));

    // Google accounts get the same step; the right code completes it.
    await tester.ensureVisible(find.byKey(const Key('google-sign-in')));
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();
    expect(find.text('Enter your authenticator code'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('mfa-code')), '123456');
    await tester.tap(find.byKey(const Key('mfa-verify')));
    await tester.pumpAndSettle();

    expect(auth.currentUser?.email, 'g@example.com');
    expect(find.text('g@example.com'), findsOneWidget);
  });

  testWidgets('a passkey on the device stands in for the authenticator code', (
    tester,
  ) async {
    passkeys = FakePasskeyService()..onDevice = {'andy@example.com'};
    await openSignIn(tester);
    auth.requireSecondFactor = true;

    await tester.enterText(
      find.byType(TextFormField).at(0),
      'andy@example.com',
    );
    await tester.enterText(find.byType(TextFormField).at(1), 'correct-horse');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();

    // Signed in, with no code step in between.
    expect(find.text('Enter your authenticator code'), findsNothing);
    expect(passkeys!.scopedTo, 'andy@example.com');
    expect(auth.currentUser?.email, 'andy@example.com');
    // The parked sign-in was dropped rather than left waiting.
    expect(auth.cancelledSecondFactors, 1);
  });

  testWidgets('a device without a passkey gets the code step, which can '
      'still try one', (tester) async {
    // The account has no passkeys at all.
    passkeys = FakePasskeyService()..onDevice = <String>{};
    await openSignIn(tester);
    auth.requireSecondFactor = true;

    await tester.enterText(
      find.byType(TextFormField).at(0),
      'andy@example.com',
    );
    await tester.enterText(find.byType(TextFormField).at(1), 'correct-horse');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('Enter your authenticator code'), findsOneWidget);
    expect(auth.currentUser, isNull);

    await tester.tap(find.byKey(const Key('mfa-passkey')));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('No passkey is saved for this account'),
      findsOneWidget,
    );
    expect(auth.currentUser, isNull);

    // With one on the account, the same button finishes the sign-in.
    passkeys!.onDevice = {'andy@example.com'};
    await tester.tap(find.byKey(const Key('mfa-passkey')));
    await tester.pumpAndSettle();
    expect(auth.currentUser?.email, 'andy@example.com');
  });

  testWidgets('a Google sign-in with a passkey skips the code step too', (
    tester,
  ) async {
    passkeys = FakePasskeyService()..onDevice = {'g@example.com'};
    await openSignIn(tester);
    auth.requireSecondFactor = true;

    await tester.ensureVisible(find.byKey(const Key('google-sign-in')));
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();

    expect(find.text('Enter your authenticator code'), findsNothing);
    // Scoped to the Google account, so only its passkeys could answer.
    expect(passkeys!.scopedTo, 'g@example.com');
    expect(auth.currentUser?.email, 'g@example.com');
    expect(auth.cancelledSecondFactors, 1);
  });

  testWidgets('a sign-in that names no account still tries the passkeys on '
      'the device', (tester) async {
    passkeys = FakePasskeyService();
    await openSignIn(tester);
    auth
      ..requireSecondFactor = true
      ..secondFactorKnowsEmail = false;

    await tester.ensureVisible(find.byKey(const Key('google-sign-in')));
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();

    expect(find.text('Enter your authenticator code'), findsNothing);
    expect(passkeys!.scopedTo, isNull);
    expect(auth.currentUser?.email, 'passkey@example.com');
  });

  testWidgets('devices that cannot use passkeys keep the code step to '
      'themselves', (tester) async {
    passkeys = FakePasskeyService(supported: false);
    await openSignIn(tester);
    auth.requireSecondFactor = true;

    await tester.ensureVisible(find.byKey(const Key('google-sign-in')));
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();
    expect(find.text('Enter your authenticator code'), findsOneWidget);
    expect(find.byKey(const Key('mfa-passkey')), findsNothing);
    expect(passkeys!.signIns, 0);
  });

  testWidgets('verified users can edit their username and newsletters', (
    tester,
  ) async {
    members = FakeMemberService();
    await openSignIn(tester);
    await tester.ensureVisible(find.byKey(const Key('google-sign-in')));
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('verify-email')), findsNothing);
    await openAccount(tester);

    expect(find.text('member@example.com'), findsOneWidget);
    expect(find.text('Signs in with Google'), findsOneWidget);
    expect(find.text('Weekly'), findsOneWidget);
    // Social accounts have no password to manage.
    expect(find.byKey(const Key('change-password')), findsNothing);
    expect(find.textContaining('no password to manage'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('username')), 'Andy_1');
    await tester.tap(find.byKey(const Key('newsletter-weekly')));
    await tester.ensureVisible(find.byKey(const Key('save-profile')));
    await tester.tap(find.byKey(const Key('save-profile')));
    await tester.pumpAndSettle();

    expect(members!.updates, hasLength(1));
    expect(members!.updates.single.username, 'Andy_1');
    expect(members!.updates.single.newsletters, isEmpty);
    expect(find.text('Saved.'), findsOneWidget);
  });

  testWidgets('members can turn two-factor authentication on and off', (
    tester,
  ) async {
    members = FakeMemberService();
    await openSignIn(tester);
    await tester.ensureVisible(find.byKey(const Key('google-sign-in')));
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();
    await openAccount(tester);

    // Off by default.
    final toggle = find.byKey(const Key('second-factor'));
    await scrollTo(tester, toggle);
    expect(tester.widget<SwitchListTile>(toggle).value, isFalse);

    await tester.tap(toggle);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('open-authenticator')), findsOneWidget);
    expect(find.text('ABCDEFGHIJKLMNOP'), findsOneWidget);
    expect(auth.enrolling, isTrue);

    await tester.enterText(find.byKey(const Key('totp-code')), '999999');
    await scrollTo(tester, find.byKey(const Key('totp-finish')));
    await tester.tap(find.byKey(const Key('totp-finish')));
    await tester.pumpAndSettle();
    expect(find.textContaining('That code is not right'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('totp-code')), '123456');
    await scrollTo(tester, find.byKey(const Key('totp-finish')));
    await tester.tap(find.byKey(const Key('totp-finish')));
    await tester.pumpAndSettle();

    // Back on the account screen, now on.
    expect(auth.factors, hasLength(1));
    expect(
      find.textContaining('Two-factor authentication is on'),
      findsOneWidget,
    );
    // Let that snackbar time out, or the next one queues behind it.
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
    await scrollTo(tester, toggle);
    expect(tester.widget<SwitchListTile>(toggle).value, isTrue);

    // Turning it off asks first.
    await tester.tap(toggle);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Keep it on'));
    await tester.pumpAndSettle();
    expect(auth.factors, hasLength(1));

    await scrollTo(tester, toggle);
    await tester.tap(toggle);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('confirm-turn-off')));
    await tester.pumpAndSettle();
    expect(auth.factors, isEmpty);
    expect(find.text('Two-factor authentication is off.'), findsOneWidget);
  });

  testWidgets('administrators cannot turn two-factor authentication off', (
    tester,
  ) async {
    members = FakeMemberService();
    await openSignIn(tester);
    auth
      ..admin = true
      ..factors.add(const SecondFactor(id: 'f1', name: 'Authenticator app'));
    await tester.ensureVisible(find.byKey(const Key('google-sign-in')));
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();
    await openAccount(tester);

    final toggle = find.byKey(const Key('second-factor'));
    await scrollTo(tester, toggle);
    final tile = tester.widget<SwitchListTile>(toggle);
    expect(tile.value, isTrue);
    expect(tile.onChanged, isNull);
    expect(find.text('On, and required for administrators.'), findsOneWidget);
  });

  testWidgets('the account screen insists on a valid username', (tester) async {
    members = FakeMemberService()
      ..profile = const MemberProfile(email: 'member@example.com');
    await openSignIn(tester);
    await tester.ensureVisible(find.byKey(const Key('google-sign-in')));
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();
    await openAccount(tester);

    expect(find.textContaining('Choose a username.'), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('save-profile')));
    await tester.tap(find.byKey(const Key('save-profile')));
    await tester.pumpAndSettle();
    expect(find.text('Choose a username'), findsOneWidget);
    expect(members!.updates, isEmpty);

    await tester.enterText(find.byKey(const Key('username')), 'no spaces');
    await tester.tap(find.byKey(const Key('save-profile')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Username must be'), findsOneWidget);
    expect(members!.updates, isEmpty);

    // A username someone else holds is reported by the server.
    await tester.enterText(find.byKey(const Key('username')), 'taken');
    await tester.tap(find.byKey(const Key('save-profile')));
    await tester.pumpAndSettle();
    expect(find.text('That username is taken.'), findsOneWidget);
    expect(members!.updates, isEmpty);
  });

  testWidgets('sign-up choices are sent once the email is verified', (
    tester,
  ) async {
    members = FakeMemberService()
      ..profile = const MemberProfile(
        email: 'new@example.com',
        newsletters: [Newsletter(id: 'weekly', name: 'Weekly')],
      );
    await openSignIn(tester);
    await tester.tap(find.text('New here? Create an account'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(0), 'new@example.com');
    await tester.enterText(find.byType(TextField).at(1), 'correct-horse');
    await tester.enterText(
      find.byKey(const Key('confirm-password')),
      'correct-horse',
    );
    // Sign-up needs a username; an unticked newsletter box is respected.
    await tester.tap(find.widgetWithText(FilledButton, 'Create account'));
    await tester.pumpAndSettle();
    expect(find.text('Choose a username'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('username')), 'newbie');
    await tester.tap(find.byKey(const Key('newsletter')));
    await tester.tap(find.widgetWithText(FilledButton, 'Create account'));
    await tester.pumpAndSettle();

    // Nothing is sent until the email is verified.
    expect(members!.updates, isEmpty);
    expect(find.byKey(const Key('verify-email')), findsOneWidget);
    await tester.tap(find.byKey(const Key('verify-email')));
    await tester.pumpAndSettle();
    expect(members!.updates, hasLength(1));
    expect(members!.updates.single.username, 'newbie');
    expect(members!.updates.single.newsletters, isEmpty);

    // The choices were used up: opening the account sends nothing more.
    await openAccount(tester);
    expect(find.text('newbie'), findsOneWidget);
    expect(members!.updates, hasLength(1));
  });

  testWidgets('password accounts can change their password', (tester) async {
    members = FakeMemberService();
    await openSignIn(tester);
    await tester.enterText(find.byType(TextField).at(0), 'me@example.com');
    await tester.enterText(find.byType(TextField).at(1), 'correct-horse');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    // Tapping the verify tile reloads the user; the fake marks them verified.
    await tester.tap(find.byKey(const Key('verify-email')));
    await tester.pumpAndSettle();
    await openAccount(tester);

    expect(find.text('Signs in with a password'), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('change-password')));
    await tester.enterText(find.byKey(const Key('current-password')), 'nope');
    await tester.enterText(find.byKey(const Key('new-password')), 'new-secret');
    await tester.tap(find.byKey(const Key('change-password')));
    await tester.pumpAndSettle();
    expect(find.text('Current password is incorrect.'), findsOneWidget);
    expect(auth.passwordChanges, 0);
    // Let that snackbar expire so the next one is not queued behind it.
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const Key('current-password')),
      'correct-horse',
    );
    await tester.enterText(find.byKey(const Key('new-password')), 'new-secret');
    await tester.tap(find.byKey(const Key('change-password')));
    await tester.pumpAndSettle();
    expect(auth.passwordChanges, 1);
    expect(find.textContaining('Password changed.'), findsOneWidget);

    await tester.tap(find.byKey(const Key('reset-password')));
    await tester.pumpAndSettle();
    expect(auth.resetEmails, ['me@example.com']);
  });

  testWidgets('unverified password accounts are asked to verify first', (
    tester,
  ) async {
    members = FakeMemberService();
    await openSignIn(tester);
    await tester.enterText(find.byType(TextField).at(0), 'me@example.com');
    await tester.enterText(find.byType(TextField).at(1), 'correct-horse');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('manage-account')), findsNothing);
    expect(find.byKey(const Key('verify-email')), findsOneWidget);

    await tester.tap(find.text('Send email'));
    await tester.pumpAndSettle();
    expect(auth.verificationEmails, 1);
    expect(find.text('Verification email sent.'), findsOneWidget);

    await tester.tap(find.byKey(const Key('verify-email')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('manage-account')), findsOneWidget);
  });

  testWidgets('account load errors offer a retry', (tester) async {
    members = FakeMemberService()..fail = true;
    await openSignIn(tester);
    await tester.ensureVisible(find.byKey(const Key('google-sign-in')));
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();
    await openAccount(tester);

    expect(
      find.text('Could not reach your account right now.'),
      findsOneWidget,
    );
    members!.fail = false;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('member@example.com'), findsOneWidget);
    expect(members!.loads, 2);
  });

  testWidgets('signing out from the account screen returns to Settings', (
    tester,
  ) async {
    members = FakeMemberService();
    await openSignIn(tester);
    await tester.ensureVisible(find.byKey(const Key('google-sign-in')));
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();
    await openAccount(tester);

    await scrollTo(tester, find.byKey(const Key('sign-out')));
    await tester.tap(find.byKey(const Key('sign-out')));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);
    expect(auth.currentUser, isNull);
  });

  testWidgets('account tiles are hidden when management is unavailable', (
    tester,
  ) async {
    await openSignIn(tester);
    await tester.ensureVisible(find.byKey(const Key('google-sign-in')));
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('manage-account')), findsNothing);
    expect(find.byKey(const Key('verify-email')), findsNothing);
    expect(find.byKey(const Key('delete-account')), findsNothing);
  });

  /// From any tab of a pumped app: Settings > Sign in > Google.
  Future<void> signInWithGoogle(WidgetTester tester) async {
    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('google-sign-in')));
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();
  }

  testWidgets('a device with a passkey can sign in with it', (tester) async {
    passkeys = FakePasskeyService();
    await pumpApp(tester);
    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const Key('passkey-sign-in')));
    await tester.tap(find.byKey(const Key('passkey-sign-in')));
    await tester.pumpAndSettle();

    expect(passkeys!.signIns, 1);
    expect(auth.currentUser?.email, 'passkey@example.com');
    // Back on Settings, signed in without a code step.
    expect(find.text('passkey@example.com'), findsOneWidget);
  });

  testWidgets('passkey sign-in failures show the message; cancelling shows '
      'nothing', (tester) async {
    passkeys = FakePasskeyService()..failSignIn = true;
    await openSignIn(tester);
    await tester.ensureVisible(find.byKey(const Key('passkey-sign-in')));
    await tester.tap(find.byKey(const Key('passkey-sign-in')));
    await tester.pumpAndSettle();
    expect(
      find.text('This device has no passkey for bikes.pizza yet.'),
      findsOneWidget,
    );
    expect(auth.currentUser, isNull);

    passkeys!
      ..failSignIn = false
      ..cancel = true;
    await tester.tap(find.byKey(const Key('passkey-sign-in')));
    await tester.pumpAndSettle();
    expect(find.textContaining('no passkey'), findsNothing);
    expect(auth.currentUser, isNull);
  });

  testWidgets('devices that cannot use passkeys get no passkey button', (
    tester,
  ) async {
    passkeys = FakePasskeyService(supported: false);
    await openSignIn(tester);
    expect(find.byKey(const Key('google-sign-in')), findsOneWidget);
    expect(find.byKey(const Key('passkey-sign-in')), findsNothing);
  });

  testWidgets('members add and remove passkeys on the account screen', (
    tester,
  ) async {
    members = FakeMemberService();
    passkeys = FakePasskeyService();
    await openSignIn(tester);
    await tester.ensureVisible(find.byKey(const Key('google-sign-in')));
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();
    await openAccount(tester);

    await scrollTo(tester, find.byKey(const Key('add-passkey')));
    expect(find.text('Safari on Mac'), findsOneWidget);
    expect(find.textContaining('Added 2026-08-01'), findsOneWidget);

    await tester.tap(find.byKey(const Key('add-passkey')));
    await tester.pumpAndSettle();
    expect(find.text('The app on iPhone or iPad'), findsOneWidget);
    expect(find.textContaining('Passkey added.'), findsOneWidget);
    expect(passkeys!.passkeys, hasLength(2));
    // Let that snackbar go before expecting the next one.
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('remove-passkey-k1')));
    await tester.pumpAndSettle();
    expect(find.text('Safari on Mac'), findsNothing);
    expect(find.textContaining('Removed the passkey'), findsOneWidget);
    expect(passkeys!.passkeys.map((p) => p.id), ['k2']);
  });

  testWidgets('members can delete their account from Settings', (tester) async {
    members = FakeMemberService();
    await pumpApp(tester);
    await signInWithGoogle(tester);

    // The tile is the last thing on the screen.
    await scrollTo(tester, find.byKey(const Key('delete-account')));

    // Backing out of the confirmation changes nothing.
    await tester.tap(find.byKey(const Key('delete-account')));
    await tester.pumpAndSettle();
    expect(find.text('Delete your account?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(members!.deletions, 0);
    expect(auth.currentUser, isNotNull);

    await tester.tap(find.byKey(const Key('delete-account')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('confirm-delete-account')));
    await tester.pumpAndSettle();

    expect(members!.deletions, 1);
    expect(auth.currentUser, isNull);
    expect(find.text('Your account has been deleted.'), findsOneWidget);

    // The list is still scrolled down to where the delete tile was.
    await tester.scrollUntilVisible(
      find.text('Sign in'),
      -120,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);
  });

  testWidgets('a failed deletion keeps the account and says so', (
    tester,
  ) async {
    members = FakeMemberService()..failDelete = true;
    await pumpApp(tester);
    await signInWithGoogle(tester);

    await scrollTo(tester, find.byKey(const Key('delete-account')));
    await tester.tap(find.byKey(const Key('delete-account')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('confirm-delete-account')));
    await tester.pumpAndSettle();

    expect(
      find.text('Could not delete your account right now.'),
      findsOneWidget,
    );
    expect(auth.currentUser, isNotNull);
    expect(find.byKey(const Key('delete-account')), findsOneWidget);
  });

  testWidgets('submit buttons appear on Pizza and Bikes for members only', (
    tester,
  ) async {
    await pumpApp(tester);

    await tester.tap(find.text('Bikes'));
    await tester.pumpAndSettle();
    expect(find.text('Submit Bike'), findsNothing);

    await signInWithGoogle(tester);

    await tester.tap(find.text('Bikes'));
    await tester.pumpAndSettle();
    expect(find.text('Submit Bike'), findsOneWidget);
    expect(find.text('Submit Pizza'), findsNothing);

    await tester.tap(find.text('Pizza'));
    await tester.pumpAndSettle();
    expect(find.text('Submit Pizza'), findsOneWidget);
    expect(find.text('Submit Bike'), findsNothing);

    await tester.tap(find.text('News'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Submit'), findsNothing);

    // Signing out hides them again.
    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pizza'));
    await tester.pumpAndSettle();
    expect(find.text('Submit Pizza'), findsNothing);
  });

  testWidgets('submit button is hidden on a post and for unverified users', (
    tester,
  ) async {
    members = FakeMemberService(); // so Settings offers the verify tile
    await openSignIn(tester);
    await tester.enterText(find.byType(TextField).at(0), 'me@example.com');
    await tester.enterText(find.byType(TextField).at(1), 'correct-horse');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();

    // Password accounts are not members until their email is verified.
    await tester.tap(find.text('Pizza'));
    await tester.pumpAndSettle();
    expect(find.text('Submit Pizza'), findsNothing);

    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('verify-email')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pizza'));
    await tester.pumpAndSettle();
    expect(find.text('Submit Pizza'), findsOneWidget);

    // Opening a post pushes a full screen: no button there.
    await tester.tap(find.text('Detroit style'));
    await tester.pumpAndSettle();
    expect(find.text('Submit Pizza'), findsNothing);
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('Submit Pizza'), findsOneWidget);
  });

  /// The form is a lazy ListView, so scroll until the button is built.
  Future<void> scrollToSubmit(WidgetTester tester) => tester.scrollUntilVisible(
    find.byKey(const Key('submit')),
    200,
    scrollable: find.byType(Scrollable).first,
  );

  Future<void> openSubmitForm(WidgetTester tester, String tab) async {
    members ??= FakeMemberService(); // pre-fills From with the username
    await pumpApp(tester);
    await signInWithGoogle(tester);
    await tester.tap(find.text(tab));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(Key('submit-${tab.toLowerCase()}')));
    await tester.pumpAndSettle();
  }

  testWidgets('submission form shows the feed-specific hints', (tester) async {
    await openSubmitForm(tester, 'Bikes');
    expect(find.widgetWithText(AppBar, 'Submit Bike'), findsOneWidget);
    expect(find.text('Main photo'), findsOneWidget);
    expect(find.text('(e.g. 1991 Trek 970 mountain bike!)'), findsOneWidget);
    expect(find.text('(your name/nickname)'), findsOneWidget);
    expect(find.text('Description/Story'), findsOneWidget);
    // The member's username pre-fills From.
    expect(
      tester
          .widget<TextFormField>(find.byKey(const Key('from')))
          .controller
          ?.text,
      'oldname',
    );
    await tester.pageBack();
    await tester.pumpAndSettle();

    await tester.tap(find.text('Pizza'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('submit-pizza')));
    await tester.pumpAndSettle();
    expect(find.text("(e.g. Domino's 14-inch Pepperoni)"), findsOneWidget);
  });

  testWidgets('submission form requires a photo and a title', (tester) async {
    await openSubmitForm(tester, 'Bikes');
    await tester.enterText(find.byKey(const Key('from')), '');
    await scrollToSubmit(tester);
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(find.text('Please add a photo.'), findsOneWidget);
    expect(find.text('Please give it a title.'), findsOneWidget);
    expect(find.text('Tell us who this is from.'), findsOneWidget);
    expect(submissions.submissions, isEmpty);
  });

  testWidgets('a complete submission is sent and thanks the member', (
    tester,
  ) async {
    await openSubmitForm(tester, 'Pizza');

    // Cancelling the picker leaves no photo.
    photos.cancel = true;
    await tester.tap(find.byKey(const Key('pick-photo')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('photo-library')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('photo-preview')), findsNothing);

    photos.cancel = false;
    await tester.tap(find.byKey(const Key('pick-photo')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('photo-camera')));
    await tester.pumpAndSettle();
    expect(photos.sources, [PhotoSource.library, PhotoSource.camera]);
    expect(find.byKey(const Key('photo-preview')), findsOneWidget);
    expect(find.text('Change photo'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('title')), ' Pepperoni ');
    await tester.enterText(find.byKey(const Key('from')), 'Andy');
    await tester.enterText(
      find.byKey(const Key('description')),
      'Crispy edges.',
    );
    await scrollToSubmit(tester);
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    final sent = submissions.submissions.single;
    expect(sent.feed, PostFeed.pizza);
    expect(sent.title, 'Pepperoni');
    expect(sent.from, 'Andy');
    expect(sent.description, 'Crispy edges.');
    expect(sent.photo.contentType, 'image/png');
    expect(find.text('Thanks!'), findsOneWidget);

    await tester.tap(find.byKey(const Key('done')));
    await tester.pumpAndSettle();
    expect(find.text('Submit Pizza'), findsOneWidget); // back on the list
  });

  testWidgets('additional pictures are added, removed and sent along', (
    tester,
  ) async {
    await openSubmitForm(tester, 'Bikes');
    await tester.tap(find.byKey(const Key('pick-photo')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('photo-library')));
    await tester.pumpAndSettle();

    Future<void> add() async {
      await tester.ensureVisible(find.byKey(const Key('add-picture')));
      await tester.tap(find.byKey(const Key('add-picture')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('photo-camera')));
      await tester.pumpAndSettle();
    }

    expect(find.byKey(const Key('picture-0')), findsNothing);
    await add();
    await add();
    expect(find.byKey(const Key('picture-1')), findsOneWidget);

    await tester.tap(find.byKey(const Key('remove-picture-0')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('picture-0')), findsOneWidget);
    expect(find.byKey(const Key('picture-1')), findsNothing);

    // Four is the most; the button then says so and stops.
    await add();
    await add();
    await add();
    expect(find.text('No more than 4'), findsOneWidget);
    expect(
      tester
          .widget<OutlinedButton>(find.byKey(const Key('add-picture')))
          .onPressed,
      isNull,
    );

    await tester.enterText(find.byKey(const Key('title')), 'Trek');
    await tester.enterText(find.byKey(const Key('from')), 'Andy');
    await scrollToSubmit(tester);
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    final sent = submissions.submissions.single;
    expect(sent.extras.length, 4);
    expect(sent.extras.first.contentType, 'image/png');
    expect(find.text('Thanks!'), findsOneWidget);
  });

  testWidgets(
    'an expired session on submit signs out and returns to the list',
    (tester) async {
      submissions.expireSession = true;
      await openSubmitForm(tester, 'Bikes');
      await tester.tap(find.byKey(const Key('pick-photo')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('photo-library')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('title')), 'Trek');
      await scrollToSubmit(tester);
      await tester.tap(find.byKey(const Key('submit')));
      await tester.pumpAndSettle();

      expect(auth.currentUser, isNull);
      expect(find.widgetWithText(AppBar, 'Bikes'), findsOneWidget);
      expect(
        find.text('Your session has expired. Please sign in again.'),
        findsOneWidget,
      );
      // Signed out, so the member button is gone too.
      expect(find.text('Submit Bike'), findsNothing);
    },
  );

  testWidgets('an expired session on the account screen signs out', (
    tester,
  ) async {
    members = FakeMemberService()..expireSession = true;
    await openSignIn(tester);
    await tester.ensureVisible(find.byKey(const Key('google-sign-in')));
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();
    await openAccount(tester);

    expect(auth.currentUser, isNull);
    expect(find.text('Sign in'), findsOneWidget); // back on Settings
    expect(
      find.text('Your session has expired. Please sign in again.'),
      findsOneWidget,
    );
  });

  testWidgets('submission failures show a snackbar and keep the form', (
    tester,
  ) async {
    submissions.fail = true;
    await openSubmitForm(tester, 'Bikes');
    await tester.tap(find.byKey(const Key('pick-photo')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('photo-library')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('title')), 'Trek');
    await scrollToSubmit(tester);
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(find.text('Could not send your submission.'), findsOneWidget);
    expect(find.text('Thanks!'), findsNothing);
    expect(
      tester
          .widget<TextFormField>(find.byKey(const Key('title')))
          .controller
          ?.text,
      'Trek',
    );
  });

  testWidgets('Settings tab switches theme mode', (tester) async {
    await pumpApp(tester);
    MaterialApp app() => tester.widget<MaterialApp>(find.byType(MaterialApp));
    // Light on every platform until the member picks otherwise.
    expect(app().themeMode, ThemeMode.light);

    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Dark'));
    await tester.pumpAndSettle();
    expect(app().themeMode, ThemeMode.dark);
  });

  testWidgets('Settings links to the privacy policy', (tester) async {
    await pumpApp(tester);

    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();

    final tile = find.byKey(const Key('privacy-policy'));
    await tester.dragUntilVisible(
      tile,
      find.byType(ListView),
      const Offset(0, -100),
    );
    await tester.pumpAndSettle();

    expect(tile, findsOneWidget);
    expect(find.text('Privacy policy'), findsOneWidget);
  });

  testWidgets('Settings offers a contact address', (tester) async {
    await pumpApp(tester);

    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();

    final tile = find.byKey(const Key('contact-us'));
    await tester.dragUntilVisible(
      tile,
      find.byType(ListView),
      const Offset(0, -100),
    );
    await tester.pumpAndSettle();

    expect(tile, findsOneWidget);
    expect(find.text('contact@bikes.pizza'), findsOneWidget);
  });

  // ---- editing posts --------------------------------------------------------

  /// Signs in as the Google member (uid g1, who posted "Newest post") and
  /// opens [title] from the All tab.
  Future<void> openPostAsMember(WidgetTester tester, String title) async {
    await pumpApp(tester);
    await signInWithGoogle(tester);
    await tester.tap(find.text('All'));
    await tester.pumpAndSettle();
    await tester.tap(find.text(title));
    await tester.pumpAndSettle();
  }

  testWidgets(
    'Settings → Posts lists the member\'s posts and opens the editor',
    (tester) async {
      await pumpApp(tester);
      await tester.tap(find.text('Settings'));
      await tester.pumpAndSettle();
      // Signed out: no Posts tile.
      expect(find.byKey(const Key('my-posts')), findsNothing);

      editor.mine = [
        PostSummary(
          id: 'Newest post',
          title: 'Newest post',
          feed: 'bikes',
          url: 'https://example.com/newest/',
          publishedAt: DateTime(2025, 4, 12),
        ),
      ];
      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('google-sign-in')));
      await tester.tap(find.byKey(const Key('google-sign-in')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('my-posts')));
      await tester.pumpAndSettle();

      expect(find.text('Your posts'), findsOneWidget);
      expect(find.text('Newest post'), findsOneWidget);
      expect(find.textContaining('Bike · '), findsOneWidget);

      await tester.tap(find.byKey(const Key('my-post-Newest post')));
      await tester.pumpAndSettle();
      expect(find.text('Edit post'), findsOneWidget);
      expect(
        tester
            .widget<TextFormField>(find.byKey(const Key('title')))
            .controller
            ?.text,
        'Newest post',
      );
      expect(find.byKey(const Key('bike-brand')), findsOneWidget);
      expect(find.byKey(const Key('pizza-style')), findsNothing);
    },
  );

  testWidgets('an empty or failed Posts list says so', (tester) async {
    await pumpApp(tester);
    await signInWithGoogle(tester);
    await tester.tap(find.byKey(const Key('my-posts')));
    await tester.pumpAndSettle();
    expect(find.text('No posts yet'), findsOneWidget);

    await tester.pageBack();
    await tester.pumpAndSettle();
    editor.fail = true;
    await tester.tap(find.byKey(const Key('my-posts')));
    await tester.pumpAndSettle();
    expect(find.text('Could not load your posts'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets('Edit shows for the member who posted, and for administrators', (
    tester,
  ) async {
    await openPostAsMember(tester, 'Newest post');
    expect(find.byKey(const Key('edit-post')), findsOneWidget);

    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Older post'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('edit-post')), findsNothing);

    await tester.pageBack();
    await tester.pumpAndSettle();
    auth.admin = true;
    await tester.tap(find.text('Older post'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('edit-post')), findsOneWidget);

    // Signed out, nothing to edit anywhere.
    await tester.pageBack();
    await tester.pumpAndSettle();
    await auth.signOut();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Newest post'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('edit-post')), findsNothing);
  });

  testWidgets('a member\'s edit sends only what changed, for review', (
    tester,
  ) async {
    await openPostAsMember(tester, 'Newest post');
    await tester.tap(find.byKey(const Key('edit-post')));
    await tester.pumpAndSettle();

    expect(find.text('Send for review'), findsOneWidget);
    expect(
      find.textContaining('for review before they appear'),
      findsOneWidget,
    );
    // Nothing changed yet: nothing to send.
    expect(
      tester.widget<FilledButton>(find.byKey(const Key('save'))).onPressed,
      isNull,
    );

    await tester.enterText(
      find.byKey(const Key('title')),
      'Newest post, restored',
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('save')));
    await tester.tap(find.byKey(const Key('save')));
    await tester.pumpAndSettle();

    expect(editor.saved.length, 1);
    final (id, edit) = editor.saved.single;
    expect(id, 'Newest post');
    expect(edit.title, 'Newest post, restored');
    expect(edit.story, isNull);
    expect(edit.bike, isNull);
    expect(edit.photo, isNull);
    expect(find.text('Thanks!'), findsOneWidget);
    expect(find.textContaining('for review'), findsOneWidget);

    await tester.tap(find.byKey(const Key('done')));
    await tester.pumpAndSettle();
    // Back on the post, unchanged until the review applies it.
    expect(find.text('Newest post'), findsWidgets);
    expect(find.text('Newest post, restored'), findsNothing);
  });

  testWidgets('changed details and a new photo are sent too', (tester) async {
    await openPostAsMember(tester, 'Newest post');
    await tester.tap(find.byKey(const Key('edit-post')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('pick-photo')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('photo-library')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('photo-preview')), findsOneWidget);

    await tester.enterText(find.byKey(const Key('bike-brand')), 'GT Bicycles');
    await tester.ensureVisible(find.byKey(const Key('bike-type')));
    await tester.tap(find.byKey(const Key('bike-type')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mountain').last);
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const Key('save')));
    await tester.tap(find.byKey(const Key('save')));
    await tester.pumpAndSettle();

    final (_, edit) = editor.saved.single;
    expect(edit.title, isNull);
    expect(edit.photo?.contentType, 'image/png');
    expect(edit.bike?.brand, 'GT Bicycles');
    expect(edit.bike?.year, '1990s');
    expect(edit.bike?.type, 'mtb');
    expect(edit.bike?.color, '');
  });

  testWidgets('the editor keeps, drops and adds additional pictures', (
    tester,
  ) async {
    editor.posts['Newest post'] = _editable(
      'Newest post',
      images: [_image('https://a/'), _image('https://b/')],
    );
    await openPostAsMember(tester, 'Newest post');
    await tester.tap(find.byKey(const Key('edit-post')));
    await tester.pumpAndSettle();

    // The post's pictures are shown; untouched, there is nothing to send.
    expect(find.byKey(const Key('picture-1')), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byKey(const Key('save'))).onPressed,
      isNull,
    );

    await tester.tap(find.byKey(const Key('remove-picture-0')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('add-picture')));
    await tester.tap(find.byKey(const Key('add-picture')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('photo-library')));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const Key('save')));
    await tester.tap(find.byKey(const Key('save')));
    await tester.pumpAndSettle();

    final (_, edit) = editor.saved.single;
    expect(edit.title, isNull);
    expect(edit.photo, isNull);
    final pictures = edit.pictures!;
    expect(pictures.length, 2);
    expect((pictures[0] as KeptPicture).image.version, 'https://b/');
    expect(pictures[1], isA<NewPicture>());
    expect(find.text('Thanks!'), findsOneWidget);
  });

  testWidgets('a post shows its additional pictures and opens a viewer', (
    tester,
  ) async {
    final post = _post(
      'Two more',
      DateTime(2026, 1, 1),
      bike: const BikeDetails(brand: 'GT'),
      images: [_image('https://a/'), _image('https://b/')],
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(child: PostArticle(post: post)),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('more-pictures')), findsOneWidget);
    expect(find.byKey(const Key('more-picture-1')), findsOneWidget);

    await tester.tap(find.byKey(const Key('more-picture-1')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('picture-viewer')), findsOneWidget);
    expect(find.text('2 of 2'), findsOneWidget);

    await tester.tap(find.byType(CloseButton));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('picture-viewer')), findsNothing);

    // A post without any has no strip.
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: PostArticle(post: _post('Plain', DateTime(2026, 1, 1))),
          ),
        ),
      ),
    );
    expect(find.byKey(const Key('more-pictures')), findsNothing);
  });

  testWidgets('an administrator\'s edit is applied and shown at once', (
    tester,
  ) async {
    editor.applies = true;
    await pumpApp(tester);
    await signInWithGoogle(tester);
    auth.admin = true;
    await tester.tap(find.text('All'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Older post'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('edit-post')));
    await tester.pumpAndSettle();

    expect(find.text('Save'), findsOneWidget);
    expect(find.text('Changes go live right away.'), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('title')),
      'Older post, renamed',
    );
    await tester.enterText(
      find.byKey(const Key('story')),
      'A new story.\n\nSecond paragraph.',
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('save')));
    await tester.tap(find.byKey(const Key('save')));
    await tester.pumpAndSettle();

    // Back on the post, which now reads as saved.
    expect(find.text('Saved.'), findsOneWidget);
    expect(find.text('Older post, renamed'), findsOneWidget);
    expect(find.text('Edit post'), findsNothing);
    final article = tester.widget<PostArticle>(find.byType(PostArticle));
    expect(article.post.title, 'Older post, renamed');
    expect(article.post.html, '<p>A new story.</p><p>Second paragraph.</p>');

    // The list behind shows the new title too.
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('Older post, renamed'), findsOneWidget);
  });

  testWidgets('the editor warns about formatted stories and pending edits', (
    tester,
  ) async {
    editor.posts['Newest post'] = _editable(
      'Newest post',
      formatted: true,
      pendingEditId: 's1',
    );
    await openPostAsMember(tester, 'Newest post');
    await tester.tap(find.byKey(const Key('edit-post')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('formatting-notice')), findsOneWidget);
    expect(find.byKey(const Key('pending-notice')), findsOneWidget);
    expect(find.textContaining('waiting for review'), findsOneWidget);
    expect(
      tester.widget<TextFormField>(find.byKey(const Key('title'))).enabled,
      isFalse,
    );
    expect(
      tester.widget<FilledButton>(find.byKey(const Key('save'))).onPressed,
      isNull,
    );
  });

  testWidgets('a failed save keeps the form and says why', (tester) async {
    await openPostAsMember(tester, 'Newest post');
    await tester.tap(find.byKey(const Key('edit-post')));
    await tester.pumpAndSettle();
    editor.fail = true;
    await tester.enterText(find.byKey(const Key('title')), 'Changed');
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('save')));
    await tester.tap(find.byKey(const Key('save')));
    await tester.pumpAndSettle();

    expect(find.text('Could not save that.'), findsOneWidget);
    expect(find.byType(EditPostScreen), findsOneWidget);
    expect(find.text('Thanks!'), findsNothing);
  });

  // ---- tablet admin ---------------------------------------------------------

  /// Signs in as an administrator and opens Settings.
  Future<void> settingsAsAdmin(WidgetTester tester, {Size? size}) async {
    await pumpApp(tester, size: size ?? const Size(800, 1200));
    auth.admin = true;
    await signInWithGoogle(tester);
  }

  testWidgets('Settings → Admin appears on tablets for administrators only', (
    tester,
  ) async {
    await settingsAsAdmin(tester, size: phone);
    expect(find.byKey(const Key('admin-section')), findsNothing);
  });

  testWidgets('Settings → Admin is hidden from members on tablets', (
    tester,
  ) async {
    await pumpApp(tester);
    await signInWithGoogle(tester);
    expect(find.byKey(const Key('admin-section')), findsNothing);
  });

  testWidgets('the submissions screen lists, filters and reviews', (
    tester,
  ) async {
    await settingsAsAdmin(tester);
    expect(find.byKey(const Key('admin-section')), findsOneWidget);
    await tester.tap(find.byKey(const Key('admin-submissions')));
    await tester.pumpAndSettle();

    expect(find.text('Submissions'), findsOneWidget);
    expect(find.textContaining('Bike queue: 2 waiting'), findsOneWidget);
    expect(find.text('Trek 970'), findsOneWidget);
    expect(find.text('Detroit slice, renamed'), findsOneWidget);
    expect(find.textContaining('Edit · Pizza'), findsOneWidget);
    expect(find.text('Grandma pie'), findsNothing); // queued, not pending
    expect(admin.listedStatuses.last, 'pending');

    await tester.tap(find.byKey(const Key('filter-queued')));
    await tester.pumpAndSettle();
    expect(admin.listedStatuses.last, 'queued');
    expect(find.text('Grandma pie'), findsOneWidget);
    expect(find.text('Trek 970'), findsNothing);

    // The website submit switch talks to the API.
    final toggle = find.byKey(const Key('submit-button-setting'));
    expect(tester.widget<SwitchListTile>(toggle).value, isTrue);
    await tester.tap(toggle);
    await tester.pumpAndSettle();
    expect(admin.submitButtonOn, isFalse);

    // Back to pending; open one on this portrait tablet: its own screen.
    await tester.tap(find.byKey(const Key('filter-pending')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('submission-s1')));
    await tester.pumpAndSettle();
    expect(find.text('A fine bike.'), findsOneWidget);
    expect(find.text('Queue to post'), findsOneWidget);
    // The additional pictures, each with what Vision saw or a kept note.
    expect(find.text('Additional pictures'), findsOneWidget);
    expect(find.textContaining('adult very unlikely'), findsOneWidget);
    expect(find.text('People: none seen'), findsOneWidget);
    expect(find.text('Already on the post'), findsOneWidget);
    expect(find.byKey(const Key('review-draft')), findsNothing);
    await tester.enterText(find.byKey(const Key('review-note')), 'lovely');
    await tester.tap(find.byKey(const Key('review-publish')));
    await tester.pumpAndSettle();

    expect(admin.reviews, [('s1', 'publish', 'lovely')]);
    expect(
      find.textContaining('Queued at position 1 for Bike'),
      findsOneWidget,
    );
    expect(find.text('Submissions'), findsOneWidget); // back on the list
  });

  testWidgets('an edit offers Apply edit; rejecting asks first', (
    tester,
  ) async {
    await settingsAsAdmin(tester);
    await tester.tap(find.byKey(const Key('admin-submissions')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('submission-e1')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('edit-of')), findsOneWidget);
    expect(find.textContaining('changes: title'), findsOneWidget);
    expect(find.text('Apply edit'), findsOneWidget);
    expect(find.byKey(const Key('review-draft')), findsNothing);

    await tester.tap(find.byKey(const Key('review-reject')));
    await tester.pumpAndSettle();
    expect(find.text('Reject this submission?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(admin.reviews, isEmpty);

    await tester.tap(find.byKey(const Key('review-reject')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('confirm-reject')));
    await tester.pumpAndSettle();
    expect(admin.reviews, [('e1', 'reject', '')]);
    expect(find.text('Rejected.'), findsOneWidget);
  });

  testWidgets('a queued submission can be taken out of the queue', (
    tester,
  ) async {
    await settingsAsAdmin(tester);
    await tester.tap(find.byKey(const Key('admin-submissions')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('filter-queued')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('submission-s2')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Queued by admin@example.com'), findsOneWidget);
    expect(find.byKey(const Key('review-publish')), findsNothing);
    await tester.tap(find.byKey(const Key('review-dequeue')));
    await tester.pumpAndSettle();
    expect(admin.dequeued, ['s2']);
    expect(find.textContaining('pending again'), findsOneWidget);
  });

  testWidgets('landscape tablets review a submission beside the list', (
    tester,
  ) async {
    await settingsAsAdmin(tester, size: landscapeTablet);
    await tester.tap(find.byKey(const Key('admin-submissions')));
    await tester.pumpAndSettle();
    expect(find.text('Choose a submission to review it here.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('submission-s1')));
    await tester.pumpAndSettle();
    expect(find.text('A fine bike.'), findsOneWidget);
    expect(find.text('Submissions'), findsOneWidget); // the list is still there
    await tester.tap(find.byKey(const Key('close-submission')));
    await tester.pumpAndSettle();
    expect(find.text('A fine bike.'), findsNothing);
  });

  testWidgets('admin screens explain a session without a second factor', (
    tester,
  ) async {
    admin.deny = true;
    await settingsAsAdmin(tester);
    await tester.tap(find.byKey(const Key('admin-users')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('admin-denied')), findsOneWidget);
    expect(find.textContaining('two-factor authentication'), findsOneWidget);
  });

  testWidgets('the users screen lists users and edits one', (tester) async {
    await settingsAsAdmin(tester);
    await tester.tap(find.byKey(const Key('admin-users')));
    await tester.pumpAndSettle();

    expect(find.text('Users'), findsOneWidget);
    expect(find.text('60 users, most recent post first.'), findsOneWidget);
    expect(find.text('ada_bikes'), findsOneWidget);
    expect(find.text('bob@example.com'), findsOneWidget);
    expect(find.text('Page 1 of 3'), findsOneWidget);
    expect(
      tester
          .widget<OutlinedButton>(find.byKey(const Key('page-previous')))
          .onPressed,
      isNull,
    );

    await tester.tap(find.byKey(const Key('user-u1')));
    await tester.pumpAndSettle();
    expect(find.text('Old Trek'), findsOneWidget);
    expect(find.byKey(const Key('user-reset-password')), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byKey(const Key('user-save'))).onPressed,
      isNull,
    );

    await tester.enterText(find.byKey(const Key('user-username')), 'ada_rides');
    await tester.tap(find.byKey(const Key('user-newsletter-news')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('user-save')));
    await tester.pumpAndSettle();
    final (uid, username, email, newsletters) = admin.updates.single;
    expect(uid, 'u1');
    expect(username, 'ada_rides');
    expect(email, isNull);
    expect(newsletters, isEmpty);
    expect(find.text('Saved.'), findsOneWidget);

    await tester.tap(find.byKey(const Key('user-reset-password')));
    await tester.pumpAndSettle();
    expect(auth.resetEmails, ['ada@example.com']);
  });

  testWidgets('deleting a user asks first and returns to the list', (
    tester,
  ) async {
    await settingsAsAdmin(tester);
    await tester.tap(find.byKey(const Key('admin-users')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('user-u2')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('user-reset-password')), findsNothing);

    await tester.tap(find.byKey(const Key('user-delete')));
    await tester.pumpAndSettle();
    expect(find.text('Delete bob@example.com?'), findsOneWidget);
    await tester.tap(find.byKey(const Key('confirm-delete-user')));
    await tester.pumpAndSettle();
    expect(admin.deleted, ['u2']);
    expect(find.text('Deleted bob@example.com.'), findsOneWidget);
    expect(find.text('Users'), findsOneWidget);
  });

  testWidgets('the admin screens stand on their own', (tester) async {
    useSize(tester, const Size(800, 1200));
    auth = FakeAuthService();
    await tester.pumpWidget(
      MaterialApp(
        home: SubmissionsScreen(admin: admin, auth: auth),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Trek 970'), findsOneWidget);
    await tester.pumpWidget(
      MaterialApp(
        home: UsersScreen(admin: admin, auth: auth),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('ada_bikes'), findsOneWidget);
  });
}
