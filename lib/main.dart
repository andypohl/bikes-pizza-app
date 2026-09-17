import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'account/data_export.dart';
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
import 'posts/comment_service.dart';
import 'posts/post_editor.dart';
import 'posts/profile_service.dart';
import 'posts/reaction_service.dart';
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
    reactions: ApiReactionService(api),
    comments: ApiCommentService(api),
    profiles: ApiProfileService(api),
    admin: ApiAdminService(api),
    exporter: ApiDataExporter(api),
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
    this.reactions,
    this.comments,
    this.profiles,
    this.admin,
    this.exporter,
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

  /// Lets signed-in members react to bike and pizza posts (the chips
  /// under a post's details); null shows only the tallies.
  final ReactionService? reactions;

  /// Lets signed-in members read and write comments on bike and pizza
  /// posts, and feeds their mention notices to the unread counters;
  /// null shows only the counts.
  final CommentService? comments;

  /// Opens a member's profile from their username; null leaves usernames
  /// opening the member's post list.
  final ProfileService? profiles;

  /// The review and user administration screens for administrators on
  /// tablets; null hides Settings → Admin.
  final AdminService? admin;

  /// Offers "Export my data" on the account screen; null leaves it out.
  final DataExporter? exporter;

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
            reactions: reactions,
            comments: comments,
            profiles: profiles,
            admin: admin,
            exporter: exporter,
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
    this.reactions,
    this.comments,
    this.profiles,
    this.admin,
    this.exporter,
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
  final ReactionService? reactions;
  final CommentService? comments;
  final ProfileService? profiles;
  final AdminService? admin;
  final DataExporter? exporter;
  final UnreadTracker? unread;
  final AppBadge badge;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  int _index = 0;
  int _shownBadge = -1;
  StreamSubscription<AppUser?>? _users;
  String? _refreshedFor;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.unread?.addListener(_showBadge);
    // Signing in or out changes whose mentions count.
    _users = widget.auth.userChanges.listen((user) {
      if (user?.uid != _refreshedFor) _refreshUnread();
    });
    _refreshUnread();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.unread?.removeListener(_showBadge);
    _users?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refreshUnread();
  }

  /// Refreshes the counters: the changed posts and, for a signed-in
  /// member with the comments service, their mention notices.
  Future<void> _refreshUnread() async {
    final unread = widget.unread;
    if (unread == null) return;
    final comments = widget.comments;
    final user = widget.auth.currentUser;
    _refreshedFor = user?.uid;
    await unread.refresh(
      widget.repository,
      notices: comments != null && user != null && user.emailVerified
          ? (since) => comments.notices(since: since)
          : null,
    );
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
          reactions: widget.reactions,
          comments: widget.comments,
          profiles: widget.profiles,
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
        reactions: widget.reactions,
        comments: widget.comments,
        profiles: widget.profiles,
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
        reactions: widget.reactions,
        comments: widget.comments,
        profiles: widget.profiles,
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
        exporter: widget.exporter,
        profiles: widget.profiles,
        repository: widget.repository,
        reactions: widget.reactions,
        comments: widget.comments,
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
