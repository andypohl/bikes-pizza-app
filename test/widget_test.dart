import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pizza_predator/account/member_service.dart';
import 'package:pizza_predator/app_settings.dart';
import 'package:pizza_predator/auth/auth_service.dart';
import 'package:pizza_predator/data/post_repository.dart';
import 'package:pizza_predator/main.dart';
import 'package:pizza_predator/models/post.dart';
import 'package:pizza_predator/models/post_feed.dart';
import 'package:pizza_predator/store/product.dart';
import 'package:pizza_predator/store/store_repository.dart';
import 'package:pizza_predator/submissions/photo_picker.dart';
import 'package:pizza_predator/submissions/submission_service.dart';
import 'package:pizza_predator/widgets/post_tile.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// In-memory repository so widget tests never touch the network.
class FakePostRepository implements PostRepository {
  FakePostRepository(this.byFeed);

  final Map<PostFeed, List<Post>> byFeed;
  final requestedFeeds = <PostFeed>[];

  @override
  Future<PostPage> fetchPosts(PostFeed feed, {int page = 1}) async {
    requestedFeeds.add(feed);
    return PostPage(posts: page == 1 ? byFeed[feed] ?? [] : [], hasMore: false);
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

  @override
  Future<void> signIn({required String email, required String password}) async {
    if (password != 'correct-horse') {
      throw AuthException(
        'Email or password is incorrect.',
        badCredentials: true,
      );
    }
    _set(AppUser(uid: 'u1', email: email, providerIds: const ['password']));
  }

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
          displayName: user.displayName,
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
    _set(
      const AppUser(
        uid: 'g1',
        email: 'g@example.com',
        displayName: 'G',
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
        displayName: 'A',
        emailVerified: true,
        providerIds: ['apple.com'],
      ),
    );
  }

  @override
  Future<void> signOut() async => _set(null);
}

