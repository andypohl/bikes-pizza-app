import 'package:firebase_auth/firebase_auth.dart' as fb;

/// The signed-in user, reduced to what the UI needs.
class AppUser {
  const AppUser({required this.uid, this.email});

  final String uid;
  final String? email;
}

/// Thrown by [AuthService] with a message safe to show to the user.
class AuthException implements Exception {
  AuthException(this.message);

  final String message;

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

  Future<void> signOut();
}

/// [AuthService] backed by Firebase Authentication (email + password).
class FirebaseAuthService implements AuthService {
  FirebaseAuthService({fb.FirebaseAuth? auth})
      : _auth = auth ?? fb.FirebaseAuth.instance;

  final fb.FirebaseAuth _auth;

  @override
  Stream<AppUser?> get userChanges => _auth.userChanges().map(_toAppUser);

  @override
  AppUser? get currentUser => _toAppUser(_auth.currentUser);

  @override
  Future<void> signIn({required String email, required String password}) =>
      _guard(() => _auth.signInWithEmailAndPassword(
            email: email.trim(),
            password: password,
          ));

  @override
  Future<void> createAccount({
    required String email,
    required String password,
  }) =>
      _guard(() => _auth.createUserWithEmailAndPassword(
            email: email.trim(),
            password: password,
          ));

  @override
  Future<void> sendPasswordReset(String email) =>
      _guard(() => _auth.sendPasswordResetEmail(email: email.trim()));

  @override
  Future<void> signOut() => _auth.signOut();

  static AppUser? _toAppUser(fb.User? user) =>
      user == null ? null : AppUser(uid: user.uid, email: user.email);

  /// Runs [action], translating Firebase error codes into readable messages.
  static Future<void> _guard(Future<Object?> Function() action) async {
    try {
      await action();
    } on fb.FirebaseAuthException catch (e) {
      throw AuthException(_describe(e));
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
      case 'weak-password':
        return 'Choose a password with at least 6 characters.';
      case 'too-many-requests':
        return 'Too many attempts. Please wait a moment and try again.';
      case 'network-request-failed':
        return 'Could not reach the server. Check your connection.';
      case 'operation-not-allowed':
        return 'Email sign-in is not enabled for this app yet.';
      default:
        return e.message ?? 'Something went wrong (${e.code}).';
    }
  }
}
