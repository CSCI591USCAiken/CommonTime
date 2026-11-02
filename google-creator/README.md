# CommonTime Google Form creator

Installed in our existing form-bound prototype on November 2, 2026. This does not install or change the partner’s unpublished Cloud app.

## Host workflow

1. Open the manager form: https://docs.google.com/forms/d/1Y4EQpHoSsjrR2okJMQGjFxr1f_jIyYG2LLtSbkjNYbo/edit
2. Choose Add-ons → Untitled project → Open CommonTime.
3. Expand **Create a new Google Form**, choose settings and an owned calendar, then create.
4. Choose **Continue in CommonTime**. The local organizer registers the actual published respondent URL and provides a persistent participant page.

Each newly created form has a central-script `CTM_onSubmit` installable trigger and separate configuration keyed by its form ID. The central project remains attached to the manager form; this is not a globally installed marketplace add-on menu on each new form. Participants need no add-on. Forms are published and collect typed email addresses.

## Behavior and limits

- Flexible template: date plus fixed time windows. GROUP mode schedules a separate group for each submitted date. Currently free slots template: up to 32 free weekday slots, intersected across received responses.
- Scheduling runs after every response, including the first. There is no expected-attendee threshold or deadline. A later response can move a meeting or require organizer review. No overlap leaves the previous event unchanged; the newest respondent may not be invited. Review `CTM_STATUS_<formId>` in Script Properties or execution failures; these statuses are not yet surfaced in the website dashboard.
- Only calendars the host owns are offered, including owned calendars shared with others. Calendar busy time is rechecked at scheduling time. Group invitees come from received responses, not calendar availability of each participant.
- Updating the generated form title changes the title used for future newly scheduled events. Deleting/replacing generated questions can invalidate item-ID mappings and requires repair.
- Native form creation and calendar access use the host’s existing Google authorization. Templates are deterministic, without an AI API or API key. The standalone website still shows sample calendars, responses, and booking previews.
- The current CommonTime link uses loopback port 4175. It works on this computer only. A hosted backend with organizer authentication is required before sharing externally. Set Script Property `CTM_WEBSITE_URL` to the deployed HTTPS organizer URL when that backend is ready; do not expose calendar operations anonymously.
- Apps Script quotas and per-user trigger limits still apply. A failed setup reports a draft edit link; it does not silently create another form on retry.

## Files and verification

`Code.gs` is the complete installed source, including the preserved legacy scheduler. `Manager.gs` is the new extension only; do not install both into the same project. `sidebar.html` is the complete installed sidebar. `creator-section.html` is its reusable section.

Run `node tests.cjs` for mocked validation, overlap, creation, retry, per-form trigger isolation, and handoff checks. Frontend suites passed 28 domain checks and 18 saved-page/API checks. A real Google Form was created, published, and registered through its sidebar Continue link; its embedded respondent form was verified. No participant response, calendar event, or invitation was sent during verification.

Created form editor: https://docs.google.com/forms/d/1KPPE1-BGOrtkBl4loWhvk81h3DNO-Cy-BuwQ7KcSmZk/edit

Created participant page: http://127.0.0.1:4175/forms/commontime-client-availabilityteam-planning-sess-e92d26f44fb51c91

OAuth credentials and runtime page databases are excluded from source archives. Current live source was backed up before installation under `work/google-backup/`.
