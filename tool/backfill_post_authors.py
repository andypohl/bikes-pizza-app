#!/usr/bin/env python3
"""Give posts published before member documents existed their `author` reference.

For each Sanity post with `source.system == "submission"` and no `author`,
reads the submission from Firestore for the member's uid, reads their
username from `members/{uid}`, finds or creates the `member` document in
Sanity, and patches the post. Safe to re-run: posts that already have an
author are skipped.

    tools/backfill_post_authors.py                    # production project + dataset
    tools/backfill_post_authors.py --project bikes-pizza-dev --dataset development
    tools/backfill_post_authors.py --dry-run

Firestore is read with the Firebase CLI's credentials (`firebase login`);
Sanity is written with the Sanity CLI's (`npx sanity login` in studio/).
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SANITY_PROJECT = "nva9b0ia"
API_VERSION = "2025-02-19"


def request(url, token, body=None, method=None, missing_ok=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method or ("POST" if data else "GET"),
        headers={"Authorization": f"Bearer {token}", **({"Content-Type": "application/json"} if data else {})},
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404 and missing_ok:
            return None
        hint = " (token expired: run `firebase projects:list` to refresh, then retry)" if e.code == 401 else ""
        sys.exit(f"{method or 'GET'} {url}: {e.code} {e.read().decode()[:300]}{hint}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", help="Firebase project ID (default: the default project in .firebaserc)")
    ap.add_argument("--dataset", default="production", help="Sanity dataset (default: production)")
    ap.add_argument("--dry-run", action="store_true", help="report what would change without writing")
    args = ap.parse_args()
    project = args.project or json.load(open(os.path.join(ROOT, ".firebaserc")))["projects"]["default"]

    try:
        fb_token = json.load(open(os.path.expanduser("~/.config/configstore/firebase-tools.json")))["tokens"]["access_token"]
    except (OSError, KeyError):
        sys.exit("Firebase CLI credentials not found; run `firebase login` and retry.")
    try:
        sanity_cfg = json.load(open(os.path.expanduser("~/.config/sanity/config.json")))
        sanity_token = sanity_cfg.get("authToken") or sanity_cfg["token"]
    except (OSError, KeyError):
        sys.exit("Sanity CLI credentials not found; run `npx sanity login` in studio/ and retry.")

    firestore = f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents"
    sanity = f"https://{SANITY_PROJECT}.api.sanity.io/v{API_VERSION}/data"

    def groq(query, **params):
        qs = urllib.parse.urlencode({"query": query, **{f"${k}": json.dumps(v) for k, v in params.items()}})
        return request(f"{sanity}/query/{args.dataset}?{qs}", sanity_token)["result"]

    def mutate(mutations):
        return request(f"{sanity}/mutate/{args.dataset}?returnIds=true", sanity_token, {"mutations": mutations})

    def field(doc, name):
        value = doc.get("fields", {}).get(name, {})
        return value.get("stringValue")

    posts = groq('*[_type == "post" && source.system == "submission" && !defined(author)]{_id, title, "submissionId": source.id}')
    print(f"{len(posts)} post(s) without an author in {args.dataset}")
    for post in posts:
        sub = request(f"{firestore}/submissions/{post['submissionId']}", fb_token, missing_ok=True) if post["submissionId"] else None
        uid = field(sub, "uid") if sub else None
        if not uid:
            # A dataset copied from production carries production submission
            # ids that the other project's Firestore does not have.
            print(f"  skip {post['_id']} ({post['title']}): submission {post['submissionId']} not in {project}")
            continue
        member = request(f"{firestore}/members/{uid}", fb_token, missing_ok=True)
        username = (field(member, "username") if member else None) or ""
        existing = groq('*[_type == "member" && uid == $uid][0]{_id, username}', uid=uid)
        if existing:
            member_id = existing["_id"]
            if (existing.get("username") or "") != username and not args.dry_run:
                mutate([{"patch": {"id": member_id, "set": {"username": username}}}])
        elif args.dry_run:
            member_id = "(new)"
        else:
            member_id = mutate([{"create": {"_type": "member", "uid": uid, "username": username}}])["results"][0]["id"]
        print(f"  {post['_id']} ({post['title']}) -> member {member_id} username={username!r}")
        if not args.dry_run:
            mutate([{"patch": {"id": post["_id"], "set": {"author": {"_type": "reference", "_ref": member_id}}}}])
    print("dry run, nothing written" if args.dry_run else "done")


if __name__ == "__main__":
    main()
