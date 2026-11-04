/**
 * ============================================================================
 * COMMONTIME SCHEDULER ADD-ON - MAIN BACKEND (CODE.GS)
 * ============================================================================
 * This script powers the Google Forms add-on backend for scheduling meetings.
 * It integrates Google Forms with Google Calendar and uses the Gemini AI API 
 * to interpret natural language time entries from form submissions.
 */

// Safe property store helper to prevent null errors during manual tests
function getProps() {
    if (CT_FORM_CONTEXT_) return websiteFormProps_(CT_FORM_CONTEXT_);
    return PropertiesService.getDocumentProperties() || PropertiesService.getScriptProperties();
}

/**
 * UI & SIDEBAR SETUP
 * Creates the custom Google Forms UI menu and renders the sidebar interface.
 */
function onOpen(e) {
    FormApp.getUi()
        .createAddonMenu()
        .addItem('Open CommonTime', 'showSidebar')
        .addToUi();
}

function showSidebar() {
    const ui = HtmlService.createHtmlOutputFromFile('Sidebar')
        .setTitle('CommonTime Scheduler');
    FormApp.getUi().showSidebar(ui);
}

/**
 * SCHEDULING MODE SETTINGS
 * Manages whether meetings are scheduled individually or aggregated as a group.
 */
function setScheduleMode(mode) {
    getProps().setProperty('SCHEDULING_MODE', mode);
}

function getScheduleMode() {
    return getProps().getProperty('SCHEDULING_MODE') || 'SINGLE';
}

/**
 * TRIGGER MANAGEMENT
 * Handles creating, verifying, and removing form-submit automated triggers.
 */
function toggleTriggerOn(formId) {
    const form = formId ? FormApp.openById(formId) : FormApp.getActiveForm();
    if (!form) {
        throw new Error("Could not detect the form. Open this from the Form editor and try again.");
    }

    form.setCollectEmail(true);

    const publisherEmail = Session.getEffectiveUser().getEmail();
    if (!publisherEmail) {
        throw new Error("Could not determine the publisher email. Reauthorize the script and enable sync again.");
    }
    getProps().setProperty('PUBLISHER_EMAIL', publisherEmail);

    removeExistingTriggers(form.getId());
    ScriptApp.newTrigger('onFormSubmit')
        .forForm(form)
        .onFormSubmit()
        .create();

    const triggerInstalled = ScriptApp.getProjectTriggers().some(function (trigger) {
        return trigger.getHandlerFunction() === 'onFormSubmit' &&
            trigger.getTriggerSourceId() === form.getId();
    });
    if (!triggerInstalled) {
        throw new Error("The form-submit trigger could not be verified for " + form.getTitle() + ".");
    }

    const status = "Sync enabled for \"" + form.getTitle() +
        "\". Email collection is on; submit a response to the live form to test it.";
    Logger.log(status);
    return status;
}

function toggleTriggerOff() {
    const form = FormApp.getActiveForm();
    if (form) removeExistingTriggers(form.getId());
    Logger.log("CommonTime disabled.");
}

function removeExistingTriggers(formId) {
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
        const handler = trigger.getHandlerFunction();
        if ((handler === 'onFormSubmit' ||
            handler === 'commonTimeFormSubmitEntryPoint' ||
            handler === 'minimalFormSubmitProbe') &&
            trigger.getTriggerSourceId() === formId) {
            ScriptApp.deleteTrigger(trigger);
        }
    });
}

/**
 * FORM SUBMISSION PROCESSING ENGINE
 * Main entry point triggered when a user submits a form. Extracts text, 
 * queries Gemini AI to parse dates, and dispatches to calendar handlers.
 */
