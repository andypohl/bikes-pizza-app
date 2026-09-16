import 'package:bikes_pizza/models/post.dart';
import 'package:flutter_test/flutter_test.dart';

const _image = {
  'base': 'https://files.example.com/o/posts%2Fa%2Fv1%2F',
  'version': 'v1',
  'width': 2000,
  'height': 1500,
  'sizes': [400, 800],
};

void main() {
  test('a post reads its additional pictures, skipping broken ones', () {
    final post = Post.fromJson({
      'slug': 'a',
      'feed': 'bikes',
      'title': 'A',
      'publishedAt': '2026-01-01T00:00:00.000Z',
      'image': _image,
      'images': [
        {..._image, 'version': 'e1'},
        {'base': ''},
        {..._image, 'version': 'e2'},
      ],
    }, siteUrl: 'https://example.com');
    expect(post.images.map((i) => i.version), ['e1', 'e2']);
    expect(post.image?.version, 'v1');

    final plain = Post.fromJson({
      'slug': 'b',
      'feed': 'news',
      'title': 'B',
      'publishedAt': '2026-01-01T00:00:00.000Z',
    }, siteUrl: 'https://example.com');
    expect(plain.images, isEmpty);

    final swapped = post.copyWith(images: [post.images.last]);
    expect(swapped.images.single.version, 'e2');
    expect(post.copyWith(title: 'x').images.length, 2);
  });
}
