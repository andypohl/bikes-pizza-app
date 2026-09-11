import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// User-adjustable preferences, persisted with shared_preferences.
///
/// The app starts in light mode on every platform rather than following
/// the device, so it looks the same everywhere until the member chooses
/// otherwise under Settings.
class AppSettings extends ChangeNotifier {
  AppSettings({ThemeMode themeMode = defaultThemeMode})
    : _themeMode = themeMode; // ignore: prefer_initializing_formals

  static const defaultThemeMode = ThemeMode.light;

  static const _themeKey = 'theme_mode';

  ThemeMode _themeMode;
  ThemeMode get themeMode => _themeMode;

  /// Restores saved settings from disk. Falls back to defaults if the
  /// preferences store is unavailable for any reason.
  static Future<AppSettings> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_themeKey);
      final mode = ThemeMode.values.firstWhere(
        (m) => m.name == saved,
        orElse: () => defaultThemeMode,
      );
      return AppSettings(themeMode: mode);
    } on Object {
      return AppSettings();
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
