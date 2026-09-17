import 'dart:convert';

import '../api/api_client.dart';
import '../models/post.dart';
import '../submissions/submission_service.dart';

/// One of the member's posts, as listed under Settings → Posts.
class PostSummary {
  const PostSummary({
    required this.id,
    required this.title,
    required this.feed,
    required this.url,
    required this.publishedAt,
    this.image,
  });

  /// The slug, which the edit endpoints take.
  final String id;
  final String title;

  /// `bikes`, `pizza` or `news`.
  final String feed;
  final String? url;
  final DateTime publishedAt;

  /// The main photo, if the post has one.
  final PostImage? image;

  factory PostSummary.fromJson(Map<String, dynamic> json) {
    return PostSummary(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '(untitled)',
      feed: json['feed'] as String? ?? '',
      url: json['url'] as String?,
      publishedAt:
          DateTime.tryParse(json['publishedAt'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0),
      image: PostImage.fromJson(json['image']),
    );
  }
}

/// A post as its editor sees it: what the edit form starts from.
class EditablePost {
  const EditablePost({
    required this.id,
    required this.title,
    required this.feed,
    required this.url,
    required this.publishedAt,
    this.image,
    this.images = const [],
    this.story = '',
    this.storyHasFormatting = false,
    this.bike,
    this.pizza,
    this.pendingEditId,
    this.commentsEnabled = true,
  });

  final String id;
  final String title;
  final String feed;
  final String? url;
  final DateTime publishedAt;
  final PostImage? image;

  /// False when comments are switched off on the post.
  final bool commentsEnabled;

  /// The additional pictures, in order.
  final List<PostImage> images;

  /// The body as plain text, one paragraph per blank line.
  final String story;

  /// True when the body holds more than plain paragraphs; saving a new
  /// story then replaces that formatting with plain paragraphs.
  final bool storyHasFormatting;

  /// The details, every field present, on a bike or a pizza post.
  final BikeDetails? bike;
  final PizzaDetails? pizza;

  /// The submission id of an edit of this post that is waiting for
  /// review; a member cannot send another until it is reviewed.
  final String? pendingEditId;

  bool get hasPendingEdit => pendingEditId != null;

  factory EditablePost.fromJson(Map<String, dynamic> json) {
    final summary = PostSummary.fromJson(json);
    final bike = json['bike'];
    final pizza = json['pizza'];
    return EditablePost(
      id: summary.id,
      title: summary.title,
      feed: summary.feed,
      url: summary.url,
      publishedAt: summary.publishedAt,
      image: summary.image,
      images: [
        if (json['images'] is List)
          for (final item in json['images'] as List) ?PostImage.fromJson(item),
      ],
      story: json['story'] as String? ?? '',
      storyHasFormatting: json['storyHasFormatting'] == true,
      bike: bike is Map ? BikeDetails.fromJson(bike) : null,
      pizza: pizza is Map ? PizzaDetails.fromJson(pizza) : null,
      pendingEditId: json['pendingEdit'] is Map
          ? (json['pendingEdit'] as Map)['id'] as String?
          : null,
      commentsEnabled: json['commentsEnabled'] != false,
    );
  }
}

/// What came of saving an edit: applied to the post at once (an
/// administrator's edit; [post] is the post as it now reads), or stored
/// for review (a member's; [submissionId] names the pending submission).
class EditOutcome {
  const EditOutcome.applied(EditablePost this.post) : submissionId = null;

  const EditOutcome.pending(String this.submissionId) : post = null;

  final EditablePost? post;
  final String? submissionId;

  bool get isPending => submissionId != null;

  factory EditOutcome.fromJson(Map<String, dynamic> json) {
    final post = json['post'];
    if (json['status'] == 'applied' && post is Map<String, dynamic>) {
      return EditOutcome.applied(EditablePost.fromJson(post));
    }
    return EditOutcome.pending(json['submissionId'] as String? ?? '');
  }
}

/// One entry of an edit's additional pictures: a picture the post keeps
/// (sent back by its rendition version) or a new one chosen on the device.
sealed class AdditionalPicture {
  const AdditionalPicture();
}

class KeptPicture extends AdditionalPicture {
  const KeptPicture(this.image);

  final PostImage image;
}

class NewPicture extends AdditionalPicture {
  const NewPicture(this.photo);

  final SubmissionPhoto photo;
}

/// The changes to send: only the fields set are changed. [bike] and
/// [pizza] replace the post's details as a whole, and [pictures] the
/// additional pictures as a whole, in the order given. [comments]
/// switches comments on the post on or off; that is applied at once
/// even for a member, whose other changes wait for review.
class PostEdit {
  const PostEdit({
    this.title,
    this.story,
    this.photo,
    this.pictures,
    this.bike,
    this.pizza,
    this.comments,
  });

  final String? title;
  final String? story;
  final SubmissionPhoto? photo;
  final List<AdditionalPicture>? pictures;
  final BikeDetails? bike;
  final PizzaDetails? pizza;
  final bool? comments;

  bool get isEmpty =>
      title == null &&
      story == null &&
      photo == null &&
      pictures == null &&
      bike == null &&
      pizza == null &&
      comments == null;

  static Map<String, String> _upload(SubmissionPhoto photo) => {
    'data': base64Encode(photo.bytes),
    'contentType': photo.contentType,
  };

  Map<String, Object?> toJson() => {
    if (title != null) 'title': title,
    if (story != null) 'story': story,
    if (photo != null) 'image': _upload(photo!),
    if (pictures != null)
      'images': [
        for (final picture in pictures!)
          switch (picture) {
            KeptPicture(:final image) => {'keep': image.version},
            NewPicture(:final photo) => _upload(photo),
          },
      ],
    if (bike != null)
      'bike': {
        'brand': bike!.brand ?? '',
        'year': bike!.year ?? '',
        'color': bike!.color ?? '',
        'type': bike!.type ?? '',
      },
    if (pizza != null) 'pizza': {'style': pizza!.style ?? ''},
    if (comments != null) 'comments': comments,
  };
}

/// Reads and changes the posts a member may edit: their own, or any post
/// for an administrator. Failures are [ApiException]s.
abstract class PostEditor {
  /// The signed-in member's published posts, newest first.
  Future<List<PostSummary>> myPosts();

  /// The post as the edit form should show it.
  Future<EditablePost> load(String id);

  /// Sends [edit]: applied at once for an administrator, stored for
  /// review for a member (see [EditOutcome]).
  Future<EditOutcome> save(String id, PostEdit edit);
}

/// [PostEditor] on the REST API's `/api/posts` endpoints.
class ApiPostEditor implements PostEditor {
  ApiPostEditor(this._api);

  final ApiClient _api;

  @override
  Future<List<PostSummary>> myPosts() async {
    final json = await _api.get('/posts');
    final posts = json['posts'];
    return [
      if (posts is List)
        for (final p in posts.whereType<Map<String, dynamic>>())
          PostSummary.fromJson(p),
    ];
  }

  @override
  Future<EditablePost> load(String id) async => EditablePost.fromJson(
    await _api.get('/posts/${Uri.encodeComponent(id)}'),
  );

  @override
  Future<EditOutcome> save(String id, PostEdit edit) async =>
      EditOutcome.fromJson(
        await _api.patch(
          '/posts/${Uri.encodeComponent(id)}',
          body: edit.toJson(),
        ),
      );
}
