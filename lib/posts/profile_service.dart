import '../api/api_client.dart';

/// A member's public profile (`GET /api/members/{username}` in
/// docs/api.md): when they joined, the location they chose to share,
/// how many pizzas and bikes they have posted, and whether the viewer
/// may message them.
class PublicProfile {
  const PublicProfile({
    required this.uid,
    required this.username,
    this.joinedAt,
    this.location = '',
    this.counts = const {},
    this.messages = false,
  });

  final String uid;
  final String username;
  final DateTime? joinedAt;
  final String location;

  /// Published posts per feed value (`pizza`, `bikes`).
  final Map<String, int> counts;
  final bool messages;

  int count(String feed) => counts[feed] ?? 0;

  factory PublicProfile.fromJson(Map<String, dynamic> json) {
    final counts = json['counts'];
    return PublicProfile(
      uid: json['uid'] as String? ?? '',
      username: json['username'] as String? ?? '',
      joinedAt: DateTime.tryParse(json['joinedAt'] as String? ?? ''),
      location: json['location'] as String? ?? '',
      counts: {
        if (counts is Map)
          for (final e in counts.entries)
            if (e.value is num) e.key.toString(): (e.value as num).toInt(),
      },
      messages: json['messages'] == true,
    );
  }
}

/// Reads public profiles; the real one calls the REST API, tests use an
/// in-memory fake. Failures are [ApiException]s.
abstract class ProfileService {
  Future<PublicProfile> fetch(String username);
}

/// [ProfileService] over the REST API. The endpoint is public, so the
/// request goes out with the member's token when there is one and
/// without it otherwise.
class ApiProfileService implements ProfileService {
  ApiProfileService(this._api);

  final ApiClient _api;

  @override
  Future<PublicProfile> fetch(String username) async => PublicProfile.fromJson(
    await _api.get(
      '/members/${Uri.encodeComponent(username)}',
      optionalAuth: true,
    ),
  );
}
