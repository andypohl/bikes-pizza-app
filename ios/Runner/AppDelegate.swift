import Flutter
import UIKit
import UserNotifications

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    // The app icon's badge needs the badge permission; the Dart side
    // (lib/posts/app_badge.dart) asks the first time there is a count.
    let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "bikes.pizza/badge")!
    let channel = FlutterMethodChannel(name: "bikes.pizza/badge", binaryMessenger: registrar.messenger())
    channel.setMethodCallHandler { call, result in
      guard call.method == "requestPermission" else {
        result(FlutterMethodNotImplemented)
        return
      }
      UNUserNotificationCenter.current().requestAuthorization(options: [.badge]) { granted, _ in
        DispatchQueue.main.async { result(granted) }
      }
    }
  }
}
