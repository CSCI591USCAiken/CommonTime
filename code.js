/**
 * ============================================================================
 * COMMONTIME SCHEDULER ADD-ON - MAIN BACKEND (CODE.GS)
 * ============================================================================
 */

// Safe property store helper to prevent null errors during manual tests
function getProps() {
    return PropertiesService.getDocumentProperties() || PropertiesService.getScriptProperties();
}

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

function setScheduleMode(mode) {
    getProps().setProperty('SCHEDULING_MODE', mode);
}

function getScheduleMode() {
    return getProps().getProperty('SCHEDULING_MODE') || 'SINGLE';
}

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
        if (trigger.getHandlerFunction() === 'onFormSubmit' &&
            trigger.getTriggerSourceId() === formId) {
            ScriptApp.deleteTrigger(trigger);
        }
    });
}

function onFormSubmit(e) {
    try {
        if (!e || !e.response) {
            throw new Error("Form-submit trigger did not include a response.");
        }

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

    submissions[identifier] = {
        startTime: eventData.startTime,
        endTime: eventData.endTime,
        summary: eventData.summary,
        description: eventData.description,
        guestEmail: eventData.guestEmail
    };
    docProps.setProperty(submissionKey, JSON.stringify(submissions));

    const allSubmissions = Object.values(submissions);
    const bestFit = calculateBestFit(allSubmissions);
    if (!bestFit) return;

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

    notifyEventRecipients(getNotificationEmails(eventData), meetingTitle,
        bestFit.startTime, bestFit.endTime);
}

function calculateBestFit(subList) {
    if (!subList || subList.length === 0) return null;
    let latestStart = new Date(Math.max(...subList.map(s => new Date(s.startTime).getTime())));
    let earliestEnd = new Date(Math.min(...subList.map(s => new Date(s.endTime).getTime())));

    if (latestStart < earliestEnd) {
        return { startTime: latestStart.toISOString(), endTime: earliestEnd.toISOString() };
    }
    return { startTime: subList[subList.length - 1].startTime, endTime: subList[subList.length - 1].endTime };
}

function geminiParse(input) {
    const apiKey = PropertiesService.getScriptProperties().getProperty('gemini_api_key');
    if (!apiKey) {
        throw new Error("Missing 'gemini_api_key' in Script Properties.");
    }

    const timezone = Session.getScriptTimeZone();
    const nowISO = new Date().toISOString();
    
    const modelsToTry = ['gemini-3.8-flash', 'gemini-1.5-pro', 'gemini-2.5-flash', 'gemini-1.8-flash', 'gemini-1.8-pro', 'gemini-2.5-pro'];
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

function getAvailableTemplates() {
    return [
        { id: 'standard', name: 'Standard 30-min Meeting', description: 'Asks for preferred date and time.' },
        { id: 'strict_availability', name: 'Strict Publisher Slots', description: 'Forces respondents to choose from available publisher windows.' }
    ];
}

function applyTemplate(templateId) {
    const form = FormApp.getActiveForm();
    if (!form) throw new Error("Could not detect the active form.");

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