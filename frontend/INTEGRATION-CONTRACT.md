# CommonTime frontend/backend handoff

This contract is a proposed boundary for the existing UI, not an assertion that these API methods already exist in the partner's app. The current UI explicitly instantiates `DemoAdapter`. `LiveAdapter` rejects every operation with an integration-unavailable error; it makes no network requests.

## Roles and transport

**Organizer:** installs/authorizes the add-on, configures a form/template, selects a writable calendar, sees responses, and controls scheduling. The organizer studio is a design/testing surface for that workflow. In a Google Forms editor sidebar, an adapter can call authorized server functions with `google.script.run`. A standalone organizer website cannot use that bridge; it needs an authenticated server/API with organizer authorization. Do not expose privileged calendar operations as anonymous endpoints.

**Client:** needs only a respondent link. The real Google Form embedded in the website sends responses straight to Google, and the installed form submit trigger processes them. It does not need access to the organizer's account or add-on. An embedded Form is cross-origin; the website does not inspect answers or detect its submission confirmation. The demo availability form is a separate local testing surface.

## Adapter operations

| Operation | Intended authenticated backend behavior |
| --- | --- |
| `getConfig()` | Return organizer's saved meeting/form configuration and integration status. |
| `saveConfig(config)` | Validate and persist settings owned by the current organizer; return normalized configuration. |
| `getCalendars()` | List calendars writable by this organizer, with IDs, names, and access roles. |
| `generateTemplate(prompt, config)` | Generate a validated form specification. Preview first; form creation/application is a separate authorized operation. |
| `getResponses(meetingId)` | Return authorized response records and scheduling state for a specific form/meeting. |
| `getBooking(meetingId)` | Return verified event outcome, calendar ID, event link, and actionable failures. |
| `createBooking(config, slot)` | A demo convenience method today. Production scheduling belongs to the authorized submission workflow or an explicit organizer action, with server-side revalidation. |
| `submitAvailability(config, name, slots)` | Demo-only. Production Google Form submissions bypass this adapter. If a custom public form is added later, give it a separate validated public endpoint. |
| `reset(meetingId)` | Demo-only. Do not map this to deleting real responses/events without a separately designed action. |

The current demo config is `{id,title,purpose,template,duration,mode,days,timezone,date,calendar,formUrl}`. Template IDs `standard` and `strict_availability` match the branch; `automatic` is a new frontend concept. Time zones use IANA names. Modes are GROUP or SINGLE. Durations are 15/30/45/60 minutes. Availability horizons are 7/14/30 days. These enums are validated in the frontend and must also be validated server-side.

The demo preview URL contains only meeting-facing fields and the respondent form URL. Saved participant pages now use a server-owned page ID at `/forms/:id`; the source Google Form is resolved through the local page registry. Public client configuration must not authorize bookings, disclose private calendars, or expose raw responses. Production owner-scoped authentication/storage remains pending.

## Dedicated participant page

`/forms/:id` is the saved participant-facing route. It embeds the registered Google Form and contains no demo submission controls. It needs no add-on installation in the participant's browser and does not infer a booking state from iframe loads. The older `forms.html?form=<encoded respondent URL>&title=<optional display title>` format remains supported.

Once real form creation returns its respondent URL, the website-side host callback invokes `registerCreatedGoogleForm({respondentUrl,title,description})` from pages-api.mjs. The returned `page.path` is the stable participant route. The manual attach dialog already uses this same registration hook. See PAGE-INTEGRATION.md for implemented routes and the remaining authenticated add-on transport work. Invalid or missing form URLs produce an explicit error, never an unrelated default form. The returned URL must point to a hosted server for participants outside the organizer's computer.

## Mapping to KAN-13-prototypeB

The branch already contains `getAvailableTemplates`, `applyTemplate`, `getScheduleMode`, `setScheduleMode`, `toggleTriggerOn`, `toggleTriggerOff`, and `getPublisherOpenSlots`. The sidebar calls `getCutoffDays` and `setCutoffDays`, which are absent from the checked backend. It loads `Sidebar` while the repository filename is lowercase `sidebar.html`; verify project file naming during integration.

Calendar operations currently use `CalendarApp.getDefaultCalendar()`. Support for a shared destination requires storing the chosen writable calendar ID and consistently using that selection for availability checks and event creation. The backend must recheck permissions rather than trusting the frontend option.

The existing `applyTemplate` deletes current form items. This frontend never calls it. Production should apply templates to a new form or require an explicit review before replacing an existing form's questions. Automatic template generation needs a real backend implementation; the branch's Gemini helper currently parses responses rather than generating templates.

The group overlap fallback, per-form trigger registration, authorizing account, concurrency, duplicate execution, input dates/time zones, and calendar conflicts need end-to-end integration tests. A visual green state should represent a verified backend outcome, not a successful UI click.

## Once tester access is ready

1. Confirm the exact installation/test-deployment route and OAuth test-user access with the partner.
2. Agree on a structured response/error schema and authenticated transport.
3. Implement the live adapter and explicit form-create/apply methods, preserving loading/error/preview states.
4. Register a submit trigger for each created/configured form; store form ownership, selected calendar, and meeting settings server-side.
5. Test on a fresh development form and calendar: invite link → response → overlap calculation → one verified calendar event, including retry/no-overlap/access-failure cases.

No live Apps Script deployment or GitHub push is part of this frontend delivery. The repository's deploy.ps1 also commits/pushes and is intentionally not used.
