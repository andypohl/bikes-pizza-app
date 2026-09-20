import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_functions/cloud_functions.dart';

import '../auth/session_expiry.dart';
import '../models/post_feed.dart';

/// Thrown by [SubmissionService] with a message safe to show to the user.
class SubmissionException implements Exception {
  SubmissionException(this.message, {this.sessionExpired = false});

  final String message;

  /// True when the server no longer accepts the user's session; the UI
  /// should sign out (see `handleSessionExpired`).
  final bool sessionExpired;

  @override
  String toString() => message;
}

/// A photo ready to send: already resized on the device.
class SubmissionPhoto {
  const SubmissionPhoto({
    required this.bytes,
    required this.contentType,
    required this.filename,
  });

  final Uint8List bytes;
  final String contentType;
  final String filename;
}

/// What a member fills in on the submission form.
class Submission {
  const Submission({
    required this.feed,
    required this.title,
    required this.description,
    required this.photo,
    this.extras = const [],
  });

  final PostFeed feed;
  final String title;
  final String description;

  /// The main photo.
  final SubmissionPhoto photo;

  /// Additional pictures, in order (at most `imageMaxExtra`).
  final List<SubmissionPhoto> extras;
}

class SubmissionResult {
  const SubmissionResult({required this.submissionId, required this.notified});

  /// ID of the stored submission awaiting review.
  final String submissionId;

  /// Whether the reviewer was emailed about it.
  final bool notified;
}

/// Sends a member's submission to bikes.pizza for review.
abstract class SubmissionService {
  Future<SubmissionResult> submit(Submission submission);
}

Map<String, String> _encode(SubmissionPhoto photo) => {
  'data': base64Encode(photo.bytes),
  'contentType': photo.contentType,
  'filename': photo.filename,
};

/// [SubmissionService] backed by the `submitPost` Cloud Function.
class CloudFunctionsSubmissionService implements SubmissionService {
  CloudFunctionsSubmissionService({FirebaseFunctions? functions})
    : _functions =
          functions ?? FirebaseFunctions.instanceFor(region: 'us-central1');

  final FirebaseFunctions _functions;

  @override
  Future<SubmissionResult> submit(Submission submission) async {
    try {
      final result = await _functions
          .httpsCallable(
            'submitPost',
            options: HttpsCallableOptions(timeout: const Duration(minutes: 2)),
          )
          .call<Map<String, dynamic>>({
            'feed': submission.feed.name,
            'title': submission.title,
            'description': submission.description,
            'image': _encode(submission.photo),
            'images': [for (final extra in submission.extras) _encode(extra)],
          });
      return SubmissionResult(
        submissionId: result.data['submissionId'] as String? ?? '',
        notified: result.data['notified'] == true,
      );
    } on FirebaseFunctionsException catch (e) {
      if (e.code == 'unauthenticated') {
        throw SubmissionException(sessionExpiredMessage, sessionExpired: true);
      }
      throw SubmissionException(switch (e.code) {
        'failed-precondition' ||
        'invalid-argument' => e.message ?? 'Could not send your submission.',
        'deadline-exceeded' =>
          'That took too long. Check your connection and try again.',
        _ => 'Could not send your submission right now.',
      });
    }
  }
}
