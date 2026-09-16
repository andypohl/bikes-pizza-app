import 'package:flutter/material.dart';

/// The blue dot that marks a post not opened since it was published or
/// last edited.
class UnreadDot extends StatelessWidget {
  const UnreadDot({super.key, this.size = 10});

  final double size;

  static const color = Color(0xFF1E88E5);

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'Unread',
    child: Container(
      width: size,
      height: size,
      decoration: const BoxDecoration(color: color, shape: BoxShape.circle),
    ),
  );
}
