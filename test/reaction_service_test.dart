import 'dart:convert';

import 'package:bikes_pizza/api/api_client.dart';
import 'package:bikes_pizza/contract.dart';
import 'package:bikes_pizza/posts/reaction_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  final had = reactionPalettes['pizza']!.first;

  test('reactions parse counts and picks, tolerating odd shapes', () {
    final r = PostReactions.fromJson({
      'counts': {
        'had': {'yes': 2, 'no': 0},
        'oops': 'x',
      },
      'mine': {
        'had': ['yes'],
        'fantastic': 'cheese',
      },
      'who': {
        'had': {
          'yes': {
            'names': ['ada_bikes', 'bob_pizza'],
            'more': 3,
          },
          'no': {'names': [], 'more': 0},
        },
        'fantastic': 'nope',
      },
    });
    expect(r.count('had', 'yes'), 2);
    expect(r.names('had', 'yes')!.line, 'ada_bikes, bob_pizza and 3 more');
    expect(r.names('had', 'no')!.line, isNull);
    expect(r.names('fantastic', 'cheese'), isNull);
    expect(r.withPicks(had, ['no']).names('had', 'yes')!.names, [
      'ada_bikes',
      'bob_pizza',
    ]);
    expect(r.count('had', 'maybe'), 0);
    expect(r.count('fantastic', 'cheese'), 0);
    expect(r.picked('had', 'yes'), isTrue);
    expect(r.picked('had', 'no'), isFalse);
    expect(r.mine, {
      'had': ['yes'],
    });
  });

  test('who picked an option reads as a line', () {
    expect(const ReactionNames().line, isNull);
    expect(const ReactionNames(names: ['ada']).line, 'ada');
    expect(const ReactionNames(names: ['ada', 'bob']).line, 'ada, bob');
    expect(const ReactionNames(names: ['ada'], more: 1).line, 'ada and 1 more');
    expect(const ReactionNames(more: 1).line, '1 member');
    expect(const ReactionNames(more: 4).line, '4 members');
  });

  test('withPicks moves the tallies as the server will', () {
    const start = PostReactions(
      counts: {
        'had': {'yes': 1},
      },
      mine: {
        'had': ['yes'],
      },
    );
    final swapped = start.withPicks(had, ['no']);
    expect(swapped.counts, {
      'had': {'yes': 0, 'no': 1},
    });
    expect(swapped.mine, {
      'had': ['no'],
    });
    final cleared = swapped.withPicks(had, []);
    expect(cleared.counts, {
      'had': {'yes': 0, 'no': 0},
    });
    expect(cleared.picked('had', 'no'), isFalse);
    // The original is untouched.
    expect(start.count('had', 'yes'), 1);
  });

  test(
    'the API service reads and replaces picks on the post endpoint',
    () async {
      final requests = <http.Request>[];
      final client = MockClient((request) async {
        requests.add(request);
        return http.Response(
          jsonEncode({
            'counts': {
              'had': {'yes': 1, 'no': 0},
            },
            'mine': {
              'had': ['yes'],
            },
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final service = ApiReactionService(
        ApiClient(
          baseUrl: 'https://submissions.example.com',
          token: () async => 'tok',
          client: client,
        ),
      );
      final seen = await service.fetch('detroit slice');
      expect(seen.count('had', 'yes'), 1);
      expect(requests.single.method, 'GET');
      expect(
        requests.single.url.toString(),
        'https://submissions.example.com/api/posts/detroit%20slice/reactions',
      );

      final set = await service.set('detroit-slice', {
        'had': ['yes'],
      });
      expect(set.picked('had', 'yes'), isTrue);
      expect(requests.last.method, 'POST');
      expect(jsonDecode(requests.last.body), {
        'picks': {
          'had': ['yes'],
        },
      });
    },
  );
}