function processFormSubmission_(e) {
    Logger.log("CommonTime form-submit handler started.");
    try {
        if (!e || !e.response) {
            throw new Error("Form-submit trigger did not include a response.");
        }
        Logger.log("Received form response ID: " + e.response.getId());

        const respEmail = (e.response.getRespondentEmail() || '').trim();
        if (!respEmail) {
            throw new Error("No respondent email was captured. Confirm email collection is enabled and submit a new response.");
        }

        const itemResp = e.response.getItemResponses();
        const userTxtResp = itemResp.map(function (itemResponse) {
            return itemResponse.getItem().getTitle() + ": " + itemResponse.getResponse();
        }).join("\n");

        Logger.log("Parsed Form Responses:\n" + userTxtResp);

        const parsedData = geminiParse(userTxtResp);
        if (!parsedData || !parsedData.startTime || !parsedData.endTime) {
            throw new Error("Gemini did not return valid start and end times.");
        }

        const start = new Date(parsedData.startTime);
        const end = new Date(parsedData.endTime);
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
            throw new Error("Parsed meeting dates are invalid; end time must be after start time.");
        }

        const props = getProps();
        parsedData.guestEmail = respEmail;
        parsedData.publisherEmail = (props.getProperty('PUBLISHER_EMAIL') ||
            Session.getEffectiveUser().getEmail() || '').trim();
        if (!parsedData.publisherEmail) {
            throw new Error("Could not determine the publisher email for confirmation.");
        }

        if (getScheduleMode() === 'SINGLE') {
            handleIndEvent(parsedData);
        } else {
            handleGroupEvent(parsedData);
        }
    } catch (err) {
        Logger.log("ERROR processing form submission: " + (err.stack || err.toString()));
        throw err;
    }
}

/**
 * CALENDAR INTEGRATION & NOTIFICATIONS
 * Manages participant lists, sends invitations, and fires confirmation emails.
 */
function getEventGuestEmails(eventData) {
    return Array.from(new Set([eventData.guestEmail]
        .filter(Boolean)
        .map(function (email) { return email.trim().toLowerCase(); })));
}

function getNotificationEmails(eventData) {
    return Array.from(new Set([eventData.publisherEmail, eventData.guestEmail]
        .filter(Boolean)
        .map(function (email) { return email.trim().toLowerCase(); })));
}

function addGuestsToEvent(calendarEvent, emails) {
    const existing = (calendarEvent.getGuestList() || []).map(function (guest) {
        return guest.getEmail().toLowerCase();
    });
    emails.forEach(function (email) {
        if (existing.indexOf(email.toLowerCase()) === -1) {
            calendarEvent.addGuest(email);
        }
    });
}

function notifyEventRecipients(emails, summary, startTime, endTime) {
    const failures = [];
    emails.forEach(function (email) {
        try {
            sendConfirmationEmail(email, summary, startTime, endTime);
        } catch (err) {
            Logger.log("Failed to send confirmation to " + email + ": " + err.toString());
            failures.push(email);
        }
    });
    if (failures.length) {
        throw new Error("Calendar event was saved, but confirmation email failed for: " + failures.join(", "));
    }
}

function handleIndEvent(eventData) {
    const docProps = getProps();
    const emailKey = 'EVENT_ID_' + (eventData.guestEmail ? eventData.guestEmail.toLowerCase() : 'anonymous');
    const existingEventId = docProps.getProperty(emailKey);
    const cal = CalendarApp.getDefaultCalendar();
    const startTime = new Date(eventData.startTime);
    const endTime = new Date(eventData.endTime);
    const summary = eventData.summary || "Meeting";
    const description = eventData.description || "Scheduled with CommonTime";
    const guests = getEventGuestEmails(eventData);

    let calendarEvent = null;
    if (existingEventId) {
        try {
            calendarEvent = cal.getEventById(existingEventId);
        } catch (err) {
            Logger.log("Could not retrieve existing event; creating a replacement.");
        }
    }

    if (calendarEvent) {
        calendarEvent.setTime(startTime, endTime);
        calendarEvent.setTitle(summary);
        calendarEvent.setDescription(description);
        addGuestsToEvent(calendarEvent, guests);
    } else {
        const options = { description: description, sendInvites: true };
        if (guests.length) options.guests = guests.join(',');
        calendarEvent = cal.createEvent(summary, startTime, endTime, options);
        docProps.setProperty(emailKey, calendarEvent.getId());
    }

    Logger.log("Created/updated individual event: " + summary);
    notifyEventRecipients(getNotificationEmails(eventData), summary, startTime, endTime);
}

