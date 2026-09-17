# Comments, profiles and direct messages: design

Members can comment on bike and pizza posts, reply once, like comments and
report them; the post's author can turn comments off; text is screened
before it is shown; administrators review what the screening or reports
hold back. Every username links to a profile with the member's join date,
location and post counts, and from the profile members can message each
other one on one. This document fixes the design so it can be built in a
series of pull requests. The comments part follows the decisions taken on
September 16, 2026 after a survey of Disqus, Hyvor Talk, Remark42,
Comentario, Coral, Cusdis, giscus and Stream; profiles and direct
messages were added on September 17.

## Decisions

| Area | Decision |
|---|---|
| Who | Signed-in members (verified email) read and write. Signed-out visitors see the count and "Sign in to read the comments". |
| Off switch | The post's author (or an admin) turns comments off per post; existing comments are kept but hidden while off. A sitewide switch in site settings, like the submit button. |
| Text | Plain text with bold, italic and links; no images. A pasted bare URL becomes `[link](url)`. Length cap 1,000 characters. |
| Mentions | `@username` of an existing member; makes the post fully unread again for that member (the blue dot comes back). No email. |
| Editing | Five-minute window, then an "(edited)" mark by the time. Delete any time. |
| Shape | Top-level comments with one level of replies. Oldest first. Twenty top-level comments per page with "load more"; three replies shown, "show N more replies". |
| Likes | Like with a count; tapping the count lists who liked it. |
| Screening | Automatic toxicity and topic scoring with thresholds; a banned word list that blocks; a suspicious word list that holds for review. Politics is held for review; swearing and slurs are blocked. |
| Reports | Report with a reason (racism, misogyny, harassment or too mean, politics, spam, other). Hidden automatically after two reports from different members, until an admin decides. |
| Post author | Can delete any comment on their own post. |
| Notifications | In-app only. A mention makes the post unread (dot, tab counters, app badge). Any other comment the member has not seen puts a "new comments" count on the post's tile, with the post otherwise still read. |
| Identity | Username, linking to the member's profile (see Profiles below). |
| Data | Comments and likes go in a member's data export; deleting the account deletes them. |
| Website | Post pages fetch comments live for signed-in visitors. Tiles show the count. |
| Later | Auto-translation of comments in other languages, with a "(translated, show original)" note. |

## Storage

Comments live under the post, written only by the functions (as with
reactions; the rules deny client access to the subcollection):

```
posts/{slug}
  commentCount             published comments, top-level and replies
  commentedAt              when the newest published comment was written
  commentTimes             [ISO, ...] of the newest 20 published comments, newest
                           first; the app counts unseen comments from it
  commentsEnabled          missing or true means on; false means off

posts/{slug}/comments/{id}
  uid, username            who wrote it (username copied, kept in step on rename)
  parentId                 null for a top-level comment, else the top-level id
  text                     as written, Markdown subset (bold, italic, links)
  html                     rendered and sanitized at write time
  mentions: [uid, ...]     members named with @
  createdAt, editedAt      ISO; editedAt null until edited
  status                   "published" | "pending" | "hidden" | "removed"
  hold                     why it is pending or hidden: "screen" | "words" | "reports" | null
  removedBy                "author" | "postAuthor" | "admin" | null
  screening                { language, scores: {category: 0..1}, matched: [word] } for the reviewer
  likeCount, replyCount    counts of published likes and replies
  reportCount              distinct reporters so far

posts/{slug}/comments/{id}/likes/{uid}      { uid, username, at }
posts/{slug}/comments/{id}/reports/{uid}    { uid, reason, at }

members/{uid}/notices/{id}                  { kind: "mention", post, comment, at }
settings/moderation                         { banned: [word], suspicious: [word] }
```

Statuses: `pending` is held by screening and invisible to members;
`hidden` is a published comment taken down by reports and invisible until
an admin restores or removes it; `removed` keeps the document so replies
under it still read, with `text` and `html` cleared. A top-level comment
that is removed and has no replies is deleted outright.

