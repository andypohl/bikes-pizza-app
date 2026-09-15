import 'package:bikes_pizza/posts/plain_text_html.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('renders paragraphs with line breaks and escapes HTML', () {
    expect(
      plainTextToHtml('First.\n\n\nSecond <b>line</b>\r\nmore & more\n\n'),
      '<p>First.</p><p>Second &lt;b&gt;line&lt;/b&gt;<br>more &amp; more</p>',
    );
    expect(plainTextToHtml('  \n\n '), '');
    expect(escapeHtml('"a" & \'b\''), '&quot;a&quot; &amp; &#39;b&#39;');
  });
}
