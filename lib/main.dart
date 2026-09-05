import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'account/member_service.dart';
import 'app_settings.dart';
import 'auth/auth_service.dart';
import 'firebase_options.dart';
import 'firebase_options_dev.dart';
import 'data/post_repository.dart';
import 'models/post_feed.dart';
import 'screens/post_list_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/store_screen.dart';
import 'store/store_repository.dart';
import 'submissions/photo_picker.dart';
import 'submissions/submission_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Release builds (the app stores) talk to the production Firebase project;
  // debug and profile builds (simulators, devices during development) to
  // the development one, bikes-pizza-dev. See docs/firebase.md.
  await Firebase.initializeApp(
    options: kReleaseMode
        ? DefaultFirebaseOptions.currentPlatform
        : DevFirebaseOptions.currentPlatform,
  );
  final settings = await AppSettings.load();
  runApp(
    BikesPizzaApp(
      settings: settings,
      repository: PostRepository.forConfig(),
      store: StoreRepository.forConfig(),
      auth: FirebaseAuthService(),
      members: CloudFunctionsMemberService(),
      submissions: CloudFunctionsSubmissionService(),
      photos: ImagePickerPhotoPicker(),
    ),
  );
}

class BikesPizzaApp extends StatelessWidget {
  const BikesPizzaApp({
    super.key,
    required this.settings,
    required this.repository,
    required this.auth,
    this.store,
    this.members,
    this.submissions,
    this.photos,
  });

  final AppSettings settings;
  final PostRepository repository;
  final AuthService auth;

  /// Null when the build has no Shopify settings; the Store tab then shows
  /// a placeholder.
  final StoreRepository? store;

  /// Null when account management is unavailable; Settings then hides it.
  final MemberService? members;

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
            members: members,
            submissions: submissions,
            photos: photos,
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
    this.members,
    this.submissions,
    this.photos,
  });

  final PostRepository repository;
  final AuthService auth;
  final StoreRepository? store;
  final MemberService? members;
  final SubmissionService? submissions;
  final PhotoPicker? photos;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      PostListScreen(feed: PostFeed.all, repository: widget.repository),
      PostListScreen(feed: PostFeed.blog, repository: widget.repository),
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
      StoreScreen(repository: widget.store, auth: widget.auth),
      SettingsScreen(auth: widget.auth, members: widget.members),
    ];

    return Scaffold(
      body: IndexedStack(index: _index, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.grid_view_outlined),
            selectedIcon: Icon(Icons.grid_view),
            label: 'All',
          ),
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
