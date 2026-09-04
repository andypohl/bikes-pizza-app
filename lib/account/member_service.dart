import 'package:cloud_functions/cloud_functions.dart';

/// Thrown by [MemberService] with a message safe to show to the user.
class MemberException implements Exception {
  MemberException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// One of the site's newsletters and whether the member receives it.
class Newsletter {
  const Newsletter({
    required this.id,
    required this.name,
    this.description = '',
    this.subscribed = false,
  });

  final String id;
  final String name;
  final String description;
  final bool subscribed;
}

/// The member's profile as the account screen shows it.
class MemberProfile {
  const MemberProfile({
    required this.email,
    this.name = '',
    this.newsletters = const [],
  });

  final String email;
  final String name;
  final List<Newsletter> newsletters;

  factory MemberProfile.fromJson(Map<String, dynamic> json) {
    final newsletters = json['newsletters'];
    return MemberProfile(
      email: json['email'] as String? ?? '',
      name: json['name'] as String? ?? '',
      newsletters: [
        if (newsletters is List)
          for (final n in newsletters.whereType<Map>())
            Newsletter(
              id: n['id'] as String,
              name: n['name'] as String? ?? '',
              description: n['description'] as String? ?? '',
              subscribed: n['subscribed'] == true,
            ),
      ],
    );
  }
}

/// Reads and updates the Ghost member behind the signed-in Firebase user.
///
/// The work happens in the `ghostMember` and `updateGhostMember` Cloud
/// Functions, which resolve the member through the Firestore link and talk
/// to the Ghost Admin API.
abstract class MemberService {
  Future<MemberProfile> load();

  /// Changes the name and/or the full set of newsletter IDs the member
  /// receives. Returns the updated profile.
  Future<MemberProfile> update({String? name, List<String>? newsletters});
}

/// [MemberService] backed by Cloud Functions for Firebase.
class CloudFunctionsMemberService implements MemberService {
  CloudFunctionsMemberService({FirebaseFunctions? functions})
    : _functions =
          functions ?? FirebaseFunctions.instanceFor(region: 'us-central1');

  final FirebaseFunctions _functions;

  @override
  Future<MemberProfile> load() => _call('ghostMember', const {});

  @override
  Future<MemberProfile> update({String? name, List<String>? newsletters}) =>
      _call('updateGhostMember', {'name': ?name, 'newsletters': ?newsletters});

  Future<MemberProfile> _call(String name, Map<String, Object?> data) async {
    try {
      final result = await _functions
          .httpsCallable(name)
          .call<Map<String, dynamic>>(data);
      return MemberProfile.fromJson(result.data);
    } on FirebaseFunctionsException catch (e) {
      throw MemberException(switch (e.code) {
        'unauthenticated' => 'Sign in first.',
        'failed-precondition' ||
        'invalid-argument' => e.message ?? 'Could not update your account.',
        _ => 'Could not reach your account right now.',
      });
    }
  }
}
