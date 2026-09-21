import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Which of the two post feeds the member wants to see: the "Show me"
/// slider under Settings, left to right.
enum FeedChoice {
  bikesOnly('Bikes only'),
  both('Bikes + pizza'),
  pizzaOnly('Pizza only');

  const FeedChoice(this.label);

  final String label;

  bool get showsBikes => this != pizzaOnly;
  bool get showsPizza => this != bikesOnly;
}

/// User-adjustable preferences, persisted with shared_preferences.
///
/// The app starts in light mode on every platform rather than following
/// the device, so it looks the same everywhere until the member chooses
/// otherwise under Settings.
class AppSettings extends ChangeNotifier {
  AppSettings({
    ThemeMode themeMode = defaultThemeMode,
    FeedChoice feedChoice = defaultFeedChoice,
  }) : _themeMode = themeMode, // ignore: prefer_initializing_formals
       _feedChoice = feedChoice; // ignore: prefer_initializing_formals

  static const defaultThemeMode = ThemeMode.light;
  static const defaultFeedChoice = FeedChoice.both;

  static const _themeKey = 'theme_mode';
  static const _feedKey = 'show_me';

  ThemeMode _themeMode;
  ThemeMode get themeMode => _themeMode;

  FeedChoice _feedChoice;
  FeedChoice get feedChoice => _feedChoice;

  /// Restores saved settings from disk. Falls back to defaults if the
  /// preferences store is unavailable for any reason.
  static Future<AppSettings> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedTheme = prefs.getString(_themeKey);
      final mode = ThemeMode.values.firstWhere(
        (m) => m.name == savedTheme,
        orElse: () => defaultThemeMode,
      );
      final savedFeed = prefs.getString(_feedKey);
      final feed = FeedChoice.values.firstWhere(
        (f) => f.name == savedFeed,
        orElse: () => defaultFeedChoice,
      );
      return AppSettings(themeMode: mode, feedChoice: feed);
    } on Object {
      return AppSettings();
    }
  }

  Future<void> setFeedChoice(FeedChoice choice) async {
    if (choice == _feedChoice) return;
    _feedChoice = choice;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_feedKey, choice.name);
    } on Object {
      // Persisting is best-effort; the in-memory value already changed.
    }
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    if (mode == _themeMode) return;
    _themeMode = mode;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_themeKey, mode.name);
    } on Object {
      // Persisting is best-effort; the in-memory value already changed.
    }
  }
}

/// Makes [AppSettings] available to the widget tree and rebuilds dependents
/// when it changes.
class AppSettingsScope extends InheritedNotifier<AppSettings> {
  const AppSettingsScope({
    super.key,
    required AppSettings settings,
    required super.child,
  }) : super(notifier: settings);

  static AppSettings of(BuildContext context) {
    final scope = context
        .dependOnInheritedWidgetOfExactType<AppSettingsScope>();
    assert(scope != null, 'No AppSettingsScope found in context');
    return scope!.notifier!;
  }
}
