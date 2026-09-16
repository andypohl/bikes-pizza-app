import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'account/member_service.dart';
import 'admin/admin_service.dart';
import 'api/api_client.dart';
import 'app_settings.dart';
import 'config.dart';
import 'auth/auth_service.dart';
import 'auth/passkey_service.dart';
import 'firebase_options.dart';
import 'firebase_options_dev.dart';
import 'data/firestore_post_repository.dart';
import 'data/post_repository.dart';
import 'models/post_feed.dart';
import 'posts/app_badge.dart';
import 'posts/post_editor.dart';
import 'posts/unread_tracker.dart';
import 'screens/news_screen.dart';
import 'screens/post_list_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/store_screen.dart';
import 'splash_screen.dart';
import 'store/cart.dart';
import 'store/store_repository.dart';
import 'submissions/photo_picker.dart';
import 'submissions/submission_service.dart';
import 'widgets/layout.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // The splash screen shows while Firebase, the settings and the cart load.
  runApp(AppBootstrap(load: _loadApp));
}

Future<Widget> _loadApp() async {
  // Release builds (the app stores) talk to the production Firebase project;
  // debug and profile builds (simulators, devices during development) to
  // the development one, bikes-pizza-dev. See docs/firebase.md.
  await Firebase.initializeApp(
    options: kReleaseMode
        ? DefaultFirebaseOptions.currentPlatform
        : DevFirebaseOptions.currentPlatform,
  );
  final settings = await AppSettings.load();
  final cart = await Cart.load();
  final unread = await UnreadTracker.load();
  final auth = FirebaseAuthService();
  // The REST API (editing posts) signs its requests with the same session.
  final api = ApiClient(baseUrl: ApiConfig.baseUrl, token: auth.idToken);
  return BikesPizzaApp(
    settings: settings,
    repository: FirestorePostRepository(
      projectId: Firebase.app().options.projectId,
      siteUrl: SiteConfig.siteUrl,
      pageSize: SiteConfig.pageSize,
    ),
    store: StoreRepository.forConfig(),
    cart: cart,
    auth: auth,
    members: CloudFunctionsMemberService(),
    passkeys: FirebasePasskeyService(),
    submissions: CloudFunctionsSubmissionService(),
    photos: ImagePickerPhotoPicker(),
    editor: ApiPostEditor(api),
    admin: ApiAdminService(api),
    unread: unread,
    badge: PlatformAppBadge(),
  );
}

class BikesPizzaApp extends StatelessWidget {
  const BikesPizzaApp({
    super.key,
    required this.settings,
    required this.repository,
    required this.auth,
    required this.store,
    required this.cart,
    this.members,
    this.passkeys,
    this.submissions,
    this.photos,
    this.editor,
    this.admin,
    this.unread,
    this.badge = const NoAppBadge(),
  });

  final AppSettings settings;
  final PostRepository repository;
  final AuthService auth;
  final StoreRepository store;

  /// The shopping cart, shared by the Store tab and the product pages.
  final Cart cart;

  /// Null when account management is unavailable; Settings then hides it.
  final MemberService? members;

  /// Null when passkeys are unavailable; sign-in and account omit them.
  final PasskeyService? passkeys;

  /// Both needed for the Submit Pizza / Submit Bike buttons; null hides them.
  final SubmissionService? submissions;
  final PhotoPicker? photos;

  /// With [photos], lets members edit their posts (and admins any post);
  /// null hides the Edit buttons and the Posts tile in Settings.
  final PostEditor? editor;

  /// The review and user administration screens for administrators on
  /// tablets; null hides Settings → Admin.
  final AdminService? admin;

  /// Counts the posts not opened since they changed, for the tab counters
  /// and, through [badge], the app icon; null shows no counters.
  final UnreadTracker? unread;
  final AppBadge badge;

  static const _seed = Color(0xFF80C6C4); // teal from the app icon

  @override
  Widget build(BuildContext context) {
    return AppSettingsScope(
      settings: settings,
      child: ListenableBuilder(
        listenable: settings,
        builder: (context, _) => MaterialApp(
          title: 'bikes.pizza',
          debugShowCheckedModeBanner: false,
          themeMode: settings.themeMode,
          theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: _seed)),
          darkTheme: ThemeData(
            colorScheme: ColorScheme.fromSeed(
              seedColor: _seed,
              brightness: Brightness.dark,
            ),
          ),
          home: HomeShell(
            repository: repository,
            auth: auth,
            store: store,
            cart: cart,
            members: members,
            passkeys: passkeys,
            submissions: submissions,
            photos: photos,
            editor: editor,
            admin: admin,
            unread: unread,
            badge: badge,
          ),
        ),
      ),
    );
  }
}

/// Root screen: a bottom navigation bar switching between the post feeds
/// (News, Pizza and Bikes, plus All on tablets), the Store, and Settings.
/// Each tab keeps its scroll position and loaded data because the pages
/// live in an [IndexedStack]. The feed tabs carry the count of posts not
/// opened since they changed, and the app icon their sum; the counts are
/// refreshed when the app starts and whenever it comes back to the front.
class HomeShell extends StatefulWidget {
  const HomeShell({
    super.key,
    required this.repository,
    required this.auth,
    required this.store,
    required this.cart,
    this.members,
    this.passkeys,
    this.submissions,
    this.photos,
    this.editor,
    this.admin,
    this.unread,
    this.badge = const NoAppBadge(),
  });

