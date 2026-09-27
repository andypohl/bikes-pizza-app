import 'dart:typed_data';

import 'package:photo_manager/photo_manager.dart';

import 'submission_service.dart';

/// What the member has let the app see of their photo library.
enum LibraryAccess {
  /// Every photo.
  full,

  /// Only the photos the member selected; to the app the rest do not exist.
  limited,

  /// None; the member changes that in Settings.
  denied,
}

/// A photo in the library, as the grid shows it.
class LibraryPhoto {
  const LibraryPhoto(this.id);

  final String id;

  @override
  bool operator ==(Object other) => other is LibraryPhoto && other.id == id;

  @override
  int get hashCode => id.hashCode;
}

/// The photos the member has let the app see. The system decides which
/// those are: the member answers its prompt (none, selected photos, all)
/// and can change the answer in Settings.
abstract class PhotoLibrary {
  /// Asks for access the first time; afterwards reports the answer.
  Future<LibraryAccess> requestAccess();

  /// One page of the photos the app may see, newest first. Shorter than
  /// [size] (or empty) when there are no more.
  Future<List<LibraryPhoto>> photos({required int page, required int size});

  /// A small square-ish preview, or null when it cannot be made.
  Future<Uint8List?> thumbnail(LibraryPhoto photo);

  /// The photo resized for upload, or null when it cannot be read.
  Future<SubmissionPhoto?> load(LibraryPhoto photo);

  /// Shows the system's sheet for changing which photos are selected.
  /// Returns once the member is done with it.
  Future<void> selectMore();

  /// Opens the app's page in Settings.
  Future<void> openSettings();
}

/// [PhotoLibrary] backed by the photo_manager plugin. Photos are scaled to
/// at most 2048px and re-encoded as JPEG, like the ones the picker returns,
/// which also leaves their metadata (the location, for one) behind.
class DevicePhotoLibrary implements PhotoLibrary {
  final _assets = <String, AssetEntity>{};

  @override
  Future<LibraryAccess> requestAccess() async {
    final state = await PhotoManager.requestPermissionExtend(
      requestOption: const PermissionRequestOption(
        androidPermission: AndroidPermission(
          type: RequestType.image,
          mediaLocation: false,
        ),
      ),
    );
    return switch (state) {
      PermissionState.authorized => LibraryAccess.full,
      PermissionState.limited => LibraryAccess.limited,
      _ => LibraryAccess.denied,
    };
  }

  @override
  Future<List<LibraryPhoto>> photos({
    required int page,
    required int size,
  }) async {
    if (page == 0) _assets.clear();
    final assets = await PhotoManager.getAssetListPaged(
      page: page,
      pageCount: size,
      type: RequestType.image,
    );
    for (final asset in assets) {
      _assets[asset.id] = asset;
    }
    return [for (final asset in assets) LibraryPhoto(asset.id)];
  }

  @override
  Future<Uint8List?> thumbnail(LibraryPhoto photo) async =>
      _assets[photo.id]?.thumbnailDataWithSize(const ThumbnailSize.square(300));

  @override
  Future<SubmissionPhoto?> load(LibraryPhoto photo) async {
    final bytes = await _assets[photo.id]?.thumbnailDataWithOption(
      ThumbnailOption.ios(
        size: const ThumbnailSize.square(2048),
        quality: 85,
        deliveryMode: DeliveryMode.highQualityFormat,
        resizeMode: ResizeMode.exact,
      ),
    );
    if (bytes == null) return null;
    return SubmissionPhoto(
      bytes: bytes,
      contentType: 'image/jpeg',
      filename: 'photo.jpg',
    );
  }

  @override
  Future<void> selectMore() =>
      PhotoManager.presentLimited(type: RequestType.image);

  @override
  Future<void> openSettings() => PhotoManager.openSetting();
}
