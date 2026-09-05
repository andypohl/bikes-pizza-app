import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb;
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

/// The signed-in user, reduced to what the UI needs.
class AppUser {
  const AppUser({
    required this.uid,
    this.email,
    this.emailVerified = false,
    this.providerIds = const [],
  });

  final String uid;
  final String? email;

  /// Firebase provider IDs linked to the account: `password`, `google.com`,
  /// `apple.com`.
  final List<String> providerIds;

  bool get hasPassword => providerIds.contains('password');

  /// Whether the provider vouched for [email]. Google and Apple accounts are
  /// verified up front; password accounts need [AuthService.sendEmailVerification].
  final bool emailVerified;
}

/// Thrown by [AuthService] with a message safe to show to the user.
///
/// [cancelled] is true when the user backed out of a provider's sign-in
/// sheet; callers should treat that as a non-error and show nothing.
class AuthException implements Exception {
  AuthException(
    this.message, {
    this.cancelled = false,
    this.badCredentials = false,
  });

  AuthException.cancelled()
    : message = 'Sign-in cancelled.',
      cancelled = true,
      badCredentials = false;

  final String message;
  final bool cancelled;

  /// True when the email/password pair was rejected. The UI uses this to
  /// point people who subscribed before passwords existed at creating one.
  final bool badCredentials;

  @override
  String toString() => message;
}

/// Thrown by a sign-in when the account has two-factor authentication on:
/// the sign-in is parked until [AuthService.resolveSecondFactor] gets the
/// code from the authenticator app, or [AuthService.cancelSecondFactor].
class SecondFactorRequired extends AuthException {
  SecondFactorRequired() : super('Enter the code from your authenticator app.');
}

/// A second factor enrolled on the account.
class SecondFactor {
  const SecondFactor({required this.id, required this.name});

  final String id;
  final String name;
}

/// A TOTP secret being enrolled: what an authenticator app needs.
class TotpEnrollment {
  const TotpEnrollment({required this.secretKey, required this.qrCodeUrl});

  /// The key to type into the app when scanning is not possible.
  final String secretKey;

  /// The `otpauth://` URL, for a QR code or for opening an app directly.
  final String qrCodeUrl;
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

  /// Replaces the signed-in user's password after checking [current].
  ///
  /// Throws an [AuthException] with `badCredentials` set when [current] is
  /// wrong.
  Future<void> changePassword({required String current, required String next});

  /// Emails the signed-in user a link that marks their address as verified.
  Future<void> sendEmailVerification();

  /// Re-fetches the signed-in user so [userChanges] reflects a verification
  /// completed outside the app.
  Future<void> reloadUser();

  /// Opens the Google account picker and signs in with the chosen account.
  Future<void> signInWithGoogle();

  /// Opens the native Sign in with Apple sheet (iOS/macOS only).
  Future<void> signInWithApple();

  Future<void> signOut();

  // ---- two-factor authentication (optional, an authenticator app) ----

  /// Finishes a sign-in that threw [SecondFactorRequired] with the 6-digit
  /// [code] from the authenticator app.
  Future<void> resolveSecondFactor(String code);

  /// Drops a sign-in that was waiting for its second factor.
  void cancelSecondFactor();

  /// The second factors enrolled on the signed-in account; empty when
  /// two-factor authentication is off.
  Future<List<SecondFactor>> enrolledFactors();

  /// Starts enrolling an authenticator app; finish with
  /// [finishTotpEnrollment] once the app shows a code.
  Future<TotpEnrollment> startTotpEnrollment();

  /// Enrolls the authenticator app started by [startTotpEnrollment], proving
  /// it with the [code] it shows.
  Future<void> finishTotpEnrollment(String code);

  /// Turns two-factor authentication off by removing [factor].
  Future<void> removeSecondFactor(SecondFactor factor);

  /// Whether the signed-in account is an administrator (the `admin` claim).
  /// Administrators must keep a second factor for the admin pages.
  Future<bool> isAdmin();
}

/// [AuthService] backed by Firebase Authentication.
class FirebaseAuthService implements AuthService {
  FirebaseAuthService({fb.FirebaseAuth? auth, GoogleSignIn? googleSignIn})
    : _auth = auth ?? fb.FirebaseAuth.instance,
      _google = googleSignIn ?? GoogleSignIn.instance;

  final fb.FirebaseAuth _auth;
  final GoogleSignIn _google;
  Future<void>? _googleInit;
  fb.MultiFactorResolver? _resolver; // a sign-in waiting for its code
  fb.TotpSecret? _enrolling; // the secret being enrolled

