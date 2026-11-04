# CommonTime: create a form, embed it, share a link

Branch `feature/form-website-sharing` starts from `KAN-13-prototypeB` commit `fa8dbe7731302e1b5fc39f383992c0fdf24b55b6` (November 4, 2026). It keeps the existing Gemini/Calendar scheduler and adds Google Form creation plus participant website links.

## Host workflow

1. Open the CommonTime sidebar from your Google Form’s Add-ons menu.
2. Choose a template and Single/Group scheduling mode.
3. Enter a meeting title and optional public introduction, then choose **Create new form & connect**. This creates a new published Google Form with its own form-submit trigger. Google authorization and existing Gemini configuration are required for scheduling.
4. Use **Preview embedded form** to open that exact form inside CommonTime. Use **Save in My form pages** to add it to the browser’s form list.
5. **Copy participant link** and send it to participants. **Draft an invitation email** opens an email draft for the host to address and send; it does not send automatically.

For an existing form, use **Publish current form & get link**, or refresh its link after editing. Publishing enables responses; the form’s responder-access settings still determine who can complete it. Participants do not need the add-on. Repeated creation requests reuse the form instead of creating duplicate forms.

## Apps Script setup

## Wait for a response target

The sidebar includes **Wait for enough responses**. Turn on **Wait before scheduling**, enter a whole number up to 500, and save. With the hold off, scheduling continues as each response arrives. New forms inherit the choice shown in this control; the form title below it identifies which existing form the Save button updates. After creating a form, the control switches to that new form. Use **Use current open form** to switch back.

The hold counts distinct collected email addresses starting when it is first saved, excluding historical submissions. Repeated submissions from one email count once, using that person's latest response. Below the target, form submission processing does not call Gemini, calendar event creation, or confirmation email functions. When the target is met, the held responses are released. Single mode processes individual meetings; Group mode uses its existing aggregation and delay. A pending group timer also checks the hold before changing the calendar.

Saving or lowering a target does not itself send anything; the next response checks the target and releases the backlog when eligible. After release, later submissions run normally. The target cannot be reset after release: create another form for another collection round. Already-created calendar events and previously sent emails are not recalled. The count describes collected responses, not guaranteed successful parsing or bookings. Failed responses are reported in Apps Script executions and retried on a subsequent submission, while successful responses are skipped using stored receipts.

**Refresh response count** shows progress. This prototype reads the response list and processes held respondents within the Apps Script execution limit; large batches may need a later submission/retry or organizer review. No real events or emails were sent during automated checks.

## Apps Script installation

The project linked for this work is `CommonTimeTest`: https://script.google.com/home/projects/1BUnS8JToXN12d3wMAdqzN61gO_Se64oKLgiFHyIoTJgGNj6Xwng9eRVS/edit

Install `code.js`, `website-sharing.js`, `response-gate.js`, `Sidebar.html`, `minimal-trigger-test.js`, and `appsscript.json` in the development project. The HTML filename is **Sidebar**, matching `showSidebar()`. All three JavaScript implementation files are required: `website-sharing.js` supplies trigger entry points and form-specific property context, while `response-gate.js` controls the response hold.

`.claspignore` excludes website assets and Node tests from Apps Script uploads. Keep `gemini_api_key` in Script Properties; never put it in source or participant URLs. Set optional Script Property `COMMONTIME_WEBSITE_URL` to the deployed website directory. Default: `https://stingingend.github.io/commontime-scheduler/`.

Saving development source does not update an existing versioned marketplace deployment. Test the head deployment in a Google Form, then release a new version through the project’s normal deployment process. This branch does not deploy or replace the partner’s published app.

## Scheduling isolation

New forms have settings, group submissions, publisher email, and calendar event IDs stored under a form-specific Script Property prefix. Their submit events dispatch using `e.source.getId()`. Delayed group triggers map their unique IDs to the same form; changing one form’s debounce timer does not remove another form’s timer. Existing non-managed forms retain the original property store. The existing scheduler uses the authorized host’s default calendar, Gemini interpretation, and the original group scoring/delay behavior.

## Website

`website/` is a static GitHub Pages-compatible copy of the current CommonTime site. Deploy its contents at the configured directory. Each participant link includes the published respondent URL and public title/introduction, so it works on other devices without a Node server. The embedded form submits directly to Google Forms.

The host’s form list stays in that browser’s local storage. It is not a signed-in, synchronized dashboard. Website calendar/response previews remain labeled demo data; actual scheduling runs in Apps Script. Never put confidential meeting details or credentials in public display fields or participant URLs.

## Verification

Run `node sharing.test.cjs`, `node response-gate.test.cjs`, and `node website/static-pages.test.mjs`. These check creation retries, exact per-form participant links, public metadata, per-form stores, submit dispatch, delayed trigger isolation, static link portability, and response targets. Gate checks cover no actions below target, repeated emails, backlog release, later responses, validation, separate forms, historical responses, retries, and the delayed Group guard. They mock Google services and send no responses, mail, or calendar invitations. A real calendar submission still needs verification in the authorized test deployment.
