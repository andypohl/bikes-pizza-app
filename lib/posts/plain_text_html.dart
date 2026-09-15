/// Plain text as the post editor saves it (paragraphs separated by blank
/// lines) rendered the way the functions render a `text` body
/// (functions/markdown.js), so an edited post can be shown before it is
/// fetched again.
String plainTextToHtml(String text) {
  final paragraphs = text
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .split(RegExp(r'\n{2,}'))
      .map((p) => p.trim())
      .where((p) => p.isNotEmpty);
  return [
    for (final p in paragraphs)
      '<p>${escapeHtml(p).replaceAll('\n', '<br>')}</p>',
  ].join();
}

String escapeHtml(String text) => text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
