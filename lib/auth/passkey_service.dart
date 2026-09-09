import 'dart:io' show Platform;

import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:passkeys/authenticator.dart';
import 'package:passkeys/types.dart';

import 'session_expiry.dart';

/// A passkey on the member's account, as the account screen lists it.
class Passkey {
  const Passkey({
    required this.id,
    required this.name,
    this.createdAt,
    this.lastUsedAt,
    this.backedUp = false,
  });

  final String id;

  /// What the member sees: the device it was made on, roughly.
  final String name;
  final DateTime? createdAt;
  final DateTime? lastUsedAt;

  /// Whether the device syncs it (iCloud Keychain, Google Password Manager).
  final bool backedUp;

  factory Passkey.fromJson(Map<String, dynamic> json) => Passkey(
    id: json['id'] as String,
    name: json['name'] as String? ?? 'Passkey',
    createdAt: _date(json['createdAt']),
    lastUsedAt: _date(json['lastUsedAt']),
    backedUp: json['backedUp'] == true,
  );

  static DateTime? _date(Object? value) =>
      value is String ? DateTime.tryParse(value)?.toLocal() : null;
}

/// Thrown by [PasskeyService] with a message safe to show to the user.
class PasskeyException implements Exception {
  PasskeyException(
    this.message, {
    this.cancelled = false,
    this.sessionExpired = false,
  });

  PasskeyException.cancelled()
    : message = 'Cancelled.',
      cancelled = true,
      sessionExpired = false;

  final String message;

  /// The member backed out of the system prompt; show nothing.
  final bool cancelled;

  /// The server no longer accepts the session; see `handleSessionExpired`.
  final bool sessionExpired;

  @override
  String toString() => message;
}

/// Passkeys: the device's Face ID, Touch ID or screen lock as a way to sign
/// in, kept on the account by the `passkey*` Cloud Functions. A passkey
/// sign-in skips the authenticator code on accounts with two-factor
/// authentication on, since the device has verified the person: the
/// sign-in screen uses one in place of the code whenever this device holds
/// a passkey for the account being signed in to.
abstract class PasskeyService {
  /// Whether this device can make and use passkeys.
  Future<bool> get available;

  /// The member's passkeys, newest first.
  Future<List<Passkey>> list();

  /// Adds a passkey for the signed-in member on this device; the system
  /// asks for Face ID, Touch ID or the screen lock. Returns the new list.
  Future<List<Passkey>> add();

  /// Removes one of the member's passkeys. Returns the rest.
  Future<List<Passkey>> remove(String id);

  /// Signs in with a passkey this device holds for bikes.pizza. On return
  /// the Firebase user is signed in; `AuthService.userChanges` reflects it.
  ///
  /// With an [email] only that account's passkeys are offered, so the
  /// result is always the account that was being signed in to; without one
  /// the device offers whichever passkeys it holds for the site.
  ///
  /// Returns false when there was nothing to try rather than throwing:
  /// that account has no passkeys at all, or, with [onlyIfPresent], this
  /// device holds none of them. Callers then ask for the authenticator
  /// code. Backing out of the system prompt still throws a cancelled
  /// [PasskeyException].
  Future<bool> signIn({String? email, bool onlyIfPresent = false});
}

/// [PasskeyService] backed by the platform's passkey support and the
/// Cloud Functions.
class FirebasePasskeyService implements PasskeyService {
  FirebasePasskeyService({
    FirebaseFunctions? functions,
    fb.FirebaseAuth? auth,
    PasskeyAuthenticator? authenticator,
  }) : _functions =
           functions ?? FirebaseFunctions.instanceFor(region: 'us-central1'),
       _auth = auth ?? fb.FirebaseAuth.instance,
       _authenticator = authenticator ?? PasskeyAuthenticator();

  final FirebaseFunctions _functions;
  final fb.FirebaseAuth _auth;
  final PasskeyAuthenticator _authenticator;

  @override
  Future<bool> get available async {
    if (kIsWeb) return false;
    try {
      final availability = _authenticator.getAvailability();
      if (Platform.isIOS || Platform.isMacOS) {
        return (await availability.iOS()).hasPasskeySupport;
      }
      if (Platform.isAndroid) {
        return (await availability.android()).hasPasskeySupport;
      }
    } on Object {
      // The plugin is not available on this platform.
    }
    return false;
  }

