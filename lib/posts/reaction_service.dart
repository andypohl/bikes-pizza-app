import '../api/api_client.dart';
import '../contract.dart';

/// Who picked one option: some of their usernames (up to ten, chosen at
/// random by the server) and how many more did, named or not.
class ReactionNames {
  const ReactionNames({this.names = const [], this.more = 0});

  final List<String> names;
  final int more;

  bool get isEmpty => names.isEmpty && more == 0;

  /// "ada_bikes, bob_pizza and 3 more", or null when nobody picked it.
  String? get line {
    if (isEmpty) return null;
    if (names.isEmpty) return more == 1 ? '1 member' : '$more members';
    final listed = names.join(', ');
    return more == 0 ? listed : '$listed and $more more';
  }

  static ReactionNames? fromJson(Object? json) {
    if (json is! Map) return null;
    final names = json['names'];
    return ReactionNames(
      names: names is List ? [for (final n in names) n.toString()] : const [],
      more: (json['more'] as num?)?.toInt() ?? 0,
    );
  }
}

/// A post's reactions as the API reports them: the tallies of every
/// option of every palette the post's feed has, the signed-in member's
/// own picks (palette key to chosen values), and who picked each option.
class PostReactions {
  const PostReactions({
    this.counts = const {},
    this.mine = const {},
    this.who = const {},
  });

  final Map<String, Map<String, int>> counts;
  final Map<String, List<String>> mine;
  final Map<String, Map<String, ReactionNames>> who;

  /// How many members picked [value] in the palette [key].
  int count(String key, String value) => counts[key]?[value] ?? 0;

  /// Whether the member's picks for [key] include [value].
  bool picked(String key, String value) => mine[key]?.contains(value) ?? false;

  /// Who picked [value] in the palette [key], once the server has said.
  ReactionNames? names(String key, String value) => who[key]?[value];

  factory PostReactions.fromJson(Map<String, dynamic> json) => PostReactions(
    counts: parseCounts(json['counts']),
    mine: {
      if (json['mine'] is Map)
        for (final entry in (json['mine'] as Map).entries)
          if (entry.value is List)
            entry.key.toString(): [
              for (final v in entry.value as List) v.toString(),
            ],
    },
    who: {
      if (json['who'] is Map)
        for (final palette in (json['who'] as Map).entries)
          if (palette.value is Map)
            palette.key.toString(): {
              for (final option in (palette.value as Map).entries)
                option.key.toString(): ?ReactionNames.fromJson(option.value),
            },
    },
  );

  /// Tallies from a post document or an API reply: palette key to option
  /// value to count. Anything that is not a number is left out.
  static Map<String, Map<String, int>> parseCounts(Object? json) => {
    if (json is Map)
      for (final palette in json.entries)
        if (palette.value is Map)
          palette.key.toString(): {
            for (final option in (palette.value as Map).entries)
              if (option.value is num)
                option.key.toString(): (option.value as num).toInt(),
          },
  };

  /// These reactions with the member's picks for [palette] replaced by
  /// [values] and the tallies moved to match, for showing a tap before
  /// the server answers. The names are left as they were; the server's
  /// answer brings the new ones.
  PostReactions withPicks(ReactionPalette palette, List<String> values) {
    final before = mine[palette.key] ?? const [];
    final counts = {
      for (final e in this.counts.entries) e.key: Map<String, int>.of(e.value),
    };
    final tally = counts.putIfAbsent(palette.key, () => {});
    for (final v in before) {
      if (!values.contains(v)) {
        tally[v] = ((tally[v] ?? 0) - 1).clamp(0, 1 << 30);
      }
    }
    for (final v in values) {
      if (!before.contains(v)) tally[v] = (tally[v] ?? 0) + 1;
    }
    return PostReactions(
      counts: counts,
      mine: {...mine, palette.key: values},
      who: who,
    );
  }
}

/// Reads and records a member's reactions to a post; the real one calls
/// the REST API, tests use an in-memory fake.
abstract class ReactionService {
  /// The post's tallies and the signed-in member's picks.
  Future<PostReactions> fetch(String postId);

  /// Replaces the member's picks on the post ([picks]: palette key to
  /// chosen values) and returns the reactions as they now stand.
  Future<PostReactions> set(String postId, Map<String, List<String>> picks);
}

/// [ReactionService] over the REST API (`/api/posts/{id}/reactions`).
class ApiReactionService implements ReactionService {
  ApiReactionService(this._api);

  final ApiClient _api;

  String _path(String postId) =>
      '/posts/${Uri.encodeComponent(postId)}/reactions';

  @override
  Future<PostReactions> fetch(String postId) async =>
      PostReactions.fromJson(await _api.get(_path(postId)));

  @override
  Future<PostReactions> set(
    String postId,
    Map<String, List<String>> picks,
  ) async => PostReactions.fromJson(
    await _api.post(_path(postId), body: {'picks': picks}),
  );
}
