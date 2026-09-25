import '../api/api_client.dart';

/// What a member says when reporting a concern: what it is about
/// ([kind], a value from the contract's `concernKinds`), which post or
/// member ([target], free text: a link, a title or a username; empty for
/// "something else"), why ([reason], from `concernReasons`) and anything
/// more ([details]).
class ConcernReport {
  const ConcernReport({
    required this.kind,
    required this.reason,
    this.target = '',
    this.details = '',
  });

  final String kind;
  final String reason;
  final String target;
  final String details;

  Map<String, dynamic> toJson() => {
    'kind': kind,
    'reason': reason,
    'target': target,
    'details': details,
  };
}

/// Sends a member's report of a concern to the moderators. The Report
/// actions on comments and conversations cover those; this is for a post,
/// a member, or anything else, child safety concerns included.
abstract class ConcernService {
  Future<void> report(ConcernReport report);
}

/// [ConcernService] over the REST API (`POST /api/concerns`).
class ApiConcernService implements ConcernService {
  ApiConcernService(this._api);

  final ApiClient _api;

  @override
  Future<void> report(ConcernReport report) =>
      _api.post('/concerns', body: report.toJson());
}