function handleGroupEvent(eventData) {
    const docProps = getProps();
    const submissionKey = "ALL_GROUP_SUBMISSIONS";
    const submissions = JSON.parse(docProps.getProperty(submissionKey) || '{}');
    const identifier = eventData.guestEmail || ('anonymous_' + Date.now());

    // 1. Save this submission immediately
    submissions[identifier] = {
        startTime: eventData.startTime,
        endTime: eventData.endTime,
        summary: eventData.summary,
        description: eventData.description,
        guestEmail: eventData.guestEmail
    };
    docProps.setProperty(submissionKey, JSON.stringify(submissions));

    // 2. Remove any previously scheduled delayed triggers so we debounce/reset the timer
    removeGroupProcessingTriggers();

    // 3. Schedule a new one-shot trigger to process the group after the delay
    const delayMinutes = getGroupEventDelayMinutes();
    const scheduledTrigger = ScriptApp.newTrigger('processQueuedGroupEvent')
        .timeBased()
        .after(delayMinutes * 60 * 1000)
        .create();
    if (CT_FORM_CONTEXT_) PropertiesService.getScriptProperties().setProperty('CT_GROUP_TRIGGER_' + scheduledTrigger.getUniqueId(), CT_FORM_CONTEXT_);

    Logger.log("Group submission recorded for " + identifier + ". Scheduled group calculation in " + delayMinutes + " minute(s).");
}

function removeGroupProcessingTriggers() {
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
        const store = PropertiesService.getScriptProperties();
        const key = 'CT_GROUP_TRIGGER_' + trigger.getUniqueId();
        const owner = store.getProperty(key);
        if (trigger.getHandlerFunction() === 'processQueuedGroupEvent' && (CT_FORM_CONTEXT_ ? owner === CT_FORM_CONTEXT_ : !owner)) {
            ScriptApp.deleteTrigger(trigger);
            store.deleteProperty(key);
        }
    });
}

function processQueuedGroupEvent_() {
    Logger.log("Processing queued group event calculations...");
    const docProps = getProps();
    const submissionKey = "ALL_GROUP_SUBMISSIONS";
    const submissions = JSON.parse(docProps.getProperty(submissionKey) || '{}');
    const allSubmissions = Object.values(submissions);

    if (allSubmissions.length === 0) {
        Logger.log("No group submissions found to process.");
        return;
    }

    const bestFit = calculateBestFitScored(allSubmissions);
    if (!bestFit) {
        Logger.log("Could not find a suitable best fit time slot for the group.");
        return;
    }

    const guests = Array.from(new Set(
        allSubmissions.map(function (submission) { return submission.guestEmail; })
            .filter(Boolean)
            .map(function (email) { return email.trim().toLowerCase(); })
    ));

    const cal = CalendarApp.getDefaultCalendar();
    const groupEventIdKey = 'GROUP_MASTER_EVENT_ID';
    const masterEventId = docProps.getProperty(groupEventIdKey);
    const aggregatedDescription = "Scheduled with CommonTime (Group)\n\nSubmitted Details:\n" +
        allSubmissions.map(function (submission) {
            return "- " + (submission.guestEmail || 'Anonymous') + ': "' +
                (submission.summary || 'Meeting') + '"';
        }).join('\n');
    const meetingTitle = "Group Meeting";
    let masterEvent = null;

    if (masterEventId) {
        try {
            masterEvent = cal.getEventById(masterEventId);
        } catch (err) {
            Logger.log("Could not retrieve group event; creating a replacement.");
        }
    }

    if (masterEvent) {
        masterEvent.setTime(new Date(bestFit.startTime), new Date(bestFit.endTime));
        masterEvent.setTitle(meetingTitle);
        masterEvent.setDescription(aggregatedDescription);
        addGuestsToEvent(masterEvent, guests);
    } else {
        const options = { description: aggregatedDescription, sendInvites: true };
        if (guests.length) options.guests = guests.join(',');
        masterEvent = cal.createEvent(
            meetingTitle, new Date(bestFit.startTime), new Date(bestFit.endTime), options
        );
        docProps.setProperty(groupEventIdKey, masterEvent.getId());
    }

    // Notify all collected guests about the finalized/updated group slot
    const allNotificationEmails = Array.from(new Set(
        allSubmissions.map(function (s) { return s.guestEmail; }).filter(Boolean)
    ));
    const publisherEmail = docProps.getProperty('PUBLISHER_EMAIL');
    if (publisherEmail) allNotificationEmails.push(publisherEmail);

    notifyEventRecipients(allNotificationEmails, meetingTitle, bestFit.startTime, bestFit.endTime);
    Logger.log("Group event successfully processed and calendar updated.");
}

