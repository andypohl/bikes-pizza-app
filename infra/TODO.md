# Infrastructure to-do

Open items for the Pulumi setup in this directory. Remove entries as they
are done; keep the "left out on purpose" list current.

## To do

1. **Cloudflare API token.** Create a token with "Zone: DNS: Edit" on the
   `bikes-pizza.dev` zone (and `bikes.pizza` for prod later) and export it
   as `CLOUDFLARE_API_TOKEN`. Then import the five existing `dev` records
   (`dns-apex-a`, `dns-apex-txt`, `dns-submissions-cname`, `dns-apex-acme`,
   `dns-submissions-acme`; see README, "Importing existing resources") and
   run `pulumi config set manageDns true` on the `dev` stack.
2. **Shared state backend.** State is in the local backend on the machine
   that ran the import. Create a GCS bucket in the production project and
   move the stacks there (README, "State backend"). Needed before Pulumi can
   run from GitHub Actions.
3. **Import prod.** `Pulumi.prod.yaml` has the values, but the stack is not
   imported. Production has things `dev` does not: the `www.bikes.pizza`
   redirect domain and the old `submissions.pizzapredator.com` redirect on
   Hosting, the iOS and Android app registrations (now in the program;
   import them), and repository-level
   (not environment-level) GitHub variables. Add them to the program or
   decide to leave them unmanaged, then import (README, "Importing prod").
4. **CI for infrastructure.** A workflow that runs `pulumi preview` on pull
   requests and `pulumi up` on merge when `infra/**` changes, authenticating
   through Workload Identity like the deploy workflows. Depends on 2, and
   on a service account with enough rights to manage the projects (the
   deploy accounts only have deploy roles).
5. **Dev sign-in providers** (console steps, not Pulumi): enable Google in
   the `bikes-pizza-dev` Firebase console (Authentication → Sign-in method),
   which creates its OAuth client; and add `bikes-pizza-dev.firebaseapp.com`
   with the return URL `https://bikes-pizza-dev.firebaseapp.com/__/auth/handler`
   to the Apple Services ID in Apple Developer. The Apple provider config is
   already copied to the dev project.
6. **Debug grant to remove.** `andypizzapredator@gmail.com` was given
   Service Account Token Creator on `github-deploy@bikes-pizza-dev` while
   diagnosing the Storage deploy failure. It is not in the program; revoke
   it (IAM on the service account) so the program and the project agree.

## Left out on purpose

Not managed by the program, and why:

- **Google sign-in.** Enabling it needs an OAuth client, and only the
  Firebase console can create one; there is no API for it.
- **Apple sign-in.** Its private key would have to live in Pulumi state,
  and the Services ID and return URLs live in Apple Developer.
- **Secret values.** The program creates the Secret Manager entries; values
  are set with `firebase functions:secrets:set` and never pass through
  config or state. This is also why the stack passphrase is empty.
- **Sanity** (project, datasets, Studio) and **Shopify**: no Pulumi
  provider for either. Datasets are created with the Sanity CLI.
- **Flutter app registrations** (`flutterfire configure`), the **Resize
  Images extension**, and the **Artifact Registry cleanup policy** the
  Firebase CLI sets.
- **Cloud Functions, Cloud Scheduler jobs, Cloud Run services**, Hosting
  content, and the Firestore and Storage rules: all created or released by
  `firebase deploy` in the GitHub workflows, on every merge or release. That
  is the application layer; Pulumi stops at the resources the CLI cannot
  create.
