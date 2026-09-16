import 'package:flutter/material.dart';

import 'photo_picker.dart';

/// Asks where a photo should come from: the camera or the library. Null
/// when the sheet is dismissed.
Future<PhotoSource?> choosePhotoSource(BuildContext context) =>
    showModalBottomSheet<PhotoSource>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              key: const Key('photo-camera'),
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Take a photo'),
              onTap: () => Navigator.pop(context, PhotoSource.camera),
            ),
            ListTile(
              key: const Key('photo-library'),
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose from library'),
              onTap: () => Navigator.pop(context, PhotoSource.library),
            ),
          ],
        ),
      ),
    );