/**
 * POINT-BASED SCHEDULING ALGORITHM
 * Evaluates discrete time slots against publisher calendar availability 
 * and all collected respondent preferences using a weighted scoring model.
 */
function calculateBestFitScored(subList) {
    if (!subList || subList.length === 0) return null;

    const cal = CalendarApp.getDefaultCalendar();
    const now = new Date();
    const horizonDays = parseInt(getCutoffDays(), 10) || 14;
    const horizonEnd = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);

    // Fetch publisher's existing calendar events for conflict detection
    const publisherEvents = cal.getEvents(now, horizonEnd);

    // Define slot granularity (e.g., 30-minute intervals)
    const slotDurationMs = 30 * 60 * 1000;
    const scoredSlots = [];

    // Determine the global date range bounds from all submissions
    const allStartTimes = subList.map(s => new Date(s.startTime).getTime());
    const allEndTimes = subList.map(s => new Date(s.endTime).getTime());
    const rangeStart = new Date(Math.max(now.getTime(), Math.min(...allStartTimes)));
    const rangeEnd = new Date(Math.max(...allEndTimes));

    // Iterate through time in 30-minute increments
    let currentSlotStart = new Date(rangeStart);
    while (currentSlotStart < rangeEnd) {
        let currentSlotEnd = new Date(currentSlotStart.getTime() + slotDurationMs);

        // 1. Check Publisher Conflict
        const publisherBusy = publisherEvents.some(ev =>
            currentSlotStart < ev.getEndTime() && currentSlotEnd > ev.getStartTime()
        );

        if (!publisherBusy) {
            let score = 0;
            let matchingRespondents = 0;

            // 2. Score Respondent Overlap (+50 points per matching respondent)
            subList.forEach(sub => {
                const subStart = new Date(sub.startTime).getTime();
                const subEnd = new Date(sub.endTime).getTime();

                // Check if this slot falls within the respondent's stated availability
                if (currentSlotStart.getTime() >= subStart && currentSlotEnd.getTime() <= subEnd) {
                    matchingRespondents++;
                    score += 50;
                }
            });

            // Only consider slots where at least the publisher and one respondent fit, 
            // or use a fallback if it's a group meeting with strict overlap requirements.
            if (matchingRespondents > 0) {
                // 3. Bonus: Core Working Hours (9 AM - 5 PM local time) (+20 points)
                const hour = currentSlotStart.getHours();
                if (hour >= 9 && hour < 17) {
                    score += 20;
                }

                // 4. Bonus: Proximity (Favor sooner dates slightly) (+10 max points decay)
                const daysOut = (currentSlotStart - now) / (1000 * 60 * 60 * 24);
                score += Math.max(0, 10 - Math.floor(daysOut));

                scoredSlots.push({
                    startTime: new Date(currentSlotStart).toISOString(),
                    endTime: new Date(currentSlotEnd).toISOString(),
                    score: score,
                    matches: matchingRespondents
                });
            }
        }

        // Advance to next slot
        currentSlotStart = new Date(currentSlotStart.getTime() + slotDurationMs);
    }

    if (scoredSlots.length === 0) {
        Logger.log("No scored slots found. Falling back to the first respondent's time range.");
        return {
            startTime: subList[0].startTime,
            endTime: subList[0].endTime
        };
    }

    // Sort by highest score descending
    scoredSlots.sort((a, b) => b.score - a.score);

    Logger.log("Best scored time slot selected: " + JSON.stringify(scoredSlots[0]));
    return scoredSlots[0];
}

