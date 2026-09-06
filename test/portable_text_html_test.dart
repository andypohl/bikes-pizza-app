import 'package:flutter_test/flutter_test.dart';
import 'package:bikes_pizza/data/portable_text_html.dart';

Map<String, dynamic> span(String text, [List<String> marks = const []]) => {
  '_type': 'span',
  '_key': text.hashCode.toString(),
  'text': text,
  'marks': marks,
};

Map<String, dynamic> block(
  List<Map<String, dynamic>> children, {
  String style = 'normal',
  String? listItem,
  int level = 1,
  List<Map<String, dynamic>> markDefs = const [],
}) => {
  '_type': 'block',
  '_key': children.first['_key'],
  'style': style,
  'listItem': ?listItem,
  if (listItem != null) 'level': level,
  'markDefs': markDefs,
  'children': children,
};

void main() {
  test('renders paragraphs, headings and quotes', () {
    expect(
      portableTextToHtml([
        block([span('Hello')]),
        block([span('Head')], style: 'h2'),
        block([span('Quote')], style: 'blockquote'),
      ]),
      '<p>Hello</p><h2>Head</h2><blockquote>Quote</blockquote>',
    );
  });

  test('applies decorators and link annotations', () {
    final html = portableTextToHtml([
      block(
        [
          span('Go to '),
          span('Rocky', ['strong', 'l1']),
          span('!'),
        ],
        markDefs: [
          {
            '_key': 'l1',
            '_type': 'link',
            'href': 'https://rockys.example/?a=1&b=2',
          },
        ],
      ),
    ]);
    expect(
      html,
      '<p>Go to <strong><a href="https://rockys.example/?a=1&amp;b=2">Rocky</a></strong>!</p>',
    );
  });

  test('escapes HTML in text and keeps line breaks', () {
    expect(
      portableTextToHtml([
        block([span('a <b> & "c"\nd')]),
      ]),
      '<p>a &lt;b&gt; &amp; &quot;c&quot;<br>d</p>',
    );
  });

  test('groups list items into nested lists', () {
    final html = portableTextToHtml([
      block([span('one')], listItem: 'bullet'),
      block([span('two')], listItem: 'bullet'),
      block([span('two-a')], listItem: 'bullet', level: 2),
      block([span('three')], listItem: 'number'),
      block([span('after')]),
    ]);
    expect(
      html,
      '<ul><li>one</li><li>two<ul><li>two-a</li></ul></li></ul>'
      '<ol><li>three</li></ol><p>after</p>',
    );
  });

  test('renders image blocks with captions and skips unknown types', () {
    final html = portableTextToHtml([
      {
        '_type': 'image',
        '_key': 'i1',
        'url': 'https://cdn.sanity.io/images/p/d/x-10x10.jpg',
        'alt': 'A slice',
        'caption': 'Nice & hot',
      },
      {'_type': 'mystery', '_key': 'm1'},
    ]);
    expect(
      html,
      '<figure><img src="https://cdn.sanity.io/images/p/d/x-10x10.jpg?w=1200&amp;auto=format&amp;q=80" alt="A slice"><figcaption>Nice &amp; hot</figcaption></figure>',
    );
  });
}
