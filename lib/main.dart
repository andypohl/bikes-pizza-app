import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'app_settings.dart';
import 'auth/auth_service.dart';
import 'ghost/ghost_session_service.dart';
import 'firebase_options.dart';
import 'data/post_repository.dart';
import 'models/post_feed.dart';
import 'screens/post_list_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/store_screen.dart';
import 'store/store_repository.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  final settings = await AppSettings.load();
  runApp(
    PizzaPredatorApp(
      settings: settings,
      repository: PostRepository.forConfig(),
      store: StoreRepository.forConfig(),
      auth: FirebaseAuthService(),
      ghost: CloudFunctionsGhostSessionService(),
    ),
  );
}

class PizzaPredatorApp extends StatelessWidget {
  const PizzaPredatorApp({
    super.key,
    required this.settings,
    required this.repository,
    required this.auth,
    this.store,
    this.ghost,
  });

  final AppSettings settings;
  final PostRepository repository;
  final AuthService auth;

  /// Null when the build has no Shopify settings; the Store tab then shows
  /// a placeholder.
  final StoreRepository? store;

  /// Null when website sign-in is unavailable; Settings then hides the tile.
  final GhostSessionService? ghost;

  static const _seed = Color(0xFFD62828); // tomato-sauce red

  @override
  Widget build(BuildContext context) {
    return AppSettingsScope(
      settings: settings,
      child: ListenableBuilder(
        listenable: settings,
        builder: (context, _) => MaterialApp(
          title: 'Pizza Predator',
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
            ghost: ghost,
          ),
        ),
      ),
    );
  }
}

/// Root screen: a bottom navigation bar switching between the three post
/// feeds, the Store, and Settings. Each tab keeps its scroll position and loaded data
/// because the pages live in an [IndexedStack].
class HomeShell extends StatefulWidget {
  const HomeShell({
    super.key,
    required this.repository,
    required this.auth,
    this.store,
    this.ghost,
  });

  final PostRepository repository;
  final AuthService auth;
  final StoreRepository? store;
  final GhostSessionService? ghost;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      PostListScreen(feed: PostFeed.blog, repository: widget.repository),
      PostListScreen(feed: PostFeed.pizza, repository: widget.repository),
      PostListScreen(feed: PostFeed.bikes, repository: widget.repository),
      StoreScreen(repository: widget.store, auth: widget.auth),
      SettingsScreen(
        repository: widget.repository,
        auth: widget.auth,
        ghost: widget.ghost,
      ),
    ];

    return Scaffold(
      body: IndexedStack(index: _index, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.article_outlined),
            selectedIcon: Icon(Icons.article),
            label: 'Blog',
          ),
          NavigationDestination(
            icon: Icon(Icons.local_pizza_outlined),
            selectedIcon: Icon(Icons.local_pizza),
            label: 'Pizza',
          ),
          NavigationDestination(
            icon: Icon(Icons.pedal_bike_outlined),
            selectedIcon: Icon(Icons.pedal_bike),
            label: 'Bikes',
          ),
          NavigationDestination(
            icon: Icon(Icons.storefront_outlined),
            selectedIcon: Icon(Icons.storefront),
            label: 'Store',
          ),
          NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings),
            label: 'Settings',
          ),
        ],
      ),
    );
  }
}
