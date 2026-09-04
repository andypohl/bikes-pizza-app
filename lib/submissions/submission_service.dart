import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_functions/cloud_functions.dart';

import '../models/post_feed.dart';

/// Thrown by [SubmissionService] with a message safe to show to the user.
class SubmissionException implements Exception {
  SubmissionException(this.message);

  final String message;

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
    required this.from,
    required this.description,
    required this.photo,
  });

  final PostFeed feed;
  final String title;
  final String from;
  final String description;
  final SubmissionPhoto photo;
}

class SubmissionResult {
  const SubmissionResult({required this.postId, required this.notified});

  /// ID of the draft post created in Ghost.
  final String postId;

  /// Whether the author was emailed about it.
  final bool notified;
}

/// Sends a member's submission to the blog as a draft post.
abstract class SubmissionService {
  Future<SubmissionResult> submit(Submission submission);
}

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
            'from': submission.from,
            'description': submission.description,
            'image': {
              'data': base64Encode(submission.photo.bytes),
              'contentType': submission.photo.contentType,
              'filename': submission.photo.filename,
            },
          });
      return SubmissionResult(
        postId: result.data['postId'] as String? ?? '',
        notified: result.data['notified'] == true,
      );
    } on FirebaseFunctionsException catch (e) {
      throw SubmissionException(switch (e.code) {
        'unauthenticated' => 'Sign in first.',
        'failed-precondition' ||
        'invalid-argument' => e.message ?? 'Could not send your submission.',
        'deadline-exceeded' =>
          'That took too long. Check your connection and try again.',
        _ => 'Could not send your submission right now.',
      });
    }
  }
}