  /// The name the passkey is kept under: the app and the kind of device.
  static String deviceName() {
    if (Platform.isIOS) return 'The app on iPhone or iPad';
    if (Platform.isAndroid) return 'The app on Android';
    if (Platform.isMacOS) return 'The app on Mac';
    return 'The app';
  }

  @override
  Future<List<Passkey>> list() async =>
      _passkeys(await _call<List<dynamic>>('passkeyList', const {}));

  @override
  Future<List<Passkey>> add() async {
    final start = await _call<Map<String, dynamic>>(
      'passkeyRegisterOptions',
      const {},
    );
    final options = Map<String, dynamic>.from(start['options'] as Map);
    final RegisterResponseType response;
    try {
      response = await _authenticator.register(
        RegisterRequestType.fromJson(options),
      );
    } on AuthenticatorException catch (e) {
      throw _translate(e);
    }
    return _passkeys(
      await _call<List<dynamic>>('passkeyRegister', {
        'challengeId': start['challengeId'],
        'response': response.toJson(),
        'name': deviceName(),
      }),
    );
  }

  @override
  Future<List<Passkey>> remove(String id) async =>
      _passkeys(await _call<List<dynamic>>('passkeyRemove', {'id': id}));

  @override
  Future<bool> signIn({String? email, bool onlyIfPresent = false}) async {
    final start = await _call<Map<String, dynamic>>('passkeySignInOptions', {
      'email': ?email,
    });
    // Absent when the account named by [email] has no passkeys; the
    // server does not make a challenge for a ceremony that cannot work.
    final options = start['options'];
    if (options is! Map) return false;
    final AuthenticateResponseType response;
    try {
      response = await _authenticator.authenticate(
        AuthenticateRequestType.fromJson(
          Map<String, dynamic>.from(options),
          mediation: MediationType.Optional,
          // Keeps the system to passkeys already on this device, instead
          // of offering to scan a QR code with another one.
          preferImmediatelyAvailableCredentials: true,
        ),
      );
    } on NoCredentialsAvailableException catch (e) {
      if (onlyIfPresent) return false;
      throw _translate(e);
    } on AuthenticatorException catch (e) {
      throw _translate(e);
    }
    final result = await _call<Map<String, dynamic>>('passkeySignIn', {
      'challengeId': start['challengeId'],
      'response': response.toJson(),
    });
    try {
      await _auth.signInWithCustomToken(result['token'] as String);
    } on fb.FirebaseAuthException catch (e) {
      throw PasskeyException(
        e.code == 'user-disabled'
            ? 'This account has been disabled.'
            : 'Could not finish signing in. Please try again.',
      );
    }
    return true;
  }

  static List<Passkey> _passkeys(List<dynamic> items) => [
    for (final item in items.whereType<Map>())
      Passkey.fromJson(Map<String, dynamic>.from(item)),
  ];

  Future<T> _call<T>(String name, Map<String, Object?> data) async {
    try {
      final result = await _functions.httpsCallable(name).call<T>(data);
      return result.data;
    } on FirebaseFunctionsException catch (e) {
      if (e.code == 'unauthenticated') {
        throw PasskeyException(sessionExpiredMessage, sessionExpired: true);
      }
      throw PasskeyException(switch (e.code) {
        'failed-precondition' ||
        'invalid-argument' ||
        'not-found' ||
        'permission-denied' => e.message ?? 'That did not work.',
        _ => 'Could not reach the server right now.',
      });
    }
  }

  static PasskeyException _translate(AuthenticatorException e) => switch (e) {
    PasskeyAuthCancelledException() => PasskeyException.cancelled(),
    NoCredentialsAvailableException() => PasskeyException(
      'This device has no passkey for bikes.pizza yet. Sign in another '
      'way and add one from Manage account.',
    ),
    ExcludeCredentialsCanNotBeRegisteredException() => PasskeyException(
      'This device already has a passkey for your account.',
    ),
    DomainNotAssociatedException() => PasskeyException(
      'This build of the app is not set up for passkeys.',
    ),
    MissingGoogleSignInException() || SyncAccountNotAvailableException() =>
      PasskeyException('Add a Google account to this device to use passkeys.'),
    DeviceNotSupportedException() || PasskeyUnsupportedException() =>
      PasskeyException('Passkeys are not available on this device.'),
    TimeoutException() => PasskeyException('That took too long. Try again.'),
    _ => PasskeyException('Something went wrong with the passkey: $e'),
  };
}
