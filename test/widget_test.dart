import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pizza_predator/app_settings.dart';
import 'package:pizza_predator/auth/auth_service.dart';
import 'package:pizza_predator/data/post_repository.dart';
import 'package:pizza_predator/main.dart';
import 'package:pizza_predator/models/post.dart';
import 'package:pizza_predator/models/post_feed.dart';
import 'package:pizza_predator/store/product.dart';
import 'package:pizza_predator/store/store_repository.dart';
import 'package:pizza_predator/widgets/post_tile.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// In-memory repository so widget tests never touch the network.
class FakePostRepository implements PostRepository {
  FakePostRepository(this.byFeed);

  final Map<PostFeed, List<Post>> byFeed;
  final requestedFeeds = <PostFeed>[];

  @override
  String get sourceName => 'Fake';

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
      throw AuthException('Email or password is incorrect.');
    }
    _set(AppUser(uid: 'u1', email: email));
  }

  @override
  Future<void> createAccount({
    required String email,
    required String password,
  }) async =>
      _set(AppUser(uid: 'u2', email: email));

  @override
  Future<void> sendPasswordReset(String email) async {}

  int googleCalls = 0;
  int appleCalls = 0;
  bool cancelProviders = false;

  @override
  Future<void> signInWithGoogle() async {
    googleCalls++;
    if (cancelProviders) throw AuthException.cancelled();
    _set(const AppUser(uid: 'g1', email: 'g@example.com', displayName: 'G'));
  }

  @override
  Future<void> signInWithApple() async {
    appleCalls++;
    if (cancelProviders) throw AuthException.cancelled();
    _set(const AppUser(uid: 'a1', email: 'a@example.com', displayName: 'A'));
  }

  @override
  Future<void> signOut() async => _set(null);
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
                  id: 'v-s', title: 'S', price: _usd, availableForSale: true),
              ProductVariant(
                  id: 'v-m', title: 'M', price: _usd, availableForSale: true),
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
                  availableForSale: false),
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
        find.descendant(of: find.byType(NavigationBar), matching: find.text(label)),
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

  testWidgets('Store tab shows the coming-soon placeholder when unconfigured',
      (tester) async {
    store = null;
    await pumpApp(tester);

    await tester.tap(find.text('Store'));
    await tester.pumpAndSettle();

    expect(find.text('Coming Soon!'), findsOneWidget);
  });

  testWidgets('Store tab lists products with prices and sold-out state',
      (tester) async {
    store = FakeStoreRepository();
    await pumpApp(tester);

    await tester.tap(find.text('Store'));
    await tester.pumpAndSettle();

    expect(find.text('Pizza Predator Tee'), findsOneWidget);
    expect(find.text('\$20.00'), findsOneWidget);
    expect(find.text('Sticker Pack'), findsOneWidget);
    expect(find.text('Sold out'), findsOneWidget);
  });

  testWidgets('buying a variant creates a checkout with the signed-in email',
      (tester) async {
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

    final button = tester.widget<FilledButton>(find.byKey(const Key('buy-now')));
    expect(button.onPressed, isNull);
  });

  testWidgets('user can sign in from Settings and sign out again',
      (tester) async {
    await pumpApp(tester);

    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);

    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField).at(0), 'andy@example.com');
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

  testWidgets('sign-in screen validates input before submitting',
      (tester) async {
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

  testWidgets('Google button signs in and returns to Settings',
      (tester) async {
    await openSignIn(tester);

    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();

    expect(auth.googleCalls, 1);
    expect(find.text('G'), findsOneWidget);
    expect(find.text('g@example.com'), findsOneWidget);
  });

  testWidgets('cancelling a provider shows no error', (tester) async {
    await openSignIn(tester);
    auth.cancelProviders = true;

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