/**
 * Returns the group event processing delay in minutes.
 * Change this to 1 (or fractions/seconds via milliseconds) during testing, 
 * and increase it once out of testing (e.g., 60 minutes or 1440 for 24 hours).
 */
function getGroupEventDelayMinutes() {
    return 1;
}

/**
 * GEMINI AI PARSING ENGINE
 * Sends free-form user text responses to the Gemini API with failover model support
 * to reliably extract structured JSON meeting timing information.
 */
function geminiParse(input) {
    const apiKey = PropertiesService.getScriptProperties().getProperty('gemini_api_key');
    if (!apiKey) {
        throw new Error("Missing 'gemini_api_key' in Script Properties.");
    }

    const timezone = Session.getScriptTimeZone();
    const nowISO = new Date().toISOString();

    const modelsToTry = ['gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-1.5-flash',
        'gemini-1.5-pro', 'gemini-flash-lite-latest', 'gemini-3.8-flash', 'gemini-1.5-pro', 'gemini-2.5-flash',
        'gemini-1.8-flash', 'gemini-1.8-pro', 'gemini-2.5-pro',
        'gemini-flash-latest',
        'gemini-pro-latest', 'gemini-2.5-flash-lite',
        'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-3.6-flash',
        'gemini-3.7-flash', 'gemini-4-argon', 'lyria-3.5'];
    const maxAttemptsPerModel = 3;

    const prompt = `Extract meeting timing details from user input as JSON with keys: summary, startTime, endTime, description. Current Time: ${nowISO}, Timezone: ${timezone}. Input: "${input}"`;

    const payload = {
        "contents": [{ "parts": [{ "text": prompt }] }],
        "generationConfig": {
            "responseMimeType": "application/json"
        }
    };

    let lastError = null;

    for (const model of modelsToTry) {
        for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                const response = UrlFetchApp.fetch(url, {
                    method: "post",
                    contentType: "application/json",
                    payload: JSON.stringify(payload),
                    muteHttpExceptions: true,
                    timeoutSeconds: 15
                });

                const responseCode = response.getResponseCode();
                const responseText = response.getContentText();

                if (responseCode === 404) {
                    lastError = new Error(`Gemini model [${model}] was not found or is unavailable.`);
                    Logger.log(lastError.message + " Trying the next model.");
                    break;
                }

                if (responseCode !== 200) {
                    const apiMessage = getGeminiApiErrorMessage(responseText);
                    lastError = new Error(`Gemini model [${model}] returned HTTP ${responseCode}: ${apiMessage}`);

                    if ([408, 429, 500, 502, 503, 504].indexOf(responseCode) === -1) {
                        lastError.retryable = false;
                        throw lastError;
                    }

                    Logger.log(lastError.message);
                    if (attempt < maxAttemptsPerModel) {
                        Utilities.sleep(getGeminiRetryDelay(attempt));
                        continue;
                    }
                    break;
                }

                const jsonResponse = JSON.parse(responseText);
                const candidate = jsonResponse.candidates && jsonResponse.candidates[0];
                if (jsonResponse.promptFeedback && jsonResponse.promptFeedback.blockReason) {
                    const blockedError = new Error("Gemini blocked the request: " + jsonResponse.promptFeedback.blockReason);
                    blockedError.retryable = false;
                    throw blockedError;
                }
                const responseContent = candidate && candidate.content;
                const responsePart = responseContent && responseContent.parts && responseContent.parts[0];
                if (!responsePart || typeof responsePart.text !== 'string') {
                    throw new Error("Gemini response did not contain generated text.");
                }

                const parsed = JSON.parse(responsePart.text);
                const start = new Date(parsed.startTime);
                const end = new Date(parsed.endTime);
                if (!parsed || !parsed.startTime || !parsed.endTime ||
                    isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
                    throw new Error("Gemini response did not contain valid start and end times.");
                }
                return parsed;
            } catch (err) {
                lastError = err;
                Logger.log(`Model [${model}] attempt ${attempt}/${maxAttemptsPerModel} failed: ${err.message || err}`);

                if (err.retryable === false) {
                    throw err;
                }
                if (attempt < maxAttemptsPerModel) {
                    Utilities.sleep(getGeminiRetryDelay(attempt));
                }
            }
        }
    }

    throw new Error("Gemini parsing failed after retries and model failover. " +
        (lastError ? lastError.message : "No model was configured."));
}

