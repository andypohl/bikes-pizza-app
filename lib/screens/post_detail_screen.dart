import 'package:flutter/material.dart';

import '../data/post_repository.dart';
import '../models/post.dart';
import '../widgets/post_article.dart';

/// A post opened from a list: the [PostArticle] on its own page, with a
/// button to open it on bikes.pizza.
class PostDetailScreen extends StatelessWidget {
  const PostDetailScreen({super.key, required this.post, this.repository});

  final Post post;
  final PostRepository? repository;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        actions: [
          if (post.url.isNotEmpty)
            IconButton(
              tooltip: 'Open on bikes.pizza',
              icon: const Icon(Icons.open_in_browser),
              onPressed: () => PostArticle.open(post.url),
            ),
        ],
      ),
      body: SingleChildScrollView(
        child: PostArticle(post: post, repository: repository),
      ),
    );
  }
}
