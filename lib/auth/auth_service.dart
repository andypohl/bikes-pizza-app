import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb;
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

/// The signed-in user, reduced to what the UI needs.
class AppUser {
  const AppUser({required this.uid, this.email, this.displayName});

  final String uid;
  final String? email;
  final String? displayName;
}

/// Thrown by [AuthService] with a message safe to show to the user.
///
/// [cancelled] is true when the user backed out of a provider's sign-in
/// sheet; callers should treat that as a non-error and show nothing.
class AuthException implements Exception {
  AuthException(this.message, {this.cancelled = false});

  AuthException.cancelled()
      : message = 'Sign-in cancelled.',
        cancelled = true;

  final String message;
  final bool cancelled;

  @override
  String toString() => message;
}

/// Authentication facade so screens and tests never depend on Firebase
/// directly.
abstract class AuthService {
  /// Emits the current user on subscription and whenever it changes.
  Stream<AppUser?> get userChanges;

  AppUser? get currentUser;

  Future<void> signIn({required String email, required String password});

  Future<void> createAccount({required String email, required String password});

  Future<void> sendPasswordReset(String email);

  /// Opens the Google account picker and signs in with the chosen account.
  Future<void> signInWithGoogle();

  /// Opens the native Sign in with Apple sheet (iOS/macOS only).
  Future<void> signInWithApple();

  Future<void> signOut();
}

/// [AuthService] backed by Firebase Authentication.
class FirebaseAuthService implements AuthService {
  FirebaseAuthService({fb.FirebaseAuth? auth, GoogleSignIn? googleSignIn})
      : _auth = auth ?? fb.FirebaseAuth.instance,
        _google = googleSignIn ?? GoogleSignIn.instance;

  final fb.FirebaseAuth _auth;
  final GoogleSignIn _google;
  Future<void>? _googleInit;

  @override
  Stream<AppUser?> get userChanges => _auth.userChanges().map(_toAppUser);

  @override
  AppUser? get currentUser => _toAppUser(_auth.currentUser);

  @override
  Future<void> signIn({required String email, required String password}) =>
      _guard(() async {
        await _auth.signInWithEmailAndPassword(
          email: email.trim(),
          password: password,
        );
      });

  @override
  Future<void> createAccount({
    required String email,
    required String password,
  }) =>
      _guard(() async {
        await _auth.createUserWithEmailAndPassword(
          email: email.trim(),
          password: password,
        );
      });

  @override
  Future<void> sendPasswordReset(String email) =>
      _guard(() => _auth.sendPasswordResetEmail(email: email.trim()));

  @override
  Future<void> signInWithGoogle() => _guard(() async {
        // The plugin reads client IDs from google-services.json /
        // GoogleService-Info.plist, so no IDs are needed here.
        _googleInit ??= _google.initialize();
        await _googleInit;

        final GoogleSignInAccount account;
        try {
          account = await _google.authenticate();
        } on GoogleSignInException catch (e) {
          if (e.code == GoogleSignInExceptionCode.canceled) {
            throw AuthException.cancelled();
          }
          throw AuthException(_describeGoogle(e));
        }

        final idToken = account.authentication.idToken;
        if (idToken == null) {
          throw AuthException('Google did not return a sign-in token.');
        }
        await _auth.signInWithCredential(
          fb.GoogleAuthProvider.credential(idToken: idToken),
        );
      });

  @override
  Future<void> signInWithApple() => _guard(() async {
        // Apple returns an ID token bound to a nonce; Firebase verifies the
        // raw nonce against the SHA-256 that Apple signed.
        final rawNonce = _randomNonce();
        final hashedNonce = sha256.convert(utf8.encode(rawNonce)).toString();

        final AuthorizationCredentialAppleID apple;
        try {
          apple = await SignInWithApple.getAppleIDCredential(
            scopes: const [
              AppleIDAuthorizationScopes.email,
              AppleIDAuthorizationScopes.fullName,
            ],
            nonce: hashedNonce,
          );
        } on SignInWithAppleAuthorizationException catch (e) {
          if (e.code == AuthorizationErrorCode.canceled) {
            throw AuthException.cancelled();
          }
          throw AuthException('Apple sign-in failed: ${e.message}');
        }

        final idToken = apple.identityToken;
        if (idToken == null) {
          throw AuthException('Apple did not return a sign-in token.');
        }
        await _auth.signInWithCredential(
          fb.AppleAuthProvider.credentialWithIDToken(
            idToken,
            rawNonce,
            fb.AppleFullPersonName(
              givenName: apple.givenName,
              familyName: apple.familyName,
            ),
          ),
        );
      });

  @override
  Future<void> signOut() async {
    await _auth.signOut();
    try {
      // Also clear Google's cached account so the picker shows next time.
      await _google.signOut();
    } on Object {
      // Not signed in with Google, or the plugin is unavailable here.
    }
  }

  static AppUser? _toAppUser(fb.User? user) => user == null
      ? null
      : AppUser(uid: user.uid, email: user.email, displayName: user.displayName);

  static String _randomNonce([int length = 32]) {
    const chars =
        '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._';
    final random = Random.secure();
    return List.generate(length, (_) => chars[random.nextInt(chars.length)])
        .join();
  }

  /// Runs [action], translating Firebase error codes into readable messages.
  static Future<void> _guard(Future<void> Function() action) async {
    try {
      await action();
    } on AuthException {
      rethrow;
    } on fb.FirebaseAuthException catch (e) {
      throw AuthException(_describe(e));
    }
  }

  static String _describeGoogle(GoogleSignInException e) {
    switch (e.code) {
      case GoogleSignInExceptionCode.clientConfigurationError:
      case GoogleSignInExceptionCode.providerConfigurationError:
        return 'Google sign-in is not configured for this build yet.';
      case GoogleSignInExceptionCode.uiUnavailable:
        return 'Google sign-in is not available on this device.';
      default:
        return 'Google sign-in failed. Please try again.';
    }
  }

  static String _describe(fb.FirebaseAuthException e) {
    switch (e.code) {
      case 'invalid-email':
        return 'That email address does not look right.';
      case 'user-disabled':
        return 'This account has been disabled.';
      case 'user-not-found':
      case 'wrong-password':
      case 'invalid-credential':
        return 'Email or password is incorrect.';
      case 'email-already-in-use':
        return 'An account already exists for that email. Try signing in.';
      case 'account-exists-with-different-credential':
        return 'An account already exists for that email with a different '
            'sign-in method. Sign in that way first.';
      case 'weak-password':
        return 'Choose a password with at least 6 characters.';
      case 'too-many-requests':
        return 'Too many attempts. Please wait a moment and try again.';
      case 'network-request-failed':
        return 'Could not reach the server. Check your connection.';
      case 'operation-not-allowed':
        return 'This sign-in method is not enabled for the app yet.';
      default:
        return e.message ?? 'Something went wrong (${e.code}).';
    }
  }
}