function getGeminiRetryDelay(attempt) {
    const backoffMs = Math.min(8000, 1000 * Math.pow(2, attempt - 1));
    return backoffMs + Math.floor(Math.random() * 250);
}

function getGeminiApiErrorMessage(responseText) {
    try {
        const body = JSON.parse(responseText);
        if (body.error && body.error.message) return body.error.message;
    } catch (err) {
    }
    return String(responseText || "Unknown API error").slice(0, 500);
}

function sendConfirmationEmail(email, summary, startTime, endTime) {
    if (!email) return;
    const subject = "Meeting Confirmed: " + summary;
    const body = "Your meeting '" + summary + "' has been scheduled in the CommonTime calendar.\n\n" +
        "Time: " + new Date(startTime).toLocaleString() + " - " + new Date(endTime).toLocaleString() + "\n\n" +
        "A calendar invitation has also been sent.";
    MailApp.sendEmail({ to: email, subject: subject, body: body });
    Logger.log("Confirmation email successfully sent to " + email);
}

/**
 * FORM TEMPLATES & AVAILABILITY CALCULATOR
 * Builds pre-defined form layouts and evaluates Google Calendar slots to suggest times.
 */
function getAvailableTemplates() {
    return [
        { id: 'standard', name: 'Standard 30-min Meeting', description: 'Asks for preferred date and time.' },
        { id: 'strict_availability', name: 'Strict Publisher Slots', description: 'Forces respondents to choose from available publisher windows.' }
    ];
}

function applyTemplate(templateId) {
    const form = FormApp.getActiveForm();
    return applyTemplateToForm_(form, templateId);
}

function applyTemplateToForm_(form, templateId) {
    if (!form) throw new Error("Could not detect the active form.");
    if (!['standard', 'strict_availability'].includes(templateId)) throw new Error('Unknown form template.');

    const items = form.getItems();
    items.forEach(item => form.deleteItem(item));
    form.setCollectEmail(true);

    if (templateId === 'standard') {
        form.setTitle('CommonTime Scheduler - Standard');
        form.addTextItem().setTitle('Meeting Summary / Purpose').setRequired(true);
        form.addParagraphTextItem().setTitle('Proposed Date and Time (e.g., Tomorrow at 2 PM)').setRequired(true);
    } else if (templateId === 'strict_availability') {
        form.setTitle('CommonTime Scheduler - Select Available Slots');
        form.addTextItem().setTitle('Meeting Summary / Purpose').setRequired(true);

        const choices = getPublisherOpenSlots().map(function (slot) {
            return slot.label;
        });
        if (choices.length) {
            form.addCheckboxItem()
                .setTitle('Select all time slots that work for you')
                .setChoiceValues(choices)
                .setRequired(true);
        } else {
            form.addParagraphTextItem()
                .setTitle('No automated slots found. Enter your preferred time:')
                .setRequired(true);
        }
    } else {
        throw new Error("Unknown form template: " + templateId);
    }
    getProps().setProperty('ACTIVE_TEMPLATE', templateId);
    return "Template applied successfully!";
}