  static const _factorName = 'Authenticator app';

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
  }) => _guard(() async {
    await _auth.createUserWithEmailAndPassword(
      email: email.trim(),
      password: password,
    );
  });

  @override
  Future<void> sendPasswordReset(String email) =>
      _guard(() => _auth.sendPasswordResetEmail(email: email.trim()));

  @override
  Future<void> changePassword({
    required String current,
    required String next,
  }) => _guard(() async {
    final user = _auth.currentUser;
    final email = user?.email;
    if (user == null || email == null) throw AuthException('Sign in first.');
    // Firebase insists on a recent sign-in before a password change;
    // proving the current password is the cleanest way to give it one.
    await user.reauthenticateWithCredential(
      fb.EmailAuthProvider.credential(email: email, password: current),
    );
    await user.updatePassword(next);
  });

  @override
  Future<void> sendEmailVerification() => _guard(() async {
    await _auth.currentUser?.sendEmailVerification();
  });

  @override
  Future<void> reloadUser() => _guard(() async {
    await _auth.currentUser?.reload();
  });

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
      // Only the email is asked for: names are not kept.
      apple = await SignInWithApple.getAppleIDCredential(
        scopes: const [AppleIDAuthorizationScopes.email],
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
      // The name parameter is required by the API; nothing is passed.
      fb.AppleAuthProvider.credentialWithIDToken(
        idToken,
        rawNonce,
        fb.AppleFullPersonName(),
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

  @override
  Future<void> resolveSecondFactor(String code) => _guard(() async {
    final resolver = _resolver;
    if (resolver == null) throw AuthException('Sign in first.');
    final hint = resolver.hints.firstWhere(
      (h) => h is fb.TotpMultiFactorInfo,
      orElse: () => resolver.hints.first,
    );
    final assertion = await fb.TotpMultiFactorGenerator.getAssertionForSignIn(
      hint.uid,
      code.trim(),
    );
    await resolver.resolveSignIn(assertion);
    _resolver = null;
  });

  @override
  void cancelSecondFactor() => _resolver = null;

  @override
  Future<List<SecondFactor>> enrolledFactors() async {
    final user = _auth.currentUser;
    if (user == null) return const [];
    final factors = await user.multiFactor.getEnrolledFactors();
    return [
      for (final f in factors)
        SecondFactor(id: f.uid, name: f.displayName ?? _factorName),
    ];
  }

  @override
  Future<TotpEnrollment> startTotpEnrollment() async {
    late TotpEnrollment enrollment;
    await _guard(() async {
      final user = _auth.currentUser;
      if (user == null) throw AuthException('Sign in first.');
      final session = await user.multiFactor.getSession();
      final secret = await fb.TotpMultiFactorGenerator.generateSecret(session);
      _enrolling = secret;
      enrollment = TotpEnrollment(
        secretKey: secret.secretKey,
        qrCodeUrl: await secret.generateQrCodeUrl(
          accountName: user.email ?? 'member',
          issuer: 'bikes.pizza',
        ),
      );
    });
    return enrollment;
  }

  @override
  Future<void> finishTotpEnrollment(String code) => _guard(() async {
    final user = _auth.currentUser;
    final secret = _enrolling;
    if (user == null || secret == null) {
      throw AuthException('Start two-factor setup first.');
    }
    final assertion =
        await fb.TotpMultiFactorGenerator.getAssertionForEnrollment(
          secret,
          code.trim(),
        );
    await user.multiFactor.enroll(assertion, displayName: _factorName);
    _enrolling = null;
  });

  @override
  Future<void> removeSecondFactor(SecondFactor factor) => _guard(() async {
    final user = _auth.currentUser;
    if (user == null) throw AuthException('Sign in first.');
    await user.multiFactor.unenroll(factorUid: factor.id);
  });

  @override
  Future<bool> isAdmin() async {
    final user = _auth.currentUser;
    if (user == null) return false;
    try {
      final token = await user.getIdTokenResult();
      return token.claims?['admin'] == true;
    } on fb.FirebaseAuthException {
      return false;
    }
  }

  static AppUser? _toAppUser(fb.User? user) => user == null
      ? null
      : AppUser(
          uid: user.uid,
          email: user.email,
          emailVerified: user.emailVerified,
          providerIds: [for (final p in user.providerData) p.providerId],
        );

  static String _randomNonce([int length = 32]) {
    const chars =
        '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._';
    final random = Random.secure();
    return List.generate(
      length,
      (_) => chars[random.nextInt(chars.length)],
    ).join();
  }

  /// Runs [action], translating Firebase error codes into readable messages.
  /// A sign-in that needs its second factor is parked for
  /// [resolveSecondFactor] and reported as [SecondFactorRequired].
  Future<void> _guard(Future<void> Function() action) async {
    try {
      await action();
    } on AuthException {
      rethrow;
    } on fb.FirebaseAuthMultiFactorException catch (e) {
      _resolver = e.resolver;
      throw SecondFactorRequired();
    } on fb.FirebaseAuthException catch (e) {
      throw AuthException(
        _describe(e),
        badCredentials: _badCredentialCodes.contains(e.code),
      );
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

  static const _badCredentialCodes = {
    'user-not-found',
    'wrong-password',
    'invalid-credential',
  };

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
      case 'requires-recent-login':
        return 'Sign out and back in, then try again.';
      case 'invalid-verification-code':
        return 'That code is not right. Try the current one from your app.';
      case 'totp-challenge-timeout':
      case 'maximum-second-factor-count-exceeded':
        return 'Two-factor setup timed out. Start it again.';
      case 'second-factor-already-in-use':
        return 'Two-factor authentication is already on for this account.';
      default:
        return e.message ?? 'Something went wrong (${e.code}).';
    }
  }
}
