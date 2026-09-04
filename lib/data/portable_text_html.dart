/// Converts Sanity Portable Text (the `blockContent` type in `studio/`) to
/// HTML for the app's HTML renderer.
///
/// Handles text blocks (normal, h1–h4, blockquote), bullet and numbered
/// lists (nested by `level`), the `strong`, `em`, `underline`,
/// `strike-through` and `code` decorators, `link` annotations, and image
/// blocks whose asset URL was projected into `url` (with optional `alt` and
/// `caption`). Unknown block types are skipped.
String portableTextToHtml(List<dynamic> blocks) {
  final out = StringBuffer();
  final lists = <_OpenList>[];

  void closeListsDownTo(int level) {
    while (lists.length > level) {
      out.write('</li></${lists.removeLast().tag}>');
    }
  }

  for (final raw in blocks) {
    if (raw is! Map) continue;
    final block = raw.cast<String, dynamic>();
    final type = block['_type'];

    if (type == 'image') {
      closeListsDownTo(0);
      out.write(_image(block));
      continue;
    }
    if (type != 'block') continue;

    final listItem = block['listItem'] as String?;
    if (listItem == null) {
      closeListsDownTo(0);
      out.write(_textBlock(block));
      continue;
    }

    final level = _int(block['level'], fallback: 1).clamp(1, 10);
    final tag = listItem == 'number' ? 'ol' : 'ul';
    // Close deeper (or differently typed) lists, then open up to `level`.
    closeListsDownTo(level);
    if (lists.length == level && lists.last.tag != tag) {
      closeListsDownTo(level - 1);
    }
    if (lists.length == level) {
      out.write('</li>');
    }
    while (lists.length < level) {
      lists.add(_OpenList(tag));
      out.write('<$tag>');
      if (lists.length < level) out.write('<li>');
    }
    out.write('<li>${_children(block)}');
  }
  closeListsDownTo(0);
  return out.toString();
}

class _OpenList {
  _OpenList(this.tag);
  final String tag;
}

int _int(Object? value, {required int fallback}) =>
    value is int ? value : (value is num ? value.toInt() : fallback);

String _textBlock(Map<String, dynamic> block) {
  final style = block['style'] as String? ?? 'normal';
  final inner = _children(block);
  return switch (style) {
    'h1' || 'h2' || 'h3' || 'h4' => '<$style>$inner</$style>',
    'blockquote' => '<blockquote>$inner</blockquote>',
    _ => '<p>$inner</p>',
  };
}

String _children(Map<String, dynamic> block) {
  final rawDefs = block['markDefs'];
  final defs = <String, Map<String, dynamic>>{
    if (rawDefs is List)
      for (final def in rawDefs.whereType<Map>())
        if (def['_key'] is String) def['_key'] as String: def.cast(),
  };
  final rawChildren = block['children'];
  if (rawChildren is! List) return '';
  final buffer = StringBuffer();
  for (final child in rawChildren.whereType<Map>()) {
    final span = child.cast<String, dynamic>();
    if (span['_type'] != 'span') continue;
    var text = escapeHtml(span['text'] as String? ?? '')
        .replaceAll('\n', '<br>');
    final marks = span['marks'];
    if (marks is List) {
      // Wrap innermost-first so the first mark ends up outermost.
      for (final mark in marks.whereType<String>().toList().reversed) {
        text = _wrap(mark, text, defs[mark]);
      }
    }
    buffer.write(text);
  }
  return buffer.toString();
}

String _wrap(String mark, String text, Map<String, dynamic>? def) {
  if (def != null) {
    if (def['_type'] == 'link') {
      final href = def['href'] as String? ?? '';
      if (href.isEmpty) return text;
      return '<a href="${escapeHtml(href)}">$text</a>';
    }
    return text;
  }
  return switch (mark) {
    'strong' => '<strong>$text</strong>',
    'em' => '<em>$text</em>',
    'underline' => '<u>$text</u>',
    'strike-through' => '<s>$text</s>',
    'code' => '<code>$text</code>',
    _ => text,
  };
}

String _image(Map<String, dynamic> block) {
  final url = block['url'] as String? ?? '';
  if (url.isEmpty) return '';
  final alt = escapeHtml(block['alt'] as String? ?? '');
  final caption = block['caption'] as String? ?? '';
  final src = escapeHtml('$url?w=1200&auto=format&q=80');
  final figcaption = caption.isEmpty
      ? ''
      : '<figcaption>${escapeHtml(caption)}</figcaption>';
  return '<figure><img src="$src" alt="$alt">$figcaption</figure>';
}

String escapeHtml(String text) => text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
