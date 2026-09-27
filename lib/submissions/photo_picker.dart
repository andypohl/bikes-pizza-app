import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../screens/library_photo_screen.dart';
import 'photo_library.dart';
import 'submission_service.dart';

enum PhotoSource { camera, library }

/// Lets the user pick or take a photo, returning it resized for upload.
abstract class PhotoPicker {
  /// Null when the user backed out without choosing. [context] is where a
  /// screen for choosing is shown from, when the picker has one.
  Future<SubmissionPhoto?> pick(PhotoSource source, BuildContext context);
}

/// [PhotoPicker] for the device. The camera, and the library where no
/// [library] is given (Android), go through the image_picker plugin and
/// the system's own picker. With a [library] (iOS) the app asks for access
/// to the photos and shows the ones it was given in its own screen, so
/// what the member allowed in Settings, all of them or a selection, is
/// what they choose from.
///
/// Photos are scaled to at most 2048px and re-encoded as JPEG so uploads
/// stay small.
class DevicePhotoPicker implements PhotoPicker {
  DevicePhotoPicker({ImagePicker? picker, this.library})
    : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;
  final PhotoLibrary? library;

  @override
  Future<SubmissionPhoto?> pick(
    PhotoSource source,
    BuildContext context,
  ) async {
    final library = this.library;
    if (source == PhotoSource.library && library != null) {
      return Navigator.of(context).push<SubmissionPhoto>(
        MaterialPageRoute(
          fullscreenDialog: true,
          builder: (_) => LibraryPhotoScreen(library: library),
        ),
      );
    }
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