  final PostRepository repository;
  final AuthService auth;
  final StoreRepository store;
  final Cart cart;
  final MemberService? members;
  final PasskeyService? passkeys;
  final SubmissionService? submissions;
  final PhotoPicker? photos;
  final PostEditor? editor;
  final AdminService? admin;
  final UnreadTracker? unread;
  final AppBadge badge;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  int _index = 0;
  int _shownBadge = -1;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.unread?.addListener(_showBadge);
    _refreshUnread();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.unread?.removeListener(_showBadge);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refreshUnread();
  }

  Future<void> _refreshUnread() async {
    final unread = widget.unread;
    if (unread == null) return;
    await unread.refresh(widget.repository);
  }

  /// Puts the unread total on the app icon; the first time there is one,
  /// asks for the permission that needs (iOS).
  Future<void> _showBadge() async {
    final unread = widget.unread;
    if (unread == null) return;
    final total = unread.total;
    if (total == _shownBadge) return;
    _shownBadge = total;
    if (total > 0 && !unread.badgeAsked) {
      await unread.setBadgeAsked();
      await widget.badge.requestPermission();
    }
    await widget.badge.update(total);
  }

  /// A tab's icon with its unread count, when it has one.
  Widget _counted(IconData icon, PostFeed feed) {
    final count = widget.unread?.unreadCount(feed) ?? 0;
    return Badge.count(
      key: Key('unread-${feed.name}'),
      count: count,
      isLabelVisible: count > 0,
      child: Icon(icon),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Tablets get the "All" tab (bikes and pizza together, as on the
    // website's front page); phones start at News to keep the bar short.
    final tablet = isTablet(context);
    final newsIndex = tablet ? 1 : 0;
    final pages = <Widget>[
      if (tablet)
        PostListScreen(
          feed: PostFeed.all,
          repository: widget.repository,
          auth: widget.auth,
          photos: widget.photos,
          editor: widget.editor,
          unread: widget.unread,
        ),
      NewsScreen(
        repository: widget.repository,
        auth: widget.auth,
        photos: widget.photos,
        editor: widget.editor,
        unread: widget.unread,
        active: _index.clamp(0, tablet ? 5 : 4) == newsIndex,
      ),
      PostListScreen(
        feed: PostFeed.pizza,
        repository: widget.repository,
        auth: widget.auth,
        submissions: widget.submissions,
        photos: widget.photos,
        members: widget.members,
        editor: widget.editor,
        unread: widget.unread,
      ),
      PostListScreen(
        feed: PostFeed.bikes,
        repository: widget.repository,
        auth: widget.auth,
        submissions: widget.submissions,
        photos: widget.photos,
        members: widget.members,
        editor: widget.editor,
        unread: widget.unread,
      ),
      StoreScreen(
        repository: widget.store,
        auth: widget.auth,
        cart: widget.cart,
      ),
      SettingsScreen(
        auth: widget.auth,
        members: widget.members,
        passkeys: widget.passkeys,
        editor: widget.editor,
        photos: widget.photos,
        admin: widget.admin,
      ),
    ];
    // A window can shrink below tablet width; keep the index in range.
    final index = _index.clamp(0, pages.length - 1);

    return Scaffold(
      body: IndexedStack(index: index, children: pages),
      bottomNavigationBar: ListenableBuilder(
        listenable: widget.unread ?? ValueNotifier<void>(null),
        builder: (context, _) => NavigationBar(
          selectedIndex: index,
          onDestinationSelected: (i) => setState(() => _index = i),
          destinations: [
            if (tablet)
              NavigationDestination(
                icon: _counted(Icons.grid_view_outlined, PostFeed.all),
                selectedIcon: _counted(Icons.grid_view, PostFeed.all),
                label: 'All',
              ),
            NavigationDestination(
              icon: _counted(Icons.newspaper_outlined, PostFeed.news),
              selectedIcon: _counted(Icons.newspaper, PostFeed.news),
              label: 'News',
            ),
            NavigationDestination(
              icon: _counted(Icons.local_pizza_outlined, PostFeed.pizza),
              selectedIcon: _counted(Icons.local_pizza, PostFeed.pizza),
              label: 'Pizza',
            ),
            NavigationDestination(
              icon: _counted(Icons.pedal_bike_outlined, PostFeed.bikes),
              selectedIcon: _counted(Icons.pedal_bike, PostFeed.bikes),
              label: 'Bikes',
            ),
            const NavigationDestination(
              icon: Icon(Icons.storefront_outlined),
              selectedIcon: Icon(Icons.storefront),
              label: 'Store',
            ),
            const NavigationDestination(
              icon: Icon(Icons.settings_outlined),
              selectedIcon: Icon(Icons.settings),
              label: 'Settings',
            ),
          ],
        ),
      ),
    );
  }
}