function getPublisherOpenSlots() {
    const cal = CalendarApp.getDefaultCalendar();
    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const events = cal.getEvents(now, sevenDaysLater);

    const slots = [];
    let curr = new Date(now);
    curr.setHours(9, 0, 0, 0);

    for (let i = 0; i < 5; i++) {
        let dayStart = new Date(curr);
        dayStart.setDate(dayStart.getDate() + i);
        dayStart.setHours(9, 0, 0, 0);

        let dayEnd = new Date(dayStart);
        dayEnd.setHours(17, 0, 0, 0);

        let slotTime = new Date(dayStart);
        while (slotTime < dayEnd) {
            let slotEnd = new Date(slotTime.getTime() + 60 * 60 * 1000);
            let isBusy = events.some(ev => (slotTime < ev.getEndTime() && slotEnd > ev.getStartTime()));

            if (!isBusy && slotTime > new Date()) {
                slots.push({
                    label: slotTime.toLocaleString(),
                    startTime: slotTime.toISOString(),
                    endTime: slotEnd.toISOString()
                });
            }
            slotTime = slotEnd;
        }
    }
    return slots;
}

function setCutoffDays(days) {
    getProps().setProperty('CUTOFF_DAYS', days);
    return "Availability window saved successfully!";
}

function getCutoffDays() {
    return getProps().getProperty('CUTOFF_DAYS') || '14';
}

/**
 * UTILITIES, TESTS, & DIAGNOSTICS
 * Helper functions used for local debugging, mocking form submits, and verifying Gemini models.
 */
function testManualSubmission() {
    const mockEvent = {
        response: {
            getRespondentEmail: function () {
                return Session.getEffectiveUser().getEmail();
            },
            getItemResponses: function () {
                return [
                    {
                        getItem: function () {
                            return { getTitle: function () { return "Meeting Summary / Purpose"; } };
                        },
                        getResponse: function () {
                            return "Project Strategy Sync";
                        }
                    },
                    {
                        getItem: function () {
                            return { getTitle: function () { return "Proposed Date and Time"; } };
                        },
                        getResponse: function () {
                            return "Tomorrow at 3:00 PM for 30 minutes";
                        }
                    }
                ];
            }
        }
    };

    Logger.log("=== STARTING MANUAL TEST ===");
    try {
        onFormSubmit(mockEvent);
        Logger.log("=== MANUAL TEST COMPLETED SUCCESSFULLY ===");
    } catch (err) {
        Logger.log("=== MANUAL TEST FAILED: " + (err.stack || err.toString()) + " ===");
        throw err;
    }
}

function listGeminiModels() {
    const apiKey = PropertiesService.getScriptProperties().getProperty('gemini_api_key');
    if (!apiKey) throw new Error("Missing 'gemini_api_key' in Script Properties.");

    const url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' +
        encodeURIComponent(apiKey);
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const status = response.getResponseCode();
    const body = JSON.parse(response.getContentText());

    if (status !== 200) {
        throw new Error(`ListModels failed (${status}): ${body.error?.message || 'Unknown error'}`);
    }

    const compatible = (body.models || [])
        .filter(model =>
            (model.supportedGenerationMethods || []).includes('generateContent')
        )
        .map(model => ({
            name: model.name.replace(/^models\//, ''),
            displayName: model.displayName,
            methods: model.supportedGenerationMethods
        }));

    Logger.log(JSON.stringify(compatible, null, 2));
    return compatible;
}

/**
 * ============================================================================
 * EXPLANATION: GCP WORKFLOW & TEST DEPLOYMENTS
 * ============================================================================
 * The Google Cloud Platform (GCP) draft app workaround is necessary because Google Forms 
 * add-ons require a registered Google Cloud project and proper authorization scopes to 
 * register event listeners like `onFormSubmit` across multiple forms. Without configuring 
 * a draft project, the add-on cannot cleanly bind its installer and runtime permissions 
 * to live form submission events.
 * 
 * Standard Apps Script test deployments or code-editor test runs often fail or behave 
 * differently because they run under temporary, restricted execution tokens that do not 
 * simulate the full lifecycle of an installable marketplace add-on. By setting up a draft 
 * GCP app and whitelisting external test user emails, developers can properly emulate how 
 * installed OAuth scopes, triggers, and runtime permissions will behave for real end users 
 * before sending the application through formal Google review.
 */