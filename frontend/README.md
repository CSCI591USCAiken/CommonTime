# CommonTime frontend studio

Built November 2, 2026 against the `KAN-13-prototypeB` workflow. Each attached Google Form gets a unique saved participant page. The separate [Google Form creator](../google-creator/README.md) creates real forms, installs a per-form scheduling trigger, and returns to this website to register the participant page. Website calendar/AI screens remain demonstrations. This prototype is separate from the partner's unpublished app and the root backend.

## Open the preview

Run `node serve.cjs` from this folder. No dependency installation is needed.

- Organizer: http://127.0.0.1:4175/organizer.html
- Client: use **Client preview** in the organizer to carry its settings into the link.
- Participant form page: use **Open participant page** or **Copy participant link** under Form studio → Bring it to your clients. This opens `forms.html` with the attached Google respondent URL, without demo form controls or organizer navigation.
- Tests: `node tests.mjs`
- Persistent-page/API tests: `node pages.test.mjs`

Keep the server running. To use another computer, copy/extract this whole folder and run its own server. A localhost URL works only on the computer running the server. Google Forms and optional Google Fonts need internet; the demo itself uses local assets and system-font fallbacks.

## Try the complete demo

1. Choose Standard, Available Slots, or Automatic. The automatic builder is a deterministic sample implementation: it uses the description as context and recognizes a supported meeting duration. It makes no AI request and creates no Google Form.
2. Edit the title, purpose, duration, date, availability horizon, time zone, mode, and sample destination calendar. Save the demo settings.
3. Open Client preview or copy its preview link. The link carries meeting settings but omits the private calendar selection and all response data. It contains no credentials.
4. In the client preview, select sample times and submit a **demo** response. It is stored only in this browser. Optional email and notes are not saved or sent.
5. Open Responses in the organizer. The local response joins the labeled sample participants, the overlap is recomputed, and a sample booking can be saved. Single mode allocates separate non-overlapping sample starts; Group mode requires overlap across received responses. Pending sample participants are visibly marked. This demonstration is not a production scheduling algorithm.
6. Use Connections to inspect the pending Google integration and save a real Google Form's full published `/viewform` URL. On the client page, select Real Google Form and explicitly click Load. Its submissions are real and go to Google; the demo cannot read those responses or control that form's scheduling.

The default real embed is the form from the earlier single-form prototype. That form may still have its own automation. Use a dedicated development form for future frontend testing. No real response was submitted while verifying this frontend.

## Sending a real form to participants

Open **My form pages → Create a form page**. Create/publish a new form in Google Forms using the provided link, or use a form you already created. Paste its published `/viewform` respondent URL, enter the page title/introduction, and choose **Create its CommonTime page**. CommonTime creates a unique URL such as `/forms/client-consultation-<random-id>` and displays an Open/Copy result. Each different Google Form receives a different page. Re-registering the same canonical form URL returns its existing page and preserves its title/link.

Saved pages appear under **My form pages** with their own participant links and attached form. Form studio's Open/Copy participant controls now register the currently attached form automatically and reuse that saved URL. A shared page resolves its form from the server; it does not rely on the participant's localStorage or an editable form URL in the link. It works in a different browser on this computer, and survives server restarts. The old `forms.html?form=...` format remains supported for compatibility.

Google handles its own access requirements, submission, and confirmation. CommonTime's page stores no answers, exposes no calendar information, and never falls back to a different form when a page is missing. Connecting this page does not configure or enable a submit trigger; that remains the organizer add-on's responsibility.

Automatic Google Form creation still awaits the partner's authorized integration. The exported website-side `registerCreatedGoogleForm(result)` hook accepts a real creation result with `respondentUrl` (or `formUrl`), `title`, and optional `description`/`purpose`, and registers its CommonTime page. The manual attach flow invokes this same hook today. It never fabricates a new Google Form URL.

These are local preview links. To send working links to participants on other computers, the application needs public hosting with a persistent database and authenticated host accounts. This version intentionally binds to loopback and accepts local hostnames only; it is not a public multi-user service.

## Saved-page storage and host access

Page mappings are persisted in `.commontime/pages.json` beside the app, or in the file set by `COMMONTIME_PAGE_DATA`. Back up this folder to preserve existing page IDs when transferring your workspace. It contains public page titles, introductions, Google respondent URLs, and creation timestamps; no Google credentials or responses. Runtime data is ignored by Git and is excluded from the source ZIP.

The local host API uses a process-scoped workspace token and same-origin checks. It is a guard for a single local workspace, not Google sign-in or tenant isolation. Public page lookup needs no host token. Before public deployment, replace the local host-session bootstrap with authenticated organizer accounts and scope form records to their owners. Neither server-only modules nor the page database are served as static files.

## Files and persistence

- `organizer.html`, `organizer.mjs`: builder, preview, response dashboard, and connection settings.
- `client.html`, `client.mjs`: demo availability, time-zone conversion, and isolated real Google embed.
- `forms.html`, `forms.mjs`: real participant-only page bound to a validated form link.
- `pages-api.mjs`: host page-registration client and Google-created-form result hook.
- `page-store.mjs`, `server.mjs`: persisted form-to-page mappings and local host/public API routes.
- `domain.mjs`: validation, share-link serialization, demo adapter, overlap ranking, local booking simulation, and explicit unavailable live adapter.
- `studio.css`: responsive styles, keyboard focus, reduced-motion support.
- `serve.cjs`: allowlisted loopback server. It serves only the UI files, not documentation or tests.
- `INTEGRATION-CONTRACT.md`: backend handoff for the partner.
- `tests.mjs`: Node-only tests with no dependencies or network requests.

Demo data uses `ct.frontend.*` localStorage keys. It syncs between tabs of the same browser and origin; it does not sync between computers or browsers. Settings fall back to memory if storage is blocked. Reset demo responses clears this demo's response/booking data only. Multiple concurrent clients, authenticated users, and real-time response storage belong in the real backend.

The app intentionally reports **Awaiting access** rather than pretending to connect Google. The real Form embed is separate from the fake calendars and local sample-template generation. Sample meeting settings do not edit or override the embedded form's questions, time zone, or automation.

## Validation

28 data-layer tests passed: URL validation, public-link privacy, Unicode round-trip, malformed data, overlap, template validation, persistence, storage failure, local submissions, group eligibility, individual booking conflicts, reset, unavailable integration, daylight-saving conversions, and the dedicated participant-page link handling.

Browser checks verified template generation, saved settings, sharing, client demo submission, cross-tab response sync, overlap updates, local booking, real Google Form loading without submission, and mobile layouts at a 390px viewport. The live partner app, AI generation, real calendar writes, and real Google response syncing remain integration work.

Additional participant-page checks verified organizer opening/copying, the real form embed, empty-link error handling, no page JavaScript errors, and a 390px viewport without horizontal overflow. No actual response was submitted.

18 additional page-registry/API tests passed: unique mappings, duplicate registration reuse, persistence/restart, public lookup, unknown-page handling, local host authorization/origin checks, safe routes, and protection of server-only files. The host creation dialog and a saved participant page were also exercised in the browser with the existing attached form; no new Google Form or response was created by this test.

Navigation: use Participant form in the organizer navigation to open the attached form in the same tab. Use Back to main page or the CommonTime logo on the participant page to return. Organizer demo settings are saved before leaving.
