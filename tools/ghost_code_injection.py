#!/usr/bin/env python3
"""Install (or update) the account-page snippet in the Ghost site's header.

Usage:
    tools/ghost_code_injection.py --credentials ~/path/to/ghost-creds.txt [--account-url URL]

The credentials file holds KEY=VALUE lines with ADMIN_API_KEY and API_URL
(the values shown on the custom integration in Ghost Admin). The account
URL defaults to the Firebase Hosting site of the default project in
.firebaserc. The snippet is wrapped in markers so re-running replaces it
without touching anything else in the header code injection.

Prints only status lines; never prints the key.
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
START = "<!-- pizza-predator-account:start -->"
END = "<!-- pizza-predator-account:end -->"


def admin_token(key):
    kid, secret = key.split(":")
    b64 = lambda x: base64.urlsafe_b64encode(x).rstrip(b"=").decode()
    now = int(time.time())
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT", "kid": kid}).encode())
    payload = b64(json.dumps({"iat": now, "exp": now + 300, "aud": "/admin/"}).encode())
    sig = b64(hmac.new(bytes.fromhex(secret), f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def request(url, token, method="GET", body=None):
    req = urllib.request.Request(
        url,
        method=method,
        headers={"Authorization": f"Ghost {token}", "Accept-Version": "v6.0", "Content-Type": "application/json"},
        data=None if body is None else json.dumps(body).encode(),
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        sys.exit(f"Ghost returned {e.code}: {detail}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--credentials", required=True)
    ap.add_argument("--account-url")
    ap.add_argument("--remove", action="store_true", help="remove the snippet instead")
    args = ap.parse_args()

    creds = {}
    for line in open(os.path.expanduser(args.credentials)):
        if "=" in line:
            k, v = line.strip().split("=", 1)
            creds[k] = v
    token = admin_token(creds["ADMIN_API_KEY"])
    api = creds["API_URL"].rstrip("/") + "/ghost/api/admin"

    account_url = args.account_url
    if not account_url:
        project = json.load(open(os.path.join(ROOT, ".firebaserc")))["projects"]["default"]
        account_url = f"https://{project}.web.app/"

    snippet = open(os.path.join(ROOT, "web", "ghost-code-injection.html")).read()
    snippet = re.sub(r"<!--.*?-->\n", "", snippet, count=1, flags=re.S)  # drop the file comment
    snippet = snippet.replace("__ACCOUNT_URL__", account_url).strip()
    block = f"{START}\n{snippet}\n{END}"

    settings = request(f"{api}/settings/?filter=key:codeinjection_head", token)
    current = next((s["value"] for s in settings["settings"] if s["key"] == "codeinjection_head"), None) or ""
    pattern = re.compile(re.escape(START) + r".*?" + re.escape(END), re.S)
    if args.remove:
        updated = pattern.sub("", current).strip()
    elif pattern.search(current):
        updated = pattern.sub(lambda _: block, current)
    else:
        updated = (current.rstrip() + "\n\n" + block).strip()

    if updated == current:
        print("header code injection already up to date")
        return
    request(f"{api}/settings/", token, method="PUT", body={"settings": [{"key": "codeinjection_head", "value": updated}]})
    print("removed snippet" if args.remove else f"installed snippet pointing at {account_url}")


if __name__ == "__main__":
    main()
