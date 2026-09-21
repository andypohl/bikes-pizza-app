import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'account/data_export.dart';
import 'account/member_service.dart';
import 'admin/admin_screen.dart';
import 'admin/admin_service.dart';
import 'api/api_client.dart';
import 'app_settings.dart';
import 'config.dart';
import 'auth/auth_service.dart';
import 'auth/passkey_service.dart';
import 'firebase_options.dart';
import 'firebase_options_dev.dart';
import 'messages/message_tracker.dart';
import 'messages/thread_service.dart';
import 'data/firestore_post_repository.dart';
import 'data/post_repository.dart';
import 'models/post_feed.dart';
import 'posts/app_badge.dart';
import 'posts/comment_service.dart';
import 'posts/post_editor.dart';
import 'posts/profile_service.dart';
import 'posts/reaction_service.dart';
import 'posts/search_service.dart';
import 'posts/unread_tracker.dart';
import 'screens/news_screen.dart';
import 'screens/post_list_screen.dart';
import 'screens/search_screen.dart';
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
  final threads = LiveThreadService(api, auth);
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
    search: ApiSearchService(api, siteUrl: SiteConfig.siteUrl),
    threads: threads,
    messages: MessageTracker(service: threads, auth: auth),
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
    this.search,
    this.threads,
    this.messages,
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

  /// The Search tab; null leaves it out of the bottom bar.
  final SearchService? search;

  /// Direct messages: the Messages button on the feed screens, the
  /// Message button on profiles and the thread screens; null hides them.
  /// [messages] follows the threads for the badges.
  final ThreadService? threads;
  final MessageTracker? messages;

  /// The review and user administration screens for administrators; null
  /// hides the Admin tab.
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
            search: search,
            threads: threads,
            messages: messages,
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

/// Root screen: a bottom navigation bar switching between Search, the
/// post feeds (News, Pizza and Bikes, plus All on tablets), the Store,
/// Settings and, for administrators, Admin. The app opens on the first
/// feed tab, not on Search.
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
    this.search,
    this.threads,
    this.messages,
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
  final SearchService? search;
  final ThreadService? threads;
  final MessageTracker? messages;
  final AdminService? admin;
  final DataExporter? exporter;
  final UnreadTracker? unread;
  final AppBadge badge;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

