/// Static configuration for talking to the Ghost site behind pizzapredator.com.
///
/// The Ghost Content API key is supplied at build time so it never has to be
/// committed to source control:
///
///   flutter run --dart-define=GHOST_CONTENT_API_KEY=your_key_here
///
/// Create a key in Ghost Admin: Settings -> Integrations -> Add custom
/// integration, then copy the "Content API key". When no key is provided the
/// app falls back to the site's public RSS feeds, which only expose the 15
/// most recent posts per feed.
class GhostConfig {
  GhostConfig._();

  /// Canonical site origin. The apex domain 301-redirects here.
  static const String siteUrl = 'https://www.pizzapredator.com';

  static const String contentApiKey =
      String.fromEnvironment('GHOST_CONTENT_API_KEY');

  static bool get hasContentApiKey => contentApiKey.isNotEmpty;

  /// Posts fetched per page from the Content API.
  static const int pageSize = 15;
}
