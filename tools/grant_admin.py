#!/usr/bin/env python3
"""Grant (or revoke) the `admin` custom claim on a Firebase user.

Admins can open the submissions review page and call the reviewSubmission
function. Uses the Firebase CLI's signed-in credentials (run
`firebase login` first) and the default project from .firebaserc.

Usage:
    tools/grant_admin.py you@example.com
    tools/grant_admin.py --revoke you@example.com
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("email")
    ap.add_argument("--revoke", action="store_true")
    ap.add_argument("--project", help="Firebase project ID (default: the default project in .firebaserc)")
    args = ap.parse_args()

    project = args.project or json.load(open(os.path.join(ROOT, ".firebaserc")))["projects"]["default"]
    store = os.path.expanduser("~/.config/configstore/firebase-tools.json")
    try:
        token = json.load(open(store))["tokens"]["access_token"]
    except (OSError, KeyError):
        sys.exit("Firebase CLI credentials not found; run `firebase login` and retry.")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    base = f"https://identitytoolkit.googleapis.com/v1/projects/{project}/accounts"

    def post(path, body):
        req = urllib.request.Request(base + path, data=json.dumps(body).encode(), headers=headers)
        try:
            with urllib.request.urlopen(req) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            msg = json.loads(e.read() or b"{}").get("error", {}).get("message", e.reason)
            if e.code == 401:
                msg += " (token expired: run `firebase projects:list` to refresh, then retry)"
            sys.exit(f"{path}: {e.code} {msg}")

    users = post(":lookup", {"email": [args.email]}).get("users", [])
    if not users:
        sys.exit(f"No Firebase user with email {args.email}. They must sign in once first.")
    user = users[0]
    claims = json.loads(user.get("customAttributes") or "{}")
    if args.revoke:
        claims.pop("admin", None)
    else:
        claims["admin"] = True
    post(":update", {"localId": user["localId"], "customAttributes": json.dumps(claims)})
    print(f"{'Revoked' if args.revoke else 'Granted'} admin for {args.email}. "
          "Takes effect on their next token refresh (sign out and in, or up to an hour).")


if __name__ == "__main__":
    main()
