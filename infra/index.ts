// Cloud resources for one bikes.pizza environment: the Google Cloud /
// Firebase project and what lives in it (APIs, Firestore, Storage, Auth
// settings, Hosting sites and custom domains, deploy service account and
// its keyless GitHub access, Secret Manager entries), the Cloudflare DNS
// records that point the domains at Firebase Hosting, and the GitHub
// environment the deploy workflow reads its settings from.
//
// One stack per environment (`dev`, `prod`); everything that differs is in
// the stack's Pulumi.<stack>.yaml. Application deploys (functions, Hosting
// content, Firestore and Storage rules) are not done here; the Firebase CLI
// in .github/workflows/deploy.yml does those on every merge or release.

import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as cloudflare from "@pulumi/cloudflare";
import * as github from "@pulumi/github";

const cfg = new pulumi.Config();

/** Google Cloud project ID; also the ID of the default Hosting site. */
const projectId = cfg.require("projectId");
const displayName = cfg.require("displayName");
/** Display name of the Firebase Web app registration. */
const webAppName = cfg.get("webAppName") ?? "bikes-pizza web";
const billingAccount = cfg.require("billingAccount");
/** Region for Firestore, the Storage bucket and the functions. */
const region = cfg.get("region") ?? "us-central1";

/** Website apex, e.g. bikes-pizza.dev, and the submissions / API host. */
const domain = cfg.require("domain");
const submissionsDomain = cfg.get("submissionsDomain") ?? `submissions.${domain}`;
/** The admin page's host (user administration). */
const adminDomain = cfg.get("adminDomain") ?? `admin.${domain}`;
/** Hosting site IDs for the website and the submissions site. */
const homeSiteId = cfg.require("homeSiteId");
const submissionsSiteId = cfg.require("submissionsSiteId");
const adminSiteId = cfg.require("adminSiteId");

/** Cloudflare zone of `domain`; DNS is skipped while `manageDns` is false. */
const cloudflareZoneId = cfg.require("cloudflareZoneId");
const manageDns = cfg.getBoolean("manageDns") ?? true;

/** GitHub repository (owner/name) and the environment the stack deploys. */
const repository = cfg.get("repository") ?? "andypohl/bikes-pizza-app";
const repoName = repository.split("/")[1];
const githubEnvironment = cfg.require("githubEnvironment");
/** Sanity dataset the environment's website is built from. */
const sanityDataset = cfg.require("sanityDataset");

// ---------------------------------------------------------------------------
// Project

const project = new gcp.organizations.Project("project", {
  projectId,
  name: displayName,
  billingAccount,
  deletionPolicy: "PREVENT",
});

// Providers are the defaults configured in the stack (gcp:project,
// gcp:region, gcp:userProjectOverride, github:owner).
const opts: pulumi.CustomResourceOptions = {};

/** APIs the functions, Hosting, Firestore, Storage, Auth and deploys use. */
const services = [
  "artifactregistry",
  "cloudbuild",
  "cloudfunctions",
  "cloudresourcemanager",
  "cloudscheduler",
  "eventarc",
  "firebase",
  "firebaseextensions",
  "firebasehosting",
  "firebaserules",
  "firebasestorage",
  "firestore",
  "iam",
  "iamcredentials",
  "identitytoolkit",
  "pubsub",
  "run",
  "secretmanager",
  "serviceusage",
  "storage",
  "sts",
  "vision",
].map(
  (api) =>
    new gcp.projects.Service(
      `api-${api}`,
      { project: project.projectId, service: `${api}.googleapis.com`, disableOnDestroy: false },
      { ...opts, dependsOn: [project] },
    ),
);
const apisReady = { ...opts, dependsOn: services };

const firebase = new gcp.firebase.Project("firebase", { project: project.projectId }, apisReady);
const firebaseReady = { ...opts, dependsOn: [firebase] };

/** Registration that makes Hosting's reserved /__/firebase/init.json work. */
const webApp = new gcp.firebase.WebApp(
  "web-app",
  { project: project.projectId, displayName: webAppName, deletionPolicy: "DELETE" },
  firebaseReady,
);

// ---------------------------------------------------------------------------
// Data

const firestore = new gcp.firestore.Database(
  "firestore",
  {
    project: project.projectId,
    name: "(default)",
    locationId: region,
    type: "FIRESTORE_NATIVE",
    // Deleting the database, and the stack's resource, is never automatic.
    deleteProtectionState: "DELETE_PROTECTION_ENABLED",
    deletionPolicy: "ABANDON",
  },
  firebaseReady,
);

/** The default Storage bucket, `<project>.firebasestorage.app`. */
const bucket = new gcp.storage.Bucket(
  "bucket",
  {
    project: project.projectId,
    name: pulumi.interpolate`${project.projectId}.firebasestorage.app`,
    location: region,
    uniformBucketLevelAccess: false,
  },
  firebaseReady,
);
const firebaseBucket = new gcp.firebase.StorageBucket(
  "firebase-bucket",
  { project: project.projectId, bucketId: bucket.name },
  { ...opts, dependsOn: [bucket, firebase] },
);

