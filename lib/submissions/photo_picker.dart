import 'package:image_picker/image_picker.dart';

import 'submission_service.dart';

enum PhotoSource { camera, library }

/// Lets the user pick or take a photo, returning it resized for upload.
abstract class PhotoPicker {
  /// Null when the user backed out without choosing.
  Future<SubmissionPhoto?> pick(PhotoSource source);
}

/// [PhotoPicker] backed by the image_picker plugin. Photos are scaled to at
/// most 2048px and re-encoded as JPEG so uploads stay small.
class ImagePickerPhotoPicker implements PhotoPicker {
  ImagePickerPhotoPicker({ImagePicker? picker})
    : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  @override
  Future<SubmissionPhoto?> pick(PhotoSource source) async {
    final file = await _picker.pickImage(
      source: source == PhotoSource.camera
          ? ImageSource.camera
          : ImageSource.gallery,
      maxWidth: 2048,
      maxHeight: 2048,
      imageQuality: 85,
      requestFullMetadata: false,
    );
    if (file == null) return null;
    final bytes = await file.readAsBytes();
    final contentType = switch (file.mimeType ?? _extension(file.name)) {
      'image/png' || 'png' => 'image/png',
      'image/webp' || 'webp' => 'image/webp',
      _ => 'image/jpeg',
    };
    return SubmissionPhoto(
      bytes: bytes,
      contentType: contentType,
      filename: file.name.isEmpty ? 'photo.jpg' : file.name,
    );
  }

  static String _extension(String name) {
    final dot = name.lastIndexOf('.');
    return dot < 0 ? '' : name.substring(dot + 1).toLowerCase();
  }
}