`commentCount`, `likeCount`, `replyCount` and `reportCount` are moved in
the same transaction as the write that changes them, as reaction tallies
are; `commentedAt` and `commentTimes` are rewritten from the newest
published comments whenever one is published, hidden or removed. None of
them touch `changedAt`: a comment does not make the post edited.
`commentsEnabled` is set through the post edit endpoint.

Usernames on comments and likes are kept in step by the rename path that
already updates posts and reactions (a collection-group index on `uid`
for each subcollection).

## Text

Comments are stored as a Markdown subset and rendered to HTML when
written, with `marked` and `sanitize-html` as post bodies are, allowing
only `strong`, `em`, `a` (with `rel="nofollow noopener"` and `target`)
and line breaks. Before rendering:

- A bare URL in the text (`https://…` not already inside a link) is
  replaced with `[link](https://…)`, so the comment reads "[link]".
- `@name` where `name` is an existing username becomes `**@name**` in the
  HTML and the member's uid goes in `mentions`. Unknown names stay plain.
- Headings, images, code blocks, tables and raw HTML are stripped.

The app's composer has three toolbar buttons (bold, italic, link) that
insert the Markdown markers around the selection; the field otherwise
holds plain text. Comments render with the HTML widget the post body
uses. The website renders `html` directly.

## API

All under `/api`, all requiring a verified member, admin where noted.
Comments are read through the API rather than Firestore so the sign-in
rule, the viewer's own likes and hidden-to-others states are applied in
one place, for the app and the website alike.

```
GET    /api/posts/{id}/comments?after=            page of top-level comments, oldest first,
                                                  each with its first three replies and
                                                  {liked, replyCount, likeCount}; the
                                                  caller's own pending comments included,
                                                  marked; 409 when comments are off
GET    /api/posts/{id}/comments/{cid}/replies     every reply of one comment
POST   /api/posts/{id}/comments                   {text, parentId?} -> the comment, or
                                                  {status: "pending"} when held, or 400
                                                  with a message when blocked
PATCH  /api/posts/{id}/comments/{cid}             {text}; author only, within five minutes;
                                                  screened again
DELETE /api/posts/{id}/comments/{cid}             author, the post's author, or admin
POST   /api/posts/{id}/comments/{cid}/like        toggles; -> {liked, likeCount}
GET    /api/posts/{id}/comments/{cid}/likes       usernames of everyone who liked it
POST   /api/posts/{id}/comments/{cid}/report      {reason}; one per member per comment
PATCH  /api/posts/{id}                            gains {comments: boolean}; author or admin

GET    /api/me/notices?since=                     {notices: [{kind, post, comment, at}]}:
                                                  the mentions, for the unread dots
GET    /api/me/export                             everything the member has: posts they are
                                                  credited on, comments, likes, reactions

GET    /api/admin/comments?queue=pending|reported|recent   admin
POST   /api/admin/comments/{cid}/approve|remove|restore    admin
GET    /api/admin/moderation                               admin; the word lists
PUT    /api/admin/moderation                               admin; {banned, suspicious}
```

Rate limit: one comment per member every fifteen seconds and two hundred
a day, checked in the write transaction against a small counter on the
member document. Refused with a friendly message.

Post edits: the `comments` field on `PATCH /api/posts/{id}` is applied at
once for the post's author too (no review), since it changes nothing on
the site.

## Screening

Every new or edited comment goes through, in order:

1. **Banned words.** Any match, as a whole word, case-insensitive, against
   `settings/moderation.banned`: refused with "That comment can't be
   posted." The reason is not spelled out.
