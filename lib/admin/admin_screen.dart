import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import 'admin_service.dart';
import 'submissions_screen.dart';
import 'users_screen.dart';

/// The Admin tab, for signed-in administrators on any device: the
/// submissions review and user administration that the web pages at
/// submissions.bikes.pizza and admin.bikes.pizza offer. The [HomeShell]
/// only shows the tab once the account's admin claim has been checked.
class AdminScreen extends StatelessWidget {
  const AdminScreen({super.key, required this.auth, required this.admin});

  final AuthService auth;
  final AdminService admin;

  void _push(BuildContext context, Widget screen) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Admin')),
      body: ListView(
        key: const Key('admin-section'),
        children: [
          ListTile(
            key: const Key('admin-submissions'),
            leading: const Icon(Icons.rate_review_outlined),
            title: const Text('Review submissions'),
            subtitle: const Text('Queue, draft or reject what members sent'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () =>
                _push(context, SubmissionsScreen(admin: admin, auth: auth)),
          ),
          ListTile(
            key: const Key('admin-users'),
            leading: const Icon(Icons.manage_accounts_outlined),
            title: const Text('Manage users'),
            subtitle: const Text('Who has signed up, and their posts'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _push(context, UsersScreen(admin: admin, auth: auth)),
          ),
        ],
      ),
    );
  }
}
