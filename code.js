/**
 * ============================================================================
 * COMMONTIME SCHEDULER ADD-ON - MAIN BACKEND (CODE.GS)
 * ============================================================================
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

function setScheduleMode(mode) {
    PropertiesService.getDocumentProperties().setProperty('SCHEDULING_MODE', mode);
}

function getScheduleMode() {
    return PropertiesService.getDocumentProperties().getProperty('SCHEDULING_MODE') || 'SINGLE';
}

function toggleTriggerOn(formId) {
    let form;
    try {
        form = formId ? FormApp.openById(formId) : FormApp.getActiveForm();
    } catch (e) {
        Logger.log("Error opening form: " + e.toString());
    }

    if (!form) {
        throw new Error("Could not detect the form. Open this from the Form editor and try again.");
    }

    const publisherEmail = Session.getEffectiveUser().getEmail();
    if (publisherEmail) {
        PropertiesService.getDocumentProperties().setProperty('PUBLISHER_EMAIL', publisherEmail);
    }

    removeExistingTriggers(form.getId());
    ScriptApp.newTrigger('onFormSubmit')
        .forForm(form)
        .onFormSubmit()
        .create();

    Logger.log("CommonTime enabled for form: " + form.getTitle());
}

function toggleTriggerOff() {
    const form = FormApp.getActiveForm();
    if (form) removeExistingTriggers(form.getId());
    Logger.log("CommonTime disabled.");
}

function removeExistingTriggers(formId) {
    // Project triggers works even if the form is not the currently active form.
    ScriptApp.getProjectTriggers().forEach(function(trigger) {
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
        const itemResp = e.response.getItemResponses();
        const userTxtResp = itemResp.map(function(itemResponse) {
            return itemResponse.getItem().getTitle() + ": " + itemResponse.getResponse();
        }).join("\\n");

        Logger.log("Parsed Form Responses:\\n" + userTxtResp);

        const parsedData = geminiParse(userTxtResp);
        if (!parsedData || !parsedData.startTime || !parsedData.endTime) {
            throw new Error("Gemini did not return valid start and end times.");
        }

        const start = new Date(parsedData.startTime);
        const end = new Date(parsedData.endTime);
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
            throw new Error("Parsed meeting dates are invalid; end time must be after start time.");
        }

        const props = PropertiesService.getDocumentProperties();
        parsedData.guestEmail = respEmail;
        parsedData.publisherEmail = (props.getProperty('PUBLISHER_EMAIL') ||
            Session.getEffectiveUser().getEmail() || '').trim();

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
    return Array.from(new Set([eventData.publisherEmail, eventData.guestEmail]
        .filter(Boolean)
        .map(function(email) { return email.trim().toLowerCase(); })));
}

function addGuestsToEvent(calendarEvent, emails) {
    const existing = (calendarEvent.getGuestList() || []).map(function(guest) {
        return guest.getEmail().toLowerCase();
    });
    emails.forEach(function(email) {
        if (existing.indexOf(email.toLowerCase()) === -1) {
            calendarEvent.addGuest(email);
        }
    });
}

function notifyEventRecipients(emails, summary, startTime, endTime) {
    emails.forEach(function(email) {
        try {
            sendConfirmationEmail(email, summary, startTime, endTime);
        } catch (err) {
            Logger.log("Failed to send confirmation to " + email + ": " + err.toString());
        }
    });
}

function handleIndEvent(eventData) {
    const docProps = PropertiesService.getDocumentProperties();
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
    notifyEventRecipients(guests, summary, startTime, endTime);
}

function handleGroupEvent(eventData) {
    const docProps = PropertiesService.getDocumentProperties();
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
        allSubmissions.map(function(submission) { return submission.guestEmail; })
            .concat([eventData.publisherEmail])
            .filter(Boolean)
            .map(function(email) { return email.trim().toLowerCase(); })
    ));

    const cal = CalendarApp.getDefaultCalendar();
    const groupEventIdKey = 'GROUP_MASTER_EVENT_ID';
    const masterEventId = docProps.getProperty(groupEventIdKey);
    const aggregatedDescription = "Scheduled with CommonTime (Group)\\n\\nSubmitted Details:\\n" +
        allSubmissions.map(function(submission) {
            return "- " + (submission.guestEmail || 'Anonymous') + ': "' +
                (submission.summary || 'Meeting') + '"';
        }).join('\\n');
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

    // Confirm the current submission to both the publisher and this respondent.
    notifyEventRecipients(getEventGuestEmails(eventData), meetingTitle,
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
    if (!apiKey) throw new Error("Missing 'gemini_api_key' in Script Properties.");

    const timezone = Session.getScriptTimeZone();
    const nowISO = new Date().toISOString();
    const modelsToTry = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-flash-latest'];

    const prompt = `Extract meeting timing details from user input as JSON with summary, startTime, endTime, description. Current Time: ${nowISO}, Timezone: ${timezone}. Input: "${input}"`;

    const payload = {
        "contents": [{ "parts": [{ "text": prompt }] }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "summary": { "type": "STRING" },
                    "startTime": { "type": "STRING" },
                    "endTime": { "type": "STRING" },
                    "description": { "type": "STRING" }
                },
                "required": ["summary", "startTime", "endTime"]
            }
        }
    };

    for (const model of modelsToTry) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = UrlFetchApp.fetch(url, {
            method: "post",
            contentType: "application/json",
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        });

        if (response.getResponseCode() === 200) {
            const jsonResponse = JSON.parse(response.getContentText());
            return JSON.parse(jsonResponse.candidates[0].content.parts[0].text);
        }
    }
    throw new Error("Gemini API call failed.");
}

function sendConfirmationEmail(email, summary, startTime, endTime) {
    if (!email) return;
    const subject = "Meeting Confirmed: " + summary;
const body = `Hello,\n\nYour meeting "${summary}" has been scheduled in the CommonTime calendar.\n\nTime: ${new Date(startTime).toLocaleString()}
${new Date(endTime).toLocaleString()}\n\nA calendar invitation has also been sent.\n\nThank you!`;
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
    const items = form.getItems();
    items.forEach(item => form.deleteItem(item));

    if (templateId === 'standard') {
        form.setTitle('CommonTime Scheduler - Standard');
        form.addTextItem().setTitle('Meeting Summary / Purpose').setRequired(true);
        form.addParagraphTextItem().setTitle('Proposed Date and Time (e.g., Tomorrow at 2 PM)').setRequired(true);
    }
    PropertiesService.getDocumentProperties().setProperty('ACTIVE_TEMPLATE', templateId);
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
    PropertiesService.getDocumentProperties().setProperty('CUTOFF_DAYS', days);
    return "Availability window saved successfully!";
}

function getCutoffDays() {
    return PropertiesService.getDocumentProperties().getProperty('CUTOFF_DAYS') || '14';
}