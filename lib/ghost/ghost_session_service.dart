import 'package:cloud_functions/cloud_functions.dart';

/// Thrown by [GhostSessionService] with a message safe to show to the user.
class GhostSessionException implements Exception {
  GhostSessionException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// Turns the signed-in Firebase user into a signed-in Ghost member.
///
/// The heavy lifting happens in the `ghostSignInUrl` Cloud Function, which
/// verifies the Firebase user, finds or creates the matching Ghost member,
/// and returns a one-time sign-in URL for the website.
abstract class GhostSessionService {
  /// Returns a URL that, when opened, signs the current user in on the site.
  ///
  /// [redirectTo] is an optional path on the site to land on afterwards.
  Future<Uri> signInUrl({String? redirectTo});
}

/// [GhostSessionService] backed by Cloud Functions for Firebase.
class CloudFunctionsGhostSessionService implements GhostSessionService {
  CloudFunctionsGhostSessionService({FirebaseFunctions? functions})
    : _functions =
          functions ?? FirebaseFunctions.instanceFor(region: 'us-central1');

  final FirebaseFunctions _functions;

  @override
  Future<Uri> signInUrl({String? redirectTo}) async {
    try {
      final result = await _functions
          .httpsCallable('ghostSignInUrl')
          .call<Map<String, dynamic>>({'redirectTo': ?redirectTo});
      final url = result.data['url'];
      final uri = url is String ? Uri.tryParse(url) : null;
      if (uri == null) {
        throw GhostSessionException(
          'The website did not return a sign-in link.',
        );
      }
      return uri;
    } on FirebaseFunctionsException catch (e) {
      throw GhostSessionException(switch (e.code) {
        'unauthenticated' => 'Sign in first.',
        'failed-precondition' || 'invalid-argument' =>
          e.message ?? 'Could not sign you in on the website.',
        _ => 'Could not sign you in on the website right now.',
      });
    }
  }
}