2. **Toxicity and topics.** Google's Cloud Natural Language `moderateText`
   scores the text across categories that include Toxic, Insult,
   Profanity, Derogatory, Sexual, Violent, and Politics, and reports the
   language. It lives in the same Google Cloud project as the Vision API
   the photos go through, is enabled the same way (through the Pulumi
   program's API list), and is free at this volume. Thresholds, in the
   contract so they can be tuned:
   - Toxic, Insult, Profanity, Derogatory, Sexual or Violent at 0.8 or
     above: refused, as with banned words.
   - Any of those at 0.5 or above, or Politics at 0.5 or above: held as
     `pending` for review. The member sees "Your comment is waiting for
     review" in place of it; nobody else sees it.
3. **Suspicious words.** Any match against `settings/moderation.suspicious`:
   held for review.

Otherwise the comment is published at once. The word lists are edited on
the admin page and are not in the repository. What the screening saw is
stored on the comment for the reviewer.

The scoring's language field is what a later translation feature would
key on: a comment whose language is not English would get a
`translations: {en: html}` field filled by Cloud Translation at write
time, and clients would show the translation with "(translated, show
original)". Nothing is built for this now beyond storing the language.

## Reports and review

A member reports a comment with one reason from the contract's list
(`racism`, `misogyny`, `harassment` labeled "Too mean or harassing",
`politics`, `spam`, `other`). The second distinct reporter hides the
comment (`hidden`, `hold: "reports"`). Reporters cannot report a comment
twice, nor their own.

The admin page gets a **Comments** tab beside Users and News, with three
queues: pending (held by screening), reported (hidden or reported once),
and recent (everything published, newest first). Each row shows the
comment, the post, the author, what the screening saw and the report
reasons, with Approve (publish a pending or hidden comment; clears the
reports), Remove (status `removed`, `removedBy: "admin"`) and, on the
same tab, the two word lists as editable text areas. Admins need the
second factor as elsewhere.

Removing a comment: the author or the post's author from the app, an
admin from the admin page. A removed comment with replies shows as
"Comment removed" in the thread; without replies it disappears.

## Unread counters

Today the counters watch `changedAt` on posts: a post changed after the
tracker's baseline and not opened since is unread, gets the blue dot on
its tile, and counts on its tab and the app icon. Comments add two more
signals with different weights.

**A mention makes the post fully unread.** When a comment that names
the member is published (at write time, or when an admin approves it),
the function writes a notice of kind `mention` under the member. The
app's tracker fetches `GET /api/me/notices?since=<its baseline>` in the
same refresh as the changes query, and a post with a mention newer than
the time it was last opened is unread exactly as an edited post is: dot,
tab counter, badge. Opening the post clears it. Nothing is written for
replies to the member or comments on their posts; those fall under the
next rule.

**Any other unseen comment only adds a count.** The changes query also
returns posts whose `commentedAt` is after the baseline, with their
`commentTimes`. The tracker remembers when each post was last opened on
this device (`opened[id]`, alongside the marks it keeps today), and a
post's unseen comment count is the number of entries in `commentTimes`
after the later of the baseline and `opened[id]`, shown as "20+" when
all twenty are newer. The tile shows that count next to the total
("12 comments · 3 new") and stays read otherwise: no dot, nothing on
the tab counters or the badge. Opening the post sets `opened[id]` to now
and the count goes away. As today, nothing before the baseline is ever
unseen, so a fresh install starts clean; and the baseline only moves
past a post once it has neither an unread change nor unseen comments, so
the query stays small. `opened` entries are dropped with the marks once
they fall behind the baseline.

