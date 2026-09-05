#!/usr/bin/env bash
# Spaces out website rebuilds: waits until at least MIN_INTERVAL seconds
# (default 300) have passed since the last deployment to ENVIRONMENT
# finished, and until none is in progress. Runs as a gate job before the
# deploy in .github/workflows/deploy-site.yml; with cancel-in-progress on
# that job, a burst of content changes ends in one rebuild, of the newest
# content, no sooner than five minutes after the previous one.
#
# Reads the environment's deployment records (every job that declares the
# environment creates one), so merge and release deploys count too.
# Needs GH_TOKEN with deployments: read, and GH_REPO (owner/name).
set -euo pipefail

: "${ENVIRONMENT:?set ENVIRONMENT}"
: "${GH_REPO:?set GH_REPO}"
interval=${MIN_INTERVAL:-300}
deadline=$(( $(date +%s) + ${MAX_WAIT:-900} ))

# ISO-8601 UTC timestamp to epoch seconds, on GNU (runners) or BSD (a Mac) date.
to_epoch() {
  date -u -d "$1" +%s 2>/dev/null || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$1" +%s
}

while :; do
  now=$(date +%s)
  latest=0
  busy=""
  for id in $(gh api "repos/$GH_REPO/deployments?environment=$ENVIRONMENT&per_page=5" --jq '.[].id'); do
    status=$(gh api "repos/$GH_REPO/deployments/$id/statuses?per_page=1" --jq '.[0] | "\(.state) \(.created_at)"')
    [ -n "$status" ] || continue
    state=${status%% *}
    at=$(to_epoch "${status#* }")
    case "$state" in
      in_progress|queued|pending|waiting) busy="$id" ;;
      *) [ "$at" -gt "$latest" ] && latest=$at ;;
    esac
  done

  if [ -n "$busy" ]; then
    echo "Deployment $busy to $ENVIRONMENT is in progress; checking again in 30s."
    wait=30
  else
    remaining=$(( interval - (now - latest) ))
    if [ "$remaining" -le 0 ]; then
      echo "Last deployment to $ENVIRONMENT finished $(( now - latest ))s ago; going ahead."
      exit 0
    fi
    echo "Last deployment to $ENVIRONMENT finished $(( now - latest ))s ago; waiting ${remaining}s more."
    wait=$(( remaining < 60 ? remaining : 60 ))
  fi

  if [ "$now" -ge "$deadline" ]; then
    echo "::warning::Waited the maximum time for $ENVIRONMENT; rebuilding anyway."
    exit 0
  fi
  left=$(( deadline - now ))
  sleep $(( wait < left ? wait : left ))
done
