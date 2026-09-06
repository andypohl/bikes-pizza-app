import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pizza_predator/splash_screen.dart';

void main() {
  Future<void> pumpSplash(WidgetTester tester, Size size) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(const SplashScreen());
  }

  testWidgets('artwork spans 80% of the width in portrait', (tester) async {
    await pumpSplash(tester, const Size(400, 800));
    expect(tester.getSize(find.byKey(const Key('splash-art'))).width, 320);
    expect(tester.getCenter(find.byKey(const Key('splash-art'))),
        const Offset(200, 400));
  });

  testWidgets('artwork keeps the portrait size in landscape', (tester) async {
    await pumpSplash(tester, const Size(800, 400));
    expect(tester.getSize(find.byKey(const Key('splash-art'))).width, 320);
    expect(tester.getCenter(find.byKey(const Key('splash-art'))),
        const Offset(400, 200));
  });

  const app = Directionality(
    textDirection: TextDirection.ltr,
    child: Text('the app'),
  );

  testWidgets('bootstrap shows the splash for the minimum, then the app',
      (tester) async {
    await tester.pumpWidget(
      AppBootstrap(
        load: () async => app,
        minimum: const Duration(seconds: 1),
        fade: const Duration(milliseconds: 200),
        warmUp: (_) async {},
      ),
    );
    expect(find.byType(SplashScreen), findsOneWidget);
    expect(find.text('the app'), findsNothing);

    await tester.pump(const Duration(milliseconds: 900));
    expect(find.text('the app'), findsNothing);

    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('the app'), findsOneWidget);
    // The splash stays underneath while the app fades in.
    expect(find.byType(SplashScreen), findsOneWidget);

    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byType(SplashScreen), findsNothing);
  });

  testWidgets('the minimum counts from the first frame, after warm-up',
      (tester) async {
    final artwork = Completer<void>();
    await tester.pumpWidget(
      AppBootstrap(
        load: () async => app,
        minimum: const Duration(seconds: 1),
        warmUp: (_) => artwork.future,
      ),
    );
    // Slow warm-up: the clock has not started.
    await tester.pump(const Duration(seconds: 1));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('the app'), findsNothing);

    artwork.complete();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 900));
    expect(find.text('the app'), findsNothing);
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('the app'), findsOneWidget);
  });

  testWidgets('a warm-up that never finishes is given up on', (tester) async {
    await tester.pumpWidget(
      AppBootstrap(
        load: () async => app,
        minimum: Duration.zero,
        warmUp: (_) => Completer<void>().future,
        warmUpLimit: const Duration(seconds: 2),
      ),
    );
    await tester.pump(const Duration(milliseconds: 1900));
    expect(find.text('the app'), findsNothing);
    await tester.pump(const Duration(milliseconds: 200));
    await tester.pump();
    expect(find.text('the app'), findsOneWidget);
  });

  testWidgets('bootstrap reports a startup failure', (tester) async {
    await tester.pumpWidget(
      AppBootstrap(
        load: () async => throw StateError('no network'),
        minimum: Duration.zero,
        warmUp: (_) async {},
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('could not start'), findsOneWidget);
    expect(find.textContaining('no network'), findsOneWidget);
  });
}