Mentions are the only notices for now; the `kind` field leaves room for
others (replies, comments on the member's post) if that rule ever
changes. Notices older than 60 days are deleted by the nightly
schedule. Signed-out, the counters work as today and no comment counts
are shown as new.

## App

- Under the reactions panel on a bike or pizza post: the count ("12
  comments"), then the comments, each with username, time (and
  "(edited)"), the text, a like button with its count, Reply, and an
  overflow menu with Edit (within five minutes, own comment), Delete (own
  comment, or any on the member's own post) and Report. Replies are
  indented under their comment, three shown, "Show N more replies".
- A composer at the bottom with the three toolbar buttons, the character
  count, and Post; replying puts "Replying to name" above it. A held
  comment shows in place with "Waiting for review".
- Signed out: the count and "Sign in from Settings to read the comments".
- Comments off: "Comments are off for this post" and no composer.
- The edit screen gets a "Comments" switch for the post's author and
  admins.
- Tiles and the list rows show the count from `commentCount` on the post,
  and "N new" after it while the tracker says some are unseen.
- Tapping a like count opens a sheet listing usernames.
- Errors from the API (blocked, rate-limited, off) show as they come, in
  a snackbar.

## Website

Post pages are static and have no sign-in of their own; the account page
at `/account/` shares the origin and keeps the Firebase session in the
browser. The post page loads the Firebase Auth script, and if a session
is present, fetches the comments from the API with the ID token and
renders them under the post with the same layout (read, like, reply,
report, delete, and the composer). Without a session it shows the count
and "Sign in to read the comments" linking to `/account/`. The count in
tiles comes from the post at build time, so it is as fresh as the last
rebuild. Comments do not trigger site rebuilds.

## Profiles

A profile is what a username opens: on posts (the credit line), comments
and like lists in the app, and on the website's post pages and comments.
Reaction tooltips stay plain text, since a hover cannot be tapped. It
shows:

- the username;
- "Joined <month day, year>";
- the location, when the member has set one;
- "N pizzas" and "N bikes", each opening the member's published posts in
  that feed, newest first;
- a "Message" button (signed-in members, not on their own profile; see
  Direct messages).

Nothing else: no email, no name, no bio, no avatar. The profile is public
on the website, as the member's post list already is; the app shows it
to anyone as well, with the Message button only for signed-in members.

### Storage

`members/{uid}` gains:

```
joinedAt     copied from the Firebase user's creation time the first time
             the record is loaded without one (older records) or created
location     up to 60 characters, free text, optional; "" when unset
messages     missing or true: others may start a conversation; false hides
             the Message button and refuses new conversations
```

The post counts are not stored: the API counts them with Firestore
aggregation queries on `posts` (`credit.uid`, `feed`, published) when
the profile is fetched. The two queries are cheap and always right.

The location is set on the account screen in the app and on the account
page on the website, labeled "Location (shown on your profile)". It is
trimmed, checked against the banned word list, and otherwise free: a
city, a region, "somewhere in Ohio". Nothing geocodes it.

### API

```
GET  /api/members/{username}          public; -> {username, joinedAt, location,
                                      counts: {pizza, bikes}, messages: boolean}
                                      404 when no member has the username
GET  /api/members/{username}/posts?feed=pizza|bikes&page=
                                      public; the member's published posts in one
                                      feed, newest first, as the feed pages are
```

The `member` callable's record and `updateMember`'s patch gain
`location` and `messages`. `messages` in the profile reply is false when
the member has turned messages off, when the caller is blocked by them,
or when the caller is signed out.

### App

- `ProfileScreen(username)` reached by tapping a username anywhere it is
  shown. The credit line on a post, the author line on a comment and the
  names in the likes sheet become taps.
- The counts open a `PostListScreen` filtered to the member and feed;
  `fetchPosts(feed, uid:)` already does the query, so the screen gets a
  title ("Pizzas by ada_bikes") and no submit button.
- The member's own profile is reachable from Settings, above "Manage
  account", so they can see what others see.
- The account screen gets the location field and an "Allow direct
  messages" switch.

### Website

`/member/<username>/` exists today as the static grid of a member's
posts, built for members with at least one post. It becomes the profile:
a header with the join date, location and counts fetched from
`GET /api/members/<username>` when the page loads, then the grid split
by feed with the two counts as anchors into it. For members with no
posts there is no static page, so a Hosting rewrite sends
`/member/**` to a single `member/index.html` that reads the username
from the path and renders the header alone; static pages take precedence
over rewrites, so members with posts keep their built page. The Message
button on the website opens the app (see Direct messages).

## Direct messages

One-on-one conversations between members, from the Message button on a
profile. The design leaves room for groups (a conversation has a list
of members) but nothing creates one with more than two yet.

### Decisions

| Area | Decision |
|---|---|
| Who | Signed-in members with a verified email and a username. Either member of a conversation may write; anyone may start one with a member who has not turned messages off or blocked them. |
| Text | Same rules as comments: bold, italic, links, bare URLs to "[link]", 1,000 characters, no images. @mentions are plain text. |
| Editing | Five-minute window with "(edited)"; delete any time, leaving "Message deleted" for both. |
| Screening | Banned words block. Toxicity scores at or above the block threshold block; nothing is held, since nobody reviews private messages. |
| Blocking | A member can block another from the profile or the conversation. Blocking ends the conversation for both (it stays readable, nothing more can be sent), hides the Message button, and hides the blocked member's comments from the blocker. |
| Reports | A member can report a conversation with a reason; that lets admins read it. Admins cannot read conversations that have not been reported. |
| Unread | Per-conversation unread counts; a Messages button on the feed screens with the total; the app icon badge adds the total to the unread posts. In-app only, like comments; push later. |
| Where | The app only, for now. The website's profile shows "Message in the app". |
| Retention | Kept until deleted. Account deletion deletes the member's messages (the other member keeps the conversation with "Message deleted" placeholders) and their side of every conversation. |
| Later | Groups, images, push notifications, messages on the website. |

### Storage

```
conversations/{id}                 id = the two uids sorted and joined with "_"
  members: [uidA, uidB]
  usernames: {uid: username}       copied, kept in step by the rename path
  createdAt, lastMessageAt
  last: {uid, text, at}            the newest message's first 100 characters
  unread: {uid: n}                 messages the member has not seen
  seenAt: {uid: ISO}               when each member last opened it
  blockedBy: [uid, ...]            members who blocked the other; empty when open
  reportedAt, reportedBy, reason   set by a report; lets admins read it

conversations/{id}/messages/{mid}
  uid, text, html, createdAt, editedAt, deletedAt
  screening                        as on comments

members/{uid}/blocks/{otherUid}    { at }
```

The app reads conversations and messages straight from Firestore with
snapshot listeners, so a conversation updates live while it is open and
the list reorders as messages arrive; the rules allow a signed-in member
to read a conversation whose `members` include their uid, and its
messages by looking the parent up. Everything is written through the
API: a message goes through the text pipeline and screening, moves the
other member's unread count and `last`, and refuses when either member
has blocked the other. Opening a conversation posts `seen`, which zeroes
the member's count and stamps `seenAt`. This is the one place the app
reads Firestore directly for member data; the comments stay on the API
because their pages, screening states and counts are easier to shape
there, and because live updates matter less under a post than in a chat.

### API

```
GET    /api/me/conversations                    the member's conversations, newest
                                                first, with unread counts (fallback
                                                for the website and tests; the app
                                                listens instead)
POST   /api/me/conversations                    {username} -> the conversation with
                                                that member, created if needed; 403
                                                when they have messages off or
                                                either has blocked the other
POST   /api/conversations/{id}/messages         {text} -> the message; 1 per 2 s and
                                                500 a day per member; 20 new
                                                conversations a day
PATCH  /api/conversations/{id}/messages/{mid}   {text} within five minutes
DELETE /api/conversations/{id}/messages/{mid}   own message
POST   /api/conversations/{id}/seen             zeroes the caller's unread count
POST   /api/conversations/{id}/report           {reason}; same reasons as comments
POST   /api/members/{username}/block            and DELETE to unblock
GET    /api/me/blocks                           usernames the member has blocked

GET    /api/admin/conversations?queue=reported  admin; the reported conversations
GET    /api/admin/conversations/{id}            admin; a reported conversation's
                                                messages
```

### App

- A Messages button (envelope) in the app bar of the feed screens, with
  the unread total as a badge; it opens the conversation list: username,
  the last message's preview, its time, and the unread count in bold.
- A conversation screen: messages in bubbles, own on the right, with
  times; the composer at the bottom with the same toolbar as comments; a
  menu with Block and Report. Own messages get Edit (five minutes) and
  Delete on long press.
- Signed-out or without a username: the Message button on profiles is
  hidden; the Messages button in the app bar shows "Sign in from
  Settings to message members".
- The unread tracker learns a second total from the conversations
  listener so the app icon badge is posts plus messages.
- Settings gets "Blocked members" under "Manage account".

## Account deletion and export

`deleteAccount` (and the admin's delete user) also: deletes the member's
comments (a top-level comment with replies becomes `removed` with no
author; the rest are deleted), their likes (moving counts down), their
reports, reactions, notices, blocks, and their messages (each becomes
"Message deleted" for the other member, and the conversation drops the
deleted uid from `members`; a conversation with nobody left is deleted).
`GET /api/me/export` returns a JSON document with the member's profile
(including location), posts credited to them, comments, likes,
reactions, and the messages they wrote, offered from the app's account
screen as "Export my data" (the app saves the file through the share
sheet).

## Contract

`contract/comments.json` adds: `maxLength` (1000), `editWindowMinutes`
(5), `pageSize` (20), `repliesShown` (3), `reportsToHide` (2), the report
reasons with labels, and the screening thresholds. `contract/members.json`
adds `locationMaxLength` (60) and the message limits (`maxLength` 1000,
`editWindowMinutes` 5, `previewLength` 100). Generated into the three
copies as the rest of the contract is.

## Firestore

- Rules: `posts/{slug}/comments/**`, `members/{uid}/notices/**` and
  `members/{uid}/blocks/**` stay under the deny-all rule.
  `conversations/{id}` is readable by a signed-in user whose uid is in
  `members`, and `conversations/{id}/messages/{mid}` by one whose uid is
  in the parent's `members` (a `get()` in the rule); nothing is writable
  by clients.
- Indexes: `posts` on `commentedAt` for the changes query and on
  `credit.uid`, `feed`, `publishedAt` for the profile counts and lists;
  `comments` collection group on `uid` (renames and deletion), `likes`
  and `reports` collection groups on `uid`; `comments` single collection
  index on `status`, `parentId`, `createdAt` for the pages; admin queues
  on `status` and `createdAt`; `conversations` on `members`
  (array-contains) and `lastMessageAt` for the list; `messages`
  collection group on `uid` for deletion and export.

## Pull requests

1. **Functions and contract**: storage, text pipeline, screening with the
   Natural Language API, the comment, like, report and notice endpoints,
   moderation word lists, account deletion and export. Tests as for
   reactions. Enable the API through `infra/` for both projects.
2. **App**: comment list, composer, likes sheet, report dialog, edit
   window, mention notices and unseen comment counts in the tracker,
   comments switch on the edit screen, counts on tiles, data export.
3. **Admin page**: the Comments tab with the three queues and the word
   lists.
4. **Website**: comments on post pages for signed-in visitors, counts on
   tiles.
5. **Profiles**: `joinedAt`, `location` and `messages` on the member
   record and the account surfaces (app and website), the two profile
   endpoints, the profile screen and filtered post list in the app,
   usernames as links everywhere, the website profile header and the
   `/member/**` rewrite.
6. **Direct messages, functions**: conversations, messages, seen, block,
   report, the admin queue, rules and indexes, deletion and export.
7. **Direct messages, app**: the Messages button and list, the
   conversation screen, blocking and reporting, the badge total.

Each leaves `main` deployable; the app does nothing visible until the
functions are deployed.
