#!/usr/bin/env python3
"""Print the account-page snippet for Ghost's header code injection.

Ghost does not let integration API keys change site settings (that needs a
staff login), so this cannot be installed automatically. Instead the script
fills in the account page URL, prints the snippet, and copies it to the
clipboard on macOS. Paste it into Ghost Admin > Settings > Code injection >
Site header and save.

Usage:
    tools/ghost_code_injection.py [--account-url URL]

The account URL defaults to the Firebase Hosting site of the default project
in .firebaserc. Re-run and re-paste (replacing the old block) whenever
web/ghost-code-injection.html changes.
"""
import argparse
import json
import os
import re
import shutil
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
START = "<!-- pizza-predator-account:start -->"
END = "<!-- pizza-predator-account:end -->"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--account-url")
    args = ap.parse_args()

    account_url = args.account_url
    if not account_url:
        project = json.load(open(os.path.join(ROOT, ".firebaserc")))["projects"]["default"]
        account_url = f"https://{project}.web.app/"

    snippet = open(os.path.join(ROOT, "web", "ghost-code-injection.html")).read()
    snippet = re.sub(r"<!--.*?-->\n", "", snippet, count=1, flags=re.S)  # drop the file comment
    snippet = snippet.replace("__ACCOUNT_URL__", account_url).strip()
    block = f"{START}\n{snippet}\n{END}\n"

    print(block)
    if shutil.which("pbcopy"):
        subprocess.run(["pbcopy"], input=block.encode(), check=True)
        print("(copied to clipboard)")
    print("Paste into Ghost Admin > Settings > Code injection > Site header, then Save.")


if __name__ == "__main__":
    main()
