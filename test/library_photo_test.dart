import 'dart:convert';
import 'dart:typed_data';

import 'package:bikes_pizza/screens/library_photo_screen.dart';
import 'package:bikes_pizza/submissions/photo_library.dart';
import 'package:bikes_pizza/submissions/photo_picker.dart';
import 'package:bikes_pizza/submissions/submission_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// 1x1 transparent PNG.
final png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
);

/// A library of [count] photos the app may see under [access].
class FakePhotoLibrary implements PhotoLibrary {
  FakePhotoLibrary({this.access = LibraryAccess.full, this.count = 3});

  LibraryAccess access;
  int count;

  /// What selecting more photos, or a visit to Settings, changes.
  void Function(FakePhotoLibrary library)? onSelectMore;
  final pages = <int>[];
  final loaded = <String>[];
  final unreadable = <String>{};
  int settingsOpened = 0;

  @override
  Future<LibraryAccess> requestAccess() async => access;

  @override
  Future<List<LibraryPhoto>> photos({
    required int page,
    required int size,
  }) async {
    pages.add(page);
    if (access == LibraryAccess.denied) return const [];
    final start = page * size;
    return [
      for (var i = start; i < count && i < start + size; i++)
        LibraryPhoto('p$i'),
    ];
  }

  @override
  Future<Uint8List?> thumbnail(LibraryPhoto photo) async => png;

  @override
  Future<SubmissionPhoto?> load(LibraryPhoto photo) async {
    loaded.add(photo.id);
    if (unreadable.contains(photo.id)) return null;
    return SubmissionPhoto(
      bytes: png,
      contentType: 'image/jpeg',
      filename: '${photo.id}.jpg',
    );
  }

  @override
  Future<void> selectMore() async => onSelectMore?.call(this);

  @override
  Future<void> openSettings() async => settingsOpened++;
}

void main() {
  /// A page with a button that opens the library through the picker and
  /// keeps what came back.
  Future<List<SubmissionPhoto?>> openLibrary(
    WidgetTester tester,
    FakePhotoLibrary library,
  ) async {
    final results = <SubmissionPhoto?>[];
    final picker = DevicePhotoPicker(library: library);
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              key: const Key('open'),
              onPressed: () async =>
                  results.add(await picker.pick(PhotoSource.library, context)),
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.byKey(const Key('open')));
    await tester.pumpAndSettle();
    return results;
  }

  testWidgets('with full access every photo is there to choose from', (
    tester,
  ) async {
    final library = FakePhotoLibrary(count: 3);
    final results = await openLibrary(tester, library);

    expect(find.byType(LibraryPhotoScreen), findsOneWidget);
    expect(find.byKey(const Key('library-limited')), findsNothing);
    expect(find.byKey(const Key('library-photo-0')), findsOneWidget);
    expect(find.byKey(const Key('library-photo-2')), findsOneWidget);
    expect(find.byKey(const Key('library-photo-3')), findsNothing);

    await tester.tap(find.byKey(const Key('library-photo-1')));
    await tester.pumpAndSettle();
    expect(find.byType(LibraryPhotoScreen), findsNothing);
    expect(library.loaded, ['p1']);
    expect(results.single?.filename, 'p1.jpg');
  });

  testWidgets('with limited access only the selected photos are shown, '
      'and more can be selected', (tester) async {
    final library = FakePhotoLibrary(access: LibraryAccess.limited, count: 1)
      ..onSelectMore = (library) => library.count = 2;
    await openLibrary(tester, library);

    expect(find.byKey(const Key('library-limited')), findsOneWidget);
    expect(find.byKey(const Key('library-photo-0')), findsOneWidget);
    expect(find.byKey(const Key('library-photo-1')), findsNothing);

    await tester.tap(find.byKey(const Key('library-select-more')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('library-photo-1')), findsOneWidget);
  });

  testWidgets('limited access with nothing selected says so', (tester) async {
    final library = FakePhotoLibrary(access: LibraryAccess.limited, count: 0);
    await openLibrary(tester, library);

    expect(find.text('No photos selected yet.'), findsOneWidget);
    expect(find.byKey(const Key('library-select-more')), findsOneWidget);
  });

  testWidgets('without access the screen points to Settings, and notices '
      'a change made there', (tester) async {
    final library = FakePhotoLibrary(access: LibraryAccess.denied);
    final results = await openLibrary(tester, library);

    expect(find.byKey(const Key('library-denied')), findsOneWidget);
    expect(find.byKey(const Key('library-grid')), findsNothing);
    await tester.tap(find.byKey(const Key('library-settings')));
    await tester.pumpAndSettle();
    expect(library.settingsOpened, 1);

    library
      ..access = LibraryAccess.limited
      ..count = 1;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('library-denied')), findsNothing);
    expect(find.byKey(const Key('library-photo-0')), findsOneWidget);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(results, [null]);
  });

  testWidgets('more photos load as the grid is scrolled', (tester) async {
    final library = FakePhotoLibrary(count: 150);
    await openLibrary(tester, library);
    expect(library.pages, [0]);

    await tester.drag(
      find.byKey(const Key('library-grid')),
      const Offset(0, -3000),
    );
    await tester.pumpAndSettle();
    expect(library.pages, containsAllInOrder([0, 1]));
  });

  testWidgets('a photo that cannot be read leaves the library open', (
    tester,
  ) async {
    final library = FakePhotoLibrary()..unreadable.add('p0');
    final results = await openLibrary(tester, library);

    await tester.tap(find.byKey(const Key('library-photo-0')));
    await tester.pumpAndSettle();
    expect(find.text('Could not open that photo.'), findsOneWidget);
    expect(find.byType(LibraryPhotoScreen), findsOneWidget);
    expect(results, isEmpty);
  });
}
