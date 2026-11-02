# Google Form → CommonTime place → participant link

The working page-registration boundary is now implemented. The remaining Google add-on access problem does not block local form-page creation.

## Current manual host flow

1. Open My form pages and choose Create a form page.
2. Create/publish a Google Form using the provided Google link, or attach an existing form.
3. Paste the exact respondent /viewform URL and submit the page title/introduction.
4. CommonTime persists a unique page ID and returns its participant path.
5. The host copies the link. Participants open the corresponding Google Form inside its own CommonTime page without installing the add-on.

The page mapping is stored on the local Node server, not in the participant's browser. New forms do not replace older pages. Repeated registration of one canonical Google Form URL returns the existing page. Page titles and source form URLs cannot be overridden by changing the public link's query parameters.

## Website-side automatic hook

After the authorized add-on/backend creates the Google Form, its website-side success handler can call:

```js
import { registerCreatedGoogleForm } from './pages-api.mjs';

const result = await registerCreatedGoogleForm({
  title: createdForm.title,
  respondentUrl: createdForm.respondentUrl,
  description: createdForm.description
});

const participantLink = new URL(result.page.path, location.origin).href;
// Display/copy participantLink for the host.
```

The source Google Form must actually exist and be published/accessible; registration validates the URL format but does not authorize Google or verify its sharing settings. The current browser flow uses the same helper with a manually supplied real respondent URL.

This helper is for the same-origin website host workspace. It does not make localhost reachable from Google Apps Script and is not a completed add-on transport. Once the partner's app is accessible, connect the creation result through an authenticated hosted backend or authorized host frontend. Do not expose an anonymous calendar-write or page-management endpoint.

## Local API implemented

- GET `/api/host/session`: local workspace token bootstrap. Not production user authentication.
- GET `/api/host/pages`: host-token-protected saved-page list.
- POST `/api/host/pages`: host-token-protected registration of `{title,purpose,formUrl}`; returns `{created,page}`. Repeats return the original page.
- GET `/api/pages/:id`: public participant data for one specific page, with no host credentials.
- GET `/forms/:id`: participant page shell; resolves the matching form through the public lookup API.

Records contain public display metadata and a canonical Google respondent URL only. Calendar IDs, Google tokens, and response data are not included. A public deployment additionally needs real organizer authentication, owner-scoped storage, HTTPS hosting, and a persistent database; this development server deliberately accepts only local hostnames.
