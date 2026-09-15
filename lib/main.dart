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
import 'data/post_repository.dart';
import 'models/post_feed.dart';
import 'posts/post_editor.dart';
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
  final auth = FirebaseAuthService();
  // The REST API (editing posts) signs its requests with the same session.
  final api = ApiClient(baseUrl: ApiConfig.baseUrl, token: auth.idToken);
  return BikesPizzaApp(
    settings: settings,
    repository: PostRepository.forConfig(),
    store: StoreRepository.forConfig(),
    cart: cart,
    auth: auth,
    members: CloudFunctionsMemberService(),
    passkeys: FirebasePasskeyService(),
    submissions: CloudFunctionsSubmissionService(),
    photos: ImagePickerPhotoPicker(),
    editor: ApiPostEditor(api),
    admin: ApiAdminService(api),
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
          ),
        ),
      ),
    );
  }
}

/// Root screen: a bottom navigation bar switching between the post feeds
/// (News, Pizza and Bikes, plus All on tablets), the Store, and Settings.
/// Each tab keeps its scroll position and loaded data because the pages
/// live in an [IndexedStack].
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

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    // Tablets get the "All" tab (bikes and pizza together, as on the
    // website's front page); phones start at News to keep the bar short.
    final tablet = isTablet(context);
    final pages = <Widget>[
      if (tablet)
        PostListScreen(
          feed: PostFeed.all,
          repository: widget.repository,
          auth: widget.auth,
          photos: widget.photos,
          editor: widget.editor,
        ),
      NewsScreen(
        repository: widget.repository,
        auth: widget.auth,
        photos: widget.photos,
        editor: widget.editor,
      ),
      PostListScreen(
        feed: PostFeed.pizza,
        repository: widget.repository,
        auth: widget.auth,
        submissions: widget.submissions,
        photos: widget.photos,
        members: widget.members,
        editor: widget.editor,
      ),
      PostListScreen(
        feed: PostFeed.bikes,
        repository: widget.repository,
        auth: widget.auth,
        submissions: widget.submissions,
        photos: widget.photos,
        members: widget.members,
        editor: widget.editor,
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
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          if (tablet)
            const NavigationDestination(
              icon: Icon(Icons.grid_view_outlined),
              selectedIcon: Icon(Icons.grid_view),
              label: 'All',
            ),
          const NavigationDestination(
            icon: Icon(Icons.newspaper_outlined),
            selectedIcon: Icon(Icons.newspaper),
            label: 'News',
          ),
          const NavigationDestination(
            icon: Icon(Icons.local_pizza_outlined),
            selectedIcon: Icon(Icons.local_pizza),
            label: 'Pizza',
          ),
          const NavigationDestination(
            icon: Icon(Icons.pedal_bike_outlined),
            selectedIcon: Icon(Icons.pedal_bike),
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
    );
  }
}
