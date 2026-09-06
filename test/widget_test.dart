import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:pizza_predator/account/member_service.dart';
import 'package:pizza_predator/app_settings.dart';
import 'package:pizza_predator/auth/auth_service.dart';
import 'package:pizza_predator/data/post_repository.dart';
import 'package:pizza_predator/main.dart';
import 'package:pizza_predator/models/post.dart';
import 'package:pizza_predator/models/post_feed.dart';
import 'package:pizza_predator/store/cart.dart';
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
  final requestedAuthors = <String>[];

  @override
  Future<PostPage> fetchPosts(
    PostFeed feed, {
    int page = 1,
    String? author,
  }) async {
    requestedFeeds.add(feed);
    if (author != null) requestedAuthors.add(author);
    final posts = author == null
        ? byFeed[feed] ?? []
        : [
            for (final list in byFeed.values)
              for (final p in list)
                if (p.author?.id == author) p,
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

  /// Signs [user] in, or parks the sign-in behind the second factor.
  void _complete(AppUser user) {
    if (requireSecondFactor) {
      _parked = user;
      throw SecondFactorRequired();
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

/// In-memory member profile; records updates.
class FakeMemberService implements MemberService {
  bool fail = false;
  bool expireSession = false;
  int loads = 0;
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
  PostAuthor? author,
  BikeDetails? bike,
  PizzaDetails? pizza,
}) => Post(
  id: title,
  title: title,
  url: 'https://example.com/$title/',
  publishedAt: date,
  html: '<p>$title body</p>',
  author: author,
  bike: bike,
  pizza: pizza,
);

const _ada = PostAuthor(id: 'm1', username: 'ada_bikes');

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  late FakeAuthService auth;
  FakeStoreRepository? store;
  Cart cart = Cart();
  FakeMemberService? members;
  late FakeSubmissionService submissions;
  late FakePhotoPicker photos;

  setUp(() {
    PackageInfo.setMockInitialValues(
      appName: 'bikes.pizza',
      packageName: 'com.pizzapredator.pizza_predator',
      version: '1.0.0',
      buildNumber: '1',
      buildSignature: '',
    );
    store = null;
    cart = Cart();
    members = null;
    submissions = FakeSubmissionService();
    photos = FakePhotoPicker();
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

  Future<FakePostRepository> pumpApp(WidgetTester tester) async {
    auth = FakeAuthService();
    final repo = FakePostRepository({
      PostFeed.all: [
        _post('Newest post', DateTime(2025, 4, 12), author: _ada),
        _post('Older post', DateTime(2025, 3, 3)),
      ],
      PostFeed.blog: [_post('Older post', DateTime(2025, 3, 3))],
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
        submissions: submissions,
        photos: photos,
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
      'Blog',
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
      lessThan(tester.getTopLeft(inBar('Blog')).dx),
    );
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
    expect(repo.requestedAuthors, ['m1']);
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

  testWidgets('Blog, Pizza and Bikes tabs request their own feeds', (
    tester,
  ) async {
    final repo = await pumpApp(tester);

    await tester.tap(find.text('Blog'));
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
