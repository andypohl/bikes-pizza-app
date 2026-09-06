# Post details

A [Sanity App SDK](https://www.sanity.io/docs/app-sdk) app that runs in the
organisation's Sanity Dashboard, next to the Studio, for filling in the
structured parts of a post that the Studio form makes slow:

- **Bike details** on bike posts: brand, year (a decade), color and type.
  The choices live in `studio/schemaTypes/bikeOptions.ts`, shared with the
  Studio schema, so a new option is added there and nowhere else.
- **Pizza details** on pizza posts: the style (Neapolitan, Detroit, New
  York street slice…), from `studio/schemaTypes/pizzaOptions.ts`.
- **Member**: which member is credited for a post, chosen by username. The
  post stores a reference to the `member` document, so a later username
  change follows automatically.

Posts are listed newest first, filterable by feed, with a badge on any bike
or pizza post missing details or any post with no member. Edits go straight to the
post's draft in Content Lake; **Publish** makes them live (and triggers the
website rebuild through the Sanity webhook), **Discard changes** drops the
draft.

There is one deployed app per dataset, mirroring the two Studios.
`SANITY_APP_DATASET` (see `environment.ts`) picks the dataset, the app's
title and its app id; unset, a local `npm run dev` works on the
`development` copy so nothing touches live content by accident.

```sh
npm install
npx sanity login              # once per machine
npm run dev                   # prints a Dashboard URL; sign in to open the app
npm run deploy:dev            # publish the development app by hand
npm run deploy                # publish the production app by hand
```

The apps follow the same lifecycle as the rest of the project: a merge to
`main` deploys the development app and a published release deploys the
production one (the `sanity` job in `.github/workflows/deploy.yml`); pull
requests build the app as a check. The workflow signs in with an
organization robot token that has the Manage SDK Apps permission, kept as
the `SANITY_APP_DEPLOY_TOKEN` secret on each GitHub environment.

The first deploy of an app creates it and prints its id, which then goes
into `environment.ts`; an unattended deploy refuses to run without one, as
it would create a second app. So the first deploy for a dataset is done by
hand (the commands above, which need an organization admin or developer
role), and the workflow updates it from then on.