/// In-memory member profile; records updates.
class FakeMemberService implements MemberService {
  bool fail = false;
  bool expireSession = false;
  int loads = 0;
  final updates = <({String? name, List<String>? newsletters})>[];
  MemberProfile profile = const MemberProfile(
    email: 'member@example.com',
    name: 'Old Name',
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
    String? name,
    List<String>? newsletters,
  }) async {
    updates.add((name: name, newsletters: newsletters));
    profile = MemberProfile(
      email: profile.email,
      name: name ?? profile.name,
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
  final checkouts = <String>[];
  String? lastEmail;

  static const _usd = Money(amount: 20, currencyCode: 'USD');

  @override
  Future<ProductPage> fetchProducts({String? after}) async => const ProductPage(
    products: [
      Product(
        id: 'p1',
        title: 'Pizza Predator Tee',
        handle: 'tee',
        description: 'Soft cotton.',
        price: _usd,
        availableForSale: true,
        variants: [
          ProductVariant(
            id: 'v-s',
            title: 'S',
            price: _usd,
            availableForSale: true,
          ),
          ProductVariant(
            id: 'v-m',
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
        price: Money(amount: 5, currencyCode: 'USD'),
        availableForSale: false,
        variants: [
          ProductVariant(
            id: 'v-st',
            title: 'Default Title',
            price: Money(amount: 5, currencyCode: 'USD'),
            availableForSale: false,
          ),
        ],
      ),
    ],
  );

  @override
  Future<Uri> createCheckout({
    required String variantId,
    int quantity = 1,
    String? email,
  }) async {
    checkouts.add(variantId);
    lastEmail = email;
    return Uri.parse('https://example.myshopify.com/checkouts/1');
  }
}

Post _post(String title, DateTime date) => Post(
  id: title,
  title: title,
  url: 'https://example.com/$title/',
  publishedAt: date,
  html: '<p>$title body</p>',
);

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  late FakeAuthService auth;
  FakeStoreRepository? store;
  FakeMemberService? members;
  late FakeSubmissionService submissions;
  late FakePhotoPicker photos;

  setUp(() {
    store = null;
    members = null;
    submissions = FakeSubmissionService();
    photos = FakePhotoPicker();
  });

  Future<FakePostRepository> pumpApp(WidgetTester tester) async {
    auth = FakeAuthService();
    final repo = FakePostRepository({
      PostFeed.blog: [
        _post('Newest post', DateTime(2025, 4, 12)),
        _post('Older post', DateTime(2025, 3, 3)),
      ],
      PostFeed.pizza: [_post('Detroit style', DateTime(2025, 2, 1))],
      PostFeed.bikes: [],
    });
    await tester.pumpWidget(
      PizzaPredatorApp(
        settings: AppSettings(),
        repository: repo,
        auth: auth,
        store: store,
        members: members,
        submissions: submissions,
        photos: photos,
      ),
    );
    await tester.pumpAndSettle();
    return repo;
  }

  testWidgets('shows five bottom navigation destinations', (tester) async {
    await pumpApp(tester);

    expect(find.byType(NavigationBar), findsOneWidget);
    for (final label in ['Blog', 'Pizza', 'Bikes', 'Store', 'Settings']) {
      expect(
        find.descendant(
          of: find.byType(NavigationBar),
          matching: find.text(label),
        ),
        findsOneWidget,
      );
    }
  });

  testWidgets('Blog tab lists posts with thumbnails', (tester) async {
    await pumpApp(tester);

    expect(find.text('Pizza Predator'), findsOneWidget);
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

  testWidgets('Pizza and Bikes tabs request their own feeds', (tester) async {
    final repo = await pumpApp(tester);

    await tester.tap(find.text('Pizza'));
    await tester.pumpAndSettle();
    expect(find.text('Detroit style'), findsOneWidget);

    await tester.tap(find.text('Bikes'));
    await tester.pumpAndSettle();
    expect(find.text('No posts yet'), findsOneWidget);

    expect(repo.requestedFeeds, containsAll(PostFeed.values));
  });

  testWidgets('Store tab shows the coming-soon placeholder when unconfigured', (
    tester,
  ) async {
    store = null;
    await pumpApp(tester);

    await tester.tap(find.text('Store'));
    await tester.pumpAndSettle();

    expect(find.text('Coming Soon!'), findsOneWidget);
  });

  testWidgets('Store tab lists products with prices and sold-out state', (
    tester,
  ) async {
    store = FakeStoreRepository();
    await pumpApp(tester);

    await tester.tap(find.text('Store'));
    await tester.pumpAndSettle();

    expect(find.text('Pizza Predator Tee'), findsOneWidget);
    expect(find.text('\$20.00'), findsOneWidget);
    expect(find.text('Sticker Pack'), findsOneWidget);
    expect(find.text('Sold out'), findsOneWidget);
  });

  testWidgets('buying a variant creates a checkout with the signed-in email', (
    tester,
  ) async {
    store = FakeStoreRepository();
    await pumpApp(tester);
    await auth.signIn(email: 'andy@example.com', password: 'correct-horse');

    await tester.tap(find.text('Store'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pizza Predator Tee'));
    await tester.pumpAndSettle();

    expect(find.text('Soft cotton.'), findsOneWidget);
    await tester.ensureVisible(find.text('M'));
    await tester.tap(find.text('M'));
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('buy-now')));
    await tester.tap(find.byKey(const Key('buy-now')));
    // url_launcher has no platform implementation under test, so the busy
    // spinner never settles; a single frame is enough for the checkout call.
    await tester.pump();

    expect(store!.checkouts, ['v-m']);
    expect(store!.lastEmail, 'andy@example.com');
  });

  testWidgets('sold-out product cannot be bought', (tester) async {
    store = FakeStoreRepository();
    await pumpApp(tester);

    await tester.tap(find.text('Store'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sticker Pack'));
    await tester.pumpAndSettle();

    final button = tester.widget<FilledButton>(
      find.byKey(const Key('buy-now')),
    );
    expect(button.onPressed, isNull);
  });

  testWidgets('user can sign in from Settings and sign out again', (
    tester,
  ) async {
    await pumpApp(tester);

    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);

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

  Future<void> openSignIn(WidgetTester tester) async {
    await pumpApp(tester);
    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
  }

  testWidgets('legacy members are pointed at creating a password', (
    tester,
  ) async {
    await openSignIn(tester);
    expect(find.byKey(const Key('legacy-notice')), findsOneWidget);

    await tester.enterText(find.byType(TextField).at(0), 'old@example.com');
    await tester.enterText(find.byType(TextField).at(1), 'guessing');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('Subscribed before we had passwords?'), findsOneWidget);

    await tester.tap(find.byKey(const Key('create-password')));
    await tester.pumpAndSettle();

    // Now in create-account mode with the email kept and the password cleared.
    expect(find.widgetWithText(FilledButton, 'Create account'), findsOneWidget);
    expect(find.byKey(const Key('legacy-notice')), findsNothing);
    expect(
      tester.widget<TextField>(find.byType(TextField).at(0)).controller?.text,
      'old@example.com',
    );
    expect(
      tester.widget<TextField>(find.byType(TextField).at(1)).controller?.text,
      '',
    );
    expect(find.textContaining('subscription carries over'), findsOneWidget);
  });

  testWidgets('Google button signs in and returns to Settings', (tester) async {
    await openSignIn(tester);

    await tester.ensureVisible(find.byKey(const Key('google-sign-in')));
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();

    expect(auth.googleCalls, 1);
    expect(find.text('G'), findsOneWidget);
    expect(find.text('g@example.com'), findsOneWidget);
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

  testWidgets('verified users can edit their name and newsletters', (
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

    await tester.enterText(find.byKey(const Key('name')), 'Andy');
    await tester.tap(find.byKey(const Key('newsletter-weekly')));
    await tester.ensureVisible(find.byKey(const Key('save-profile')));
    await tester.tap(find.byKey(const Key('save-profile')));
    await tester.pumpAndSettle();

    expect(members!.updates, hasLength(1));
    expect(members!.updates.single.name, 'Andy');
    expect(members!.updates.single.newsletters, isEmpty);
    expect(find.text('Saved.'), findsOneWidget);
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

    await tester.ensureVisible(find.byKey(const Key('sign-out')));
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

    await tester.tap(find.text('Blog'));
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
    // The Google fake's display name pre-fills From.
    expect(
      tester
          .widget<TextFormField>(find.byKey(const Key('from')))
          .controller
          ?.text,
      'G',
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

    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Dark'));
    await tester.pumpAndSettle();

    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.themeMode, ThemeMode.dark);
  });
}
