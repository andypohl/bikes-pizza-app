import 'package:shared_preferences/shared_preferences.dart';

/// What a new member chose while creating a password account: their
/// username and whether they want the newsletter.
///
/// The member functions only accept users with a verified email, so these
/// choices wait on the device until the email is verified, then
/// [AccountSetup.applyPending] sends them.
class PendingProfile {
  const PendingProfile({required this.username, required this.newsletter});

  final String username;
  final bool newsletter;

  static String _usernameKey(String uid) => 'pendingProfile.$uid.username';
  static String _newsletterKey(String uid) => 'pendingProfile.$uid.newsletter';

  Future<void> save(String uid) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_usernameKey(uid), username);
    await prefs.setBool(_newsletterKey(uid), newsletter);
  }

  /// The choices saved for [uid], removed from the device once read.
  static Future<PendingProfile?> take(String uid) async {
    final prefs = await SharedPreferences.getInstance();
    final username = prefs.getString(_usernameKey(uid));
    if (username == null) return null;
    final newsletter = prefs.getBool(_newsletterKey(uid)) ?? true;
    await prefs.remove(_usernameKey(uid));
    await prefs.remove(_newsletterKey(uid));
    return PendingProfile(username: username, newsletter: newsletter);
  }
}
