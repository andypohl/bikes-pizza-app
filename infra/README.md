# bikes.pizza infrastructure

Pulumi program (TypeScript) for the cloud resources of one environment:
the Google Cloud / Firebase project and what is inside it (enabled APIs,
Firestore, the Storage bucket, Auth settings, Hosting sites and custom
domains, the deploy service account with its keyless GitHub access, Secret
Manager entries), the Cloudflare DNS records that point the domains at
Firebase Hosting, and the GitHub environment whose variables
`.github/workflows/deploy.yml` reads.

One stack per environment; the differences are all in the stack's config:

| stack  | Firebase project      | domain            | GitHub environment | state |
|--------|-----------------------|-------------------|--------------------|-------|
| `dev`  | `bikes-pizza-dev`     | `bikes-pizza.dev` | `development`      | imported, `pulumi preview` shows no changes |
| `prod` | `pizzapredator-a445e` | `bikes.pizza`     | `production`       | config only; see "Importing prod" |

Application deploys are not done here. Functions, Hosting content, and the
Firestore and Storage rules go out through the Firebase CLI in the GitHub
workflows on every merge (development) or release (production). Pulumi only
runs when something in this directory changes.

## What is deliberately not managed

- Google sign-in: enabling it needs an OAuth client that only the Firebase
  console can create. Apple sign-in: its private key must not live in
  Pulumi state, and the Services ID lives in Apple Developer.
- Secret values. The program creates the Secret Manager entries; the values
  are set with `firebase functions:secrets:set` and never pass through state.
- Sanity (project, datasets, Studio) and Shopify; neither has a provider.
- The Flutter app registrations (`flutterfire configure`), the Resize Images
  extension, and the Artifact Registry cleanup policy the Firebase CLI sets.
- Cloud Functions, Cloud Scheduler jobs and Cloud Run services: created by
  `firebase deploy`.

## Running it

```sh
cd infra
npm install
export PULUMI_CONFIG_PASSPHRASE=""     # state holds no secrets; see below
pulumi login --local                    # or the shared backend, when there is one
pulumi stack select dev
pulumi preview
pulumi up
```

Credentials come from the environment, not from config:

- Google Cloud: application default credentials (`gcloud auth
  application-default login`), or `GOOGLE_OAUTH_ACCESS_TOKEN` with a
  short-lived token. The account needs Owner on the project and billing
  user on the billing account.
- GitHub: `GITHUB_TOKEN=$(gh auth token)`, a token with `repo` scope on
  the repository.
- Cloudflare: `CLOUDFLARE_API_TOKEN`, an API token with "Zone: DNS: Edit"
  on the zone. DNS records are only managed while the stack's `manageDns`
  config is true; it is false until the token exists and the existing
  records have been imported (below).

The stack's secrets provider is a passphrase, and the passphrase is empty
on purpose: nothing secret is stored in config or state (provider tokens
are read from the environment and secret values are never managed), so
there is nothing to protect and no passphrase to lose.

## State backend

State currently lives in the local backend (`~/.pulumi` on the machine that
ran the import). Before Pulumi runs from GitHub Actions the state needs a
shared backend, a GCS bucket in the production project being the natural
choice: create the bucket, then

```sh
pulumi stack export --file dev.json
pulumi login gs://<bucket>
pulumi stack init dev && pulumi stack import --file dev.json
```

## Config

Set with `pulumi config set <key> <value>` on the selected stack.

| key                  | meaning |
|----------------------|---------|
| `projectId`          | Google Cloud project ID (also the default Hosting site ID) |
| `displayName`        | project display name (no dots allowed) |
| `webAppName`         | display name of the Firebase Web app registration |
| `billingAccount`     | billing account ID to link |
| `region`             | Firestore and Storage location (default `us-central1`) |
| `domain`             | website apex |
| `submissionsDomain`  | submissions / API host (default `submissions.<domain>`) |
| `homeSiteId`, `submissionsSiteId` | Hosting site IDs |
| `cloudflareZoneId`   | Cloudflare zone of the domain |
| `manageDns`          | manage the Cloudflare records (default true) |
| `repository`         | GitHub `owner/name` (default `andypohl/pizza-predator-app`) |
| `githubEnvironment`  | GitHub environment the deploy workflow targets |
| `sanityDataset`      | Sanity dataset the environment builds from |
| `gcp:project`, `gcp:userProjectOverride`, `github:owner` | provider settings |

## Adding a resource

Edit `index.ts`, run `pulumi preview` on `dev`, then `pulumi up`. Merge, and
repeat on `prod`. Anything changed in a console instead shows up in the next
preview as a diff; bring the program up to date rather than leaving drift.

## Importing existing resources

New resources are created by `pulumi up`. Resources that already exist are
adopted with `pulumi import -f <file>`, where the file lists each resource's
type, the name used in `index.ts`, and its provider import ID, for example:

```json
{ "resources": [
  { "type": "gcp:firebase/hostingSite:HostingSite", "name": "home-site",
    "id": "projects/<project>/sites/<site-id>" },
  { "type": "cloudflare:index/dnsRecord:DnsRecord", "name": "dns-apex-a",
    "id": "<zone-id>/<record-id>" },
  { "type": "github:index/actionsEnvironmentVariable:ActionsEnvironmentVariable",
    "name": "var-SITE_URL", "id": "<repo>:<environment>:SITE_URL" }
] }
```

```sh
pulumi import -f imports.json --yes --skip-preview --generate-code=false --protect=false
pulumi preview   # then edit index.ts until it reports no changes
```

The DNS records for `dev` still need this once a Cloudflare token exists:
import the A, TXT and CNAME records (`dns-apex-a`, `dns-apex-txt`,
`dns-submissions-cname`) and the ACME TXT records (`dns-apex-acme`,
`dns-submissions-acme`), then `pulumi config set manageDns true`.

### Importing prod

`Pulumi.prod.yaml` holds the production values but the stack has not been
imported, so `pulumi up` on it would try to create resources that already
exist and fail. Import first, following the list above with the production
IDs. Production also has things `dev` does not (the `www` redirect domain
and the old `submissions.pizzapredator.com` redirect on Hosting, the iOS
and Android app registrations, repository-level rather than
environment-level GitHub variables); add those to the program, or leave
them unmanaged, before importing.