// ---------------------------------------------------------------------------
// Auth
//
// Email/password sign-in and the domains sign-in may run on. Google and
// Apple providers are not managed here: Google needs an OAuth client the
// console creates on enabling, and Apple's key must not live in state.

const auth = new gcp.identityplatform.Config(
  "auth",
  {
    project: project.projectId,
    signIn: { email: { enabled: true, passwordRequired: true }, phoneNumber: { enabled: false } },
    // Second factor by authenticator app (TOTP), available to any account and
    // required of administrators by the admin page and its API. ENABLED, not
    // MANDATORY: ordinary members are not made to enroll.
    mfa: { state: "ENABLED", providerConfigs: [{ state: "ENABLED", totpProviderConfig: { adjacentIntervals: 5 } }] },
    authorizedDomains: [
      "localhost",
      pulumi.interpolate`${project.projectId}.firebaseapp.com`,
      pulumi.interpolate`${project.projectId}.web.app`,
      `${homeSiteId}.web.app`,
      `${submissionsSiteId}.web.app`,
      `${adminSiteId}.web.app`,
      domain,
      submissionsDomain,
      adminDomain,
    ],
  },
  firebaseReady,
);

// ---------------------------------------------------------------------------
// Hosting

const homeSite = new gcp.firebase.HostingSite("home-site", { project: project.projectId, siteId: homeSiteId }, firebaseReady);
const submissionsSite = new gcp.firebase.HostingSite(
  "submissions-site",
  { project: project.projectId, siteId: submissionsSiteId },
  firebaseReady,
);

const adminSite = new gcp.firebase.HostingSite("admin-site", { project: project.projectId, siteId: adminSiteId }, firebaseReady);

const domainOpts = { ...opts, customTimeouts: { create: "5m" }, dependsOn: [homeSite, submissionsSite, adminSite] };
const homeDomain = new gcp.firebase.HostingCustomDomain(
  "home-domain",
  { project: project.projectId, siteId: homeSiteId, customDomain: domain, certPreference: "PROJECT_GROUPED", waitDnsVerification: false },
  domainOpts,
);
const submissionsCustomDomain = new gcp.firebase.HostingCustomDomain(
  "submissions-domain",
  {
    project: project.projectId,
    siteId: submissionsSiteId,
    customDomain: submissionsDomain,
    certPreference: "PROJECT_GROUPED",
    waitDnsVerification: false,
  },
  domainOpts,
);

const adminCustomDomain = new gcp.firebase.HostingCustomDomain(
  "admin-domain",
  {
    project: project.projectId,
    siteId: adminSiteId,
    customDomain: adminDomain,
    certPreference: "PROJECT_GROUPED",
    waitDnsVerification: false,
  },
  domainOpts,
);

// ---------------------------------------------------------------------------
// DNS (Cloudflare, records unproxied so Firebase can serve and verify)
//
// Firebase asks for the apex's A record and hosting-site TXT up front; the
// ACME challenge TXT records only appear on the custom domain once it is
// verified, so they are read from the resources above.

const hostingIp = "199.36.158.100";
const acmeRecords = (customDomain: gcp.firebase.HostingCustomDomain) =>
  customDomain.certs.apply((certs) =>
    (certs ?? [])
      .flatMap((c) => c.verification?.dns?.desireds ?? [])
      .flatMap((desired) =>
        (desired.records ?? []).flatMap((r) => (desired.domainName && r.rdata ? [{ name: desired.domainName, value: r.rdata }] : [])),
      ),
  );

if (manageDns) {
  const dns = (name: string, args: Omit<cloudflare.DnsRecordArgs, "zoneId" | "ttl">) =>
    new cloudflare.DnsRecord(name, { zoneId: cloudflareZoneId, ttl: 1, proxied: false, ...args });

  dns("dns-apex-a", { name: domain, type: "A", content: hostingIp });
  dns("dns-apex-txt", { name: domain, type: "TXT", content: `hosting-site=${homeSiteId}` });
  dns("dns-submissions-cname", { name: submissionsDomain, type: "CNAME", content: `${submissionsSiteId}.web.app` });
  dns("dns-admin-cname", { name: adminDomain, type: "CNAME", content: `${adminSiteId}.web.app` });

  for (const [label, customDomain] of [
    ["apex", homeDomain],
    ["submissions", submissionsCustomDomain],
    ["admin", adminCustomDomain],
  ] as const) {
    acmeRecords(customDomain).apply((records) =>
      records.forEach((r, i) => dns(`dns-${label}-acme${i ? `-${i}` : ""}`, { name: r.name, type: "TXT", content: r.value })),
    );
  }
}

// ---------------------------------------------------------------------------
// Deploys from GitHub Actions (keyless, through Workload Identity Federation)

