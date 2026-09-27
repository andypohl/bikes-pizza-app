import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../submissions/photo_library.dart';
import '../submissions/submission_service.dart';

/// The member's photos, as far as they have let the app see them, to
/// choose one from. Pops with the chosen photo resized for upload, or
/// with nothing when the member backs out.
class LibraryPhotoScreen extends StatefulWidget {
  const LibraryPhotoScreen({super.key, required this.library});

  final PhotoLibrary library;

  @override
  State<LibraryPhotoScreen> createState() => _LibraryPhotoScreenState();
}

class _LibraryPhotoScreenState extends State<LibraryPhotoScreen>
    with WidgetsBindingObserver {
  static const _pageSize = 60;

  final _scroll = ScrollController();
  final _photos = <LibraryPhoto>[];
  final _thumbnails = <String, Future<Uint8List?>>{};

  LibraryAccess? _access;
  int _nextPage = 0;
  bool _loading = false;
  bool _more = true;
  bool _opening = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _scroll.addListener(_onScroll);
    _reload();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _scroll.dispose();
    super.dispose();
  }

  // The member may have changed the access in Settings meanwhile.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && !_opening) _reload();
  }

  void _onScroll() {
    if (_scroll.position.extentAfter < 600) _loadPage();
  }

  Future<void> _reload() async {
    final access = await widget.library.requestAccess();
    if (!mounted) return;
    setState(() {
      _access = access;
      _photos.clear();
      _thumbnails.clear();
      _nextPage = 0;
      _more = access != LibraryAccess.denied;
    });
    await _loadPage();
  }

  Future<void> _loadPage() async {
    if (_loading || !_more) return;
    _loading = true;
    try {
      final page = await widget.library.photos(
        page: _nextPage,
        size: _pageSize,
      );
      if (!mounted) return;
      setState(() {
        _photos.addAll(page.where((photo) => !_photos.contains(photo)));
        _nextPage++;
        _more = page.length == _pageSize;
      });
    } on Object {
      if (mounted) setState(() => _more = false);
    } finally {
      _loading = false;
    }
  }

  Future<void> _selectMore() async {
    await widget.library.selectMore();
    if (mounted) await _reload();
  }

  Future<void> _choose(LibraryPhoto photo) async {
    if (_opening) return;
    setState(() => _opening = true);
    SubmissionPhoto? loaded;
    try {
      loaded = await widget.library.load(photo);
    } on Object {
      loaded = null;
    }
    if (!mounted) return;
    if (loaded == null) {
      setState(() => _opening = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open that photo.')),
      );
      return;
    }
    Navigator.pop(context, loaded);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: const Key('library'),
      appBar: AppBar(title: const Text('Choose a photo')),
      body: switch (_access) {
        null => const Center(child: CircularProgressIndicator()),
        LibraryAccess.denied => _Denied(
          onSettings: widget.library.openSettings,
        ),
        final access => Column(
          children: [
            if (access == LibraryAccess.limited)
              _LimitedNotice(onSelectMore: _selectMore),
            Expanded(child: _grid()),
          ],
        ),
      },
    );
  }

  Widget _grid() {
    if (_photos.isEmpty) {
      if (_more) return const Center(child: CircularProgressIndicator());
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            _access == LibraryAccess.limited
                ? 'No photos selected yet.'
                : 'No photos here yet.',
            key: const Key('library-empty'),
          ),
        ),
      );
    }
    return Stack(
      children: [
        GridView.builder(
          key: const Key('library-grid'),
          controller: _scroll,
          padding: const EdgeInsets.all(2),
          gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
            maxCrossAxisExtent: 130,
            mainAxisSpacing: 2,
            crossAxisSpacing: 2,
          ),
          itemCount: _photos.length,
          itemBuilder: (context, index) {
            final photo = _photos[index];
            return InkWell(
              key: Key('library-photo-$index'),
              onTap: () => _choose(photo),
              child: FutureBuilder<Uint8List?>(
                future: _thumbnails[photo.id] ??= widget.library.thumbnail(
                  photo,
                ),
                builder: (context, snapshot) {
                  final bytes = snapshot.data;
                  if (bytes == null) {
                    return ColoredBox(
                      color: Theme.of(context)
                          .colorScheme
                          .surfaceContainerHighest,
                    );
                  }
                  return Image.memory(
                    bytes,
                    fit: BoxFit.cover,
                    gaplessPlayback: true,
                    semanticLabel: 'Photo ${index + 1}',
                  );
                },
              ),
            );
          },
        ),
        if (_opening)
          const Positioned.fill(
            child: ColoredBox(
              color: Colors.black26,
              child: Center(child: CircularProgressIndicator()),
            ),
          ),
      ],
    );
  }
}

class _LimitedNotice extends StatelessWidget {
  const _LimitedNotice({required this.onSelectMore});

  final VoidCallback onSelectMore;

  @override
  Widget build(BuildContext context) {
    return Material(
      key: const Key('library-limited'),
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
        child: Row(
          children: [
            const Expanded(
              child: Text('bikes.pizza can see only the photos you selected.'),
            ),
            TextButton(
              key: const Key('library-select-more'),
              onPressed: onSelectMore,
              child: const Text('Select photos'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Denied extends StatelessWidget {
  const _Denied({required this.onSettings});

  final VoidCallback onSettings;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          key: const Key('library-denied'),
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'bikes.pizza is not allowed to see your photos. You can '
              'allow all of them, or only the ones you select, in Settings.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            FilledButton(
              key: const Key('library-settings'),
              onPressed: onSettings,
              child: const Text('Open Settings'),
            ),
          ],
        ),
      ),
    );
  }
}
