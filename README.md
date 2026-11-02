# CommonTime

The root Apps Script files contain the existing KAN-13 prototype backend.

- [Website and participant pages](frontend/README.md): run `node frontend/serve.cjs`, then open http://127.0.0.1:4175/organizer.html.
- [Google Form creator and sidebar](google-creator/README.md): the separate form-bound prototype creates forms, connects per-form scheduling triggers, and hands respondent URLs back to the website.

The website currently runs locally. Pushing this source to GitHub does not deploy a publicly accessible scheduling service. Public hosting requires organizer authentication and persistent owner-scoped storage. The website response/calendar dashboard still uses labeled sample data.

Run checks with `node frontend/tests.mjs`, `node frontend/pages.test.mjs`, and `node google-creator/tests.cjs`.