const deployer = new gcp.serviceaccount.Account(
  "deployer",
  { project: project.projectId, accountId: "github-deploy", displayName: "GitHub Actions deploy" },
  apisReady,
);

/** What `firebase deploy --only functions,hosting,firestore,storage` needs. */
const deployRoles = [
  "roles/artifactregistry.admin",
  "roles/cloudbuild.builds.editor",
  "roles/cloudbuild.editor",
  "roles/cloudfunctions.admin",
  "roles/cloudscheduler.admin",
  "roles/datastore.indexAdmin",
  "roles/firebasehosting.admin",
  "roles/firebaserules.admin",
  "roles/firebasestorage.admin",
  "roles/iam.serviceAccountUser",
  "roles/run.admin",
  "roles/secretmanager.viewer",
  "roles/serviceusage.serviceUsageConsumer",
];
for (const role of deployRoles) {
  new gcp.projects.IAMMember(
    `deployer-${role.replace("roles/", "").replace(/\./g, "-")}`,
    { project: project.projectId, role, member: pulumi.interpolate`serviceAccount:${deployer.email}` },
    opts,
  );
}

const pool = new gcp.iam.WorkloadIdentityPool(
  "github-pool",
  { project: project.projectId, workloadIdentityPoolId: "github-pool", displayName: "GitHub Actions" },
  apisReady,
);
const poolProvider = new gcp.iam.WorkloadIdentityPoolProvider(
  "github-provider",
  {
    project: project.projectId,
    workloadIdentityPoolId: pool.workloadIdentityPoolId,
    workloadIdentityPoolProviderId: "github",
    displayName: "GitHub",
    oidc: { issuerUri: "https://token.actions.githubusercontent.com" },
    attributeMapping: {
      "google.subject": "assertion.sub",
      "attribute.repository": "assertion.repository",
      "attribute.repository_owner": "assertion.repository_owner",
    },
    attributeCondition: `assertion.repository == '${repository}'`,
  },
  opts,
);

/** Only workflows of this repository may act as the deploy account. */
new gcp.serviceaccount.IAMMember(
  "deployer-workload-identity",
  {
    serviceAccountId: deployer.name,
    role: "roles/iam.workloadIdentityUser",
    member: pulumi.interpolate`principalSet://iam.googleapis.com/projects/${project.number}/locations/global/workloadIdentityPools/${pool.workloadIdentityPoolId}/attribute.repository/${repository}`,
  },
  opts,
);

// ---------------------------------------------------------------------------
// Secrets the functions read. Only the entries are managed here; values are
// set with `firebase functions:secrets:set` and never pass through state.

for (const secretId of ["SANITY_WRITE_TOKEN", "MAILGUN_API_KEY"]) {
  new gcp.secretmanager.Secret(`secret-${secretId}`, { project: project.projectId, secretId, replication: { auto: {} } }, apisReady);
}

// ---------------------------------------------------------------------------
// GitHub environment read by .github/workflows/deploy.yml. Only variables
// are managed here; the environment's secrets (the Sanity deploy tokens,
// see README.md) are set by hand so no secret value passes through state.

const ghOpts: pulumi.CustomResourceOptions = {};

const environment = new github.RepositoryEnvironment(
  "environment",
  { repository: repoName, environment: githubEnvironment },
  ghOpts,
);

/** Resource name in the form google-github-actions/auth expects (project number). */
const providerResourceName = pulumi.interpolate`projects/${project.number}/locations/global/workloadIdentityPools/${pool.workloadIdentityPoolId}/providers/${poolProvider.workloadIdentityPoolProviderId}`;

const variables: Record<string, pulumi.Input<string>> = {
  FIREBASE_PROJECT: project.projectId,
  GCP_DEPLOY_SERVICE_ACCOUNT: deployer.email,
  GCP_WORKLOAD_IDENTITY_PROVIDER: providerResourceName,
  SITE_URL: `https://${domain}`,
  PUBLIC_API_URL: `https://${submissionsDomain}`,
  REVIEW_PAGE_URL: `https://${submissionsDomain}/`,
  SANITY_DATASET: sanityDataset,
};
for (const [variableName, value] of Object.entries(variables)) {
  new github.ActionsEnvironmentVariable(
    `var-${variableName}`,
    { repository: repoName, environment: environment.environment, variableName, value },
    ghOpts,
  );
}

// ---------------------------------------------------------------------------

export const projectNumber = project.number;
export const webAppId = webApp.appId;
export const deployServiceAccount = deployer.email;
export const workloadIdentityProvider = providerResourceName;
export const websiteUrl = `https://${domain}/`;
export const submissionsUrl = `https://${submissionsDomain}/`;
export const adminUrl = `https://${adminDomain}/`;
export const bucketName = bucket.name;
export const firestoreName = firestore.name;
export const firebaseBucketName = firebaseBucket.bucketId;
export const authorizedDomains = auth.authorizedDomains;