/// The tabs of the bottom bar, in order. Which ones are present depends
/// on the device (All on tablets), the services wired in (Search, Admin)
/// and the member's "Show me" setting (Pizza, Bikes).
enum _Tab { search, all, news, pizza, bikes, store, settings, admin }

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  /// The tab chosen, or null until one is: the app opens on the first
  /// feed tab (All on a tablet, News on a phone), not on Search.
  _Tab? _tab;
  int _shownBadge = -1;
  StreamSubscription<AppUser?>? _users;
  String? _refreshedFor;

  /// Whether the signed-in account is an administrator, which adds the
  /// Admin tab; checked once per account.
  bool _admin = false;
  String? _adminFor;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.unread?.addListener(_showBadge);
    widget.messages?.addListener(_showBadge);
    // Signing in or out changes whose mentions count.
    _users = widget.auth.userChanges.listen((user) {
      if (user?.uid != _refreshedFor) _refreshUnread();
      _checkAdmin(user);
    });
    _refreshUnread();
    _checkAdmin(widget.auth.currentUser);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.unread?.removeListener(_showBadge);
    widget.messages?.removeListener(_showBadge);
    _users?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refreshUnread();
  }

  /// Looks up the admin claim when a different account signs in, and
  /// drops the tab when the account signs out.
  Future<void> _checkAdmin(AppUser? user) async {
    if (widget.admin == null) return;
    if (user == null) {
      _adminFor = null;
      if (_admin && mounted) setState(() => _admin = false);
      return;
    }
    if (user.uid == _adminFor) return;
    _adminFor = user.uid;
    final admin = await widget.auth.isAdmin();
    if (mounted && _adminFor == user.uid && admin != _admin) {
      setState(() => _admin = admin);
    }
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

  /// Puts the unread total (posts plus messages) on the app icon; the
  /// first time there is one, asks for the permission that needs (iOS).
  Future<void> _showBadge() async {
    final unread = widget.unread;
    if (unread == null) return;
    final total = unread.total + (widget.messages?.unread ?? 0);
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
    final admin = _admin ? widget.admin : null;
    final search = widget.search;
    final choice = AppSettingsScope.of(context).feedChoice;
    final home = tablet ? _Tab.all : _Tab.news;
    final tabs = <_Tab>[
      if (search != null) _Tab.search,
      if (tablet) _Tab.all,
      _Tab.news,
      if (choice.showsPizza) _Tab.pizza,
      if (choice.showsBikes) _Tab.bikes,
      _Tab.store,
      _Tab.settings,
      if (admin != null) _Tab.admin,
    ];
    // A window can shrink below tablet width, or a feed be switched off
    // while shown; then the app falls back to the home tab.
    final selected = tabs.contains(_tab) ? _tab! : home;
    final index = tabs.indexOf(selected);

    Widget page(_Tab tab) => switch (tab) {
      _Tab.search => SearchScreen(
        search: search!,
        repository: widget.repository,
        auth: widget.auth,
        reactions: widget.reactions,
        comments: widget.comments,
        profiles: widget.profiles,
        threads: widget.threads,
        editor: widget.editor,
        photos: widget.photos,
        unread: widget.unread,
      ),
      _Tab.all => PostListScreen(
        feed: PostFeed.all,
        repository: widget.repository,
        auth: widget.auth,
        photos: widget.photos,
        editor: widget.editor,
        reactions: widget.reactions,
        comments: widget.comments,
        profiles: widget.profiles,
        threads: widget.threads,
        messages: widget.messages,
        unread: widget.unread,
      ),
      _Tab.news => NewsScreen(
        repository: widget.repository,
        auth: widget.auth,
        photos: widget.photos,
        editor: widget.editor,
        unread: widget.unread,
        active: selected == _Tab.news,
      ),
      _Tab.pizza || _Tab.bikes => PostListScreen(
        feed: tab == _Tab.pizza ? PostFeed.pizza : PostFeed.bikes,
        repository: widget.repository,
        auth: widget.auth,
        submissions: widget.submissions,
        photos: widget.photos,
        editor: widget.editor,
        reactions: widget.reactions,
        comments: widget.comments,
        profiles: widget.profiles,
        threads: widget.threads,
        messages: widget.messages,
        unread: widget.unread,
      ),
      _Tab.store => StoreScreen(
        repository: widget.store,
        auth: widget.auth,
        cart: widget.cart,
      ),
      _Tab.settings => SettingsScreen(
        auth: widget.auth,
        members: widget.members,
        passkeys: widget.passkeys,
        editor: widget.editor,
        photos: widget.photos,
        exporter: widget.exporter,
        profiles: widget.profiles,
        repository: widget.repository,
        reactions: widget.reactions,
        comments: widget.comments,
        threads: widget.threads,
        messages: widget.messages,
      ),
      _Tab.admin => AdminScreen(auth: widget.auth, admin: admin!),
    };

    NavigationDestination destination(_Tab tab) => switch (tab) {
      _Tab.search => const NavigationDestination(
        key: Key('tab-search'),
        icon: Icon(Icons.search_outlined),
        selectedIcon: Icon(Icons.search),
        label: 'Search',
      ),
      _Tab.all => NavigationDestination(
        icon: _counted(Icons.grid_view_outlined, PostFeed.all),
        selectedIcon: _counted(Icons.grid_view, PostFeed.all),
        label: 'All',
      ),
      _Tab.news => NavigationDestination(
        icon: _counted(Icons.newspaper_outlined, PostFeed.news),
        selectedIcon: _counted(Icons.newspaper, PostFeed.news),
        label: 'News',
      ),
      _Tab.pizza => NavigationDestination(
        key: const Key('tab-pizza'),
        icon: _counted(Icons.local_pizza_outlined, PostFeed.pizza),
        selectedIcon: _counted(Icons.local_pizza, PostFeed.pizza),
        label: 'Pizza',
      ),
      _Tab.bikes => NavigationDestination(
        key: const Key('tab-bikes'),
        icon: _counted(Icons.pedal_bike_outlined, PostFeed.bikes),
        selectedIcon: _counted(Icons.pedal_bike, PostFeed.bikes),
        label: 'Bikes',
      ),
      _Tab.store => const NavigationDestination(
        icon: Icon(Icons.storefront_outlined),
        selectedIcon: Icon(Icons.storefront),
        label: 'Store',
      ),
      _Tab.settings => const NavigationDestination(
        icon: Icon(Icons.settings_outlined),
        selectedIcon: Icon(Icons.settings),
        label: 'Settings',
      ),
      _Tab.admin => const NavigationDestination(
        key: Key('tab-admin'),
        icon: Icon(Icons.admin_panel_settings_outlined),
        selectedIcon: Icon(Icons.admin_panel_settings),
        label: 'Admin',
      ),
    };

    return Scaffold(
      // Keyed by tab so a page keeps its state when a neighbour is hidden.
      body: IndexedStack(
        index: index,
        children: [
          for (final tab in tabs)
            KeyedSubtree(key: ValueKey(tab), child: page(tab)),
        ],
      ),
      bottomNavigationBar: ListenableBuilder(
        listenable: widget.unread ?? ValueNotifier<void>(null),
        builder: (context, _) => NavigationBar(
          selectedIndex: index,
          onDestinationSelected: (i) => setState(() => _tab = tabs[i]),
          destinations: [for (final tab in tabs) destination(tab)],
        ),
      ),
    );
  }
}
