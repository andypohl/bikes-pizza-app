// Asks GitHub to rebuild the website after the functions publish a post.
// The site is static, so a post that reaches Sanity only shows once the
// "Rebuild website" workflow (.github/workflows/deploy-site.yml) has run;
// this sends the same `repository_dispatch` event the Sanity webhook does,
// with the environment in the payload so only that environment's site is
// rebuilt. Failures are logged, never thrown: the post is already
// published and the scheduled run must not retry because of GitHub.

export const EVENT_TYPE = "sanity-content-changed";
export const DEFAULT_REPOSITORY = "andypohl/pizza-predator-app";

/** Values a placeholder secret might hold; treated as "no token". */
const PLACEHOLDERS = new Set(["", "unset", "placeholder", "none"]);

/**
 * Sends the dispatch. `environment` is "production" or "development";
 * `reason` is free text for the workflow log. Resolves to true when GitHub
 * accepted the event.
 */
export async function requestRebuild(
  { repository = DEFAULT_REPOSITORY, environment, reason = "" },
  { token, fetchImpl = fetch, log = () => {} },
) {
  const secret = (token ?? "").trim();
  if (PLACEHOLDERS.has(secret.toLowerCase())) {
    log("rebuild skipped: GITHUB_DISPATCH_TOKEN not set", { environment });
    return false;
  }
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repository}/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ event_type: EVENT_TYPE, client_payload: { environment, reason } }),
    });
    if (res.status !== 204) {
      const body = await res.text().catch(() => "");
      log("rebuild request failed", { environment, status: res.status, body: body.slice(0, 200) });
      return false;
    }
    log("rebuild requested", { environment, reason });
    return true;
  } catch (error) {
    log("rebuild request failed", { environment, message: error.message });
    return false;
  }
}
