import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'account/member_service.dart';
import 'app_settings.dart';
import 'auth/auth_service.dart';
import 'auth/passkey_service.dart';
import 'firebase_options.dart';
import 'firebase_options_dev.dart';
import 'data/post_repository.dart';
import 'models/post_feed.dart';
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
  return BikesPizzaApp(
    settings: settings,
    repository: PostRepository.forConfig(),
    store: StoreRepository.forConfig(),
    cart: cart,
    auth: FirebaseAuthService(),
    members: CloudFunctionsMemberService(),
    passkeys: FirebasePasskeyService(),
    submissions: CloudFunctionsSubmissionService(),
    photos: ImagePickerPhotoPicker(),
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
  });

  final PostRepository repository;
  final AuthService auth;
  final StoreRepository store;
  final Cart cart;
  final MemberService? members;
  final PasskeyService? passkeys;
  final SubmissionService? submissions;
  final PhotoPicker? photos;

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
        PostListScreen(feed: PostFeed.all, repository: widget.repository),
      NewsScreen(repository: widget.repository),
      PostListScreen(
        feed: PostFeed.pizza,
        repository: widget.repository,
        auth: widget.auth,
        submissions: widget.submissions,
        photos: widget.photos,
        members: widget.members,
      ),
      PostListScreen(
        feed: PostFeed.bikes,
        repository: widget.repository,
        auth: widget.auth,
        submissions: widget.submissions,
        photos: widget.photos,
        members: widget.members,
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
