/**
 * ============================================================================
 * COMMONTIME SCHEDULER ADD-ON - MAIN BACKEND (CODE.GS)
 * ============================================================================
 */

// ==========================================
// 1. UI & MENU INITIALIZATION
// ==========================================
/**
 * Automatically adds the custom menu option to the Google Form editor UI on open.
 */
function onOpen(e) {
    FormApp.getUi()
        .createAddonMenu()
        .addItem('Open CommonTime', 'showSidebar')
        .addToUi();
}

/**
 * Opens the custom HTML sidebar panel for configuring scheduler settings.
 */
function showSidebar() {
    const ui = HtmlService.createHtmlOutputFromFile('Sidebar')
        .setTitle('CommonTime Scheduler');
    FormApp.getUi().showSidebar(ui);
}


// ==========================================
// 2. DOCUMENT PROPERTY MANAGEMENT (MODES)
// ==========================================
/**
 * Saves the current scheduling mode ('SINGLE' or 'GROUP') in document properties.
 */
function setScheduleMode(mode) {
    PropertiesService.getDocumentProperties().setProperty('SCHEDULING_MODE', mode);
}

/**
 * Retrieves the currently active scheduling mode from document properties.
 */
function getScheduleMode() {
    return PropertiesService.getDocumentProperties().getProperty('SCHEDULING_MODE');
}


// ==========================================
// 3. FORM SUBMISSION TRIGGER MANAGEMENT
// ==========================================
/**
 * Enables form submission tracking by creating an active form submit trigger.
 */
function toggleTriggerOn() {
    const form = FormApp.getActiveForm();
    removeExistingTriggers(form.getId());

    ScriptApp.newTrigger('onFormSubmit')
        .forForm(form)
        .onFormSubmit()
        .create();

    Logger.log("CommonTime enabled for form: " + form.getTitle());
}

/**
 * Disables form submission tracking by deleting existing triggers.
 */
function toggleTriggerOff() {
    const form = FormApp.getActiveForm();
    removeExistingTriggers(form.getId());
    Logger.log("CommonTime disabled for form: " + form.getTitle());
}

/**
 * Checks if an active form submit trigger already exists for this form.
 */
function checkExistingTrigger(formId) {
    const triggers = ScriptApp.getUserTriggers(FormApp.getActiveForm());
    return triggers.some(
        (t) => t.getHandlerFunction() === 'onFormSubmit'
            && t.getTriggerSourceId() === formId
    );
}

/**
 * Removes any pre-existing form submit triggers associated with the form ID.
 */
function removeExistingTriggers(formId) {
    const triggers = ScriptApp.getUserTriggers(FormApp.getActiveForm());
    triggers.forEach((trigger) => {
        if (trigger.getHandlerFunction() === 'onFormSubmit'
            && trigger.getTriggerSourceId() === formId) {
            ScriptApp.deleteTrigger(trigger);
        }
    });
}


// ==========================================
// 4. FORM SUBMISSION HANDLER & VALIDATION
// ==========================================
/**
 * Core event handler triggered automatically whenever a user submits the form.
 * Parses response text using Gemini, verifies publisher availability, and logs events.
 */
function onFormSubmit(e) {
    try {
        const respEmail = e.response.getRespondentEmail();
        const itemResp = e.response.getItemResponses();
        let userTxtResp = "";

        for (let i = 0; i < itemResp.length; i++) {
            userTxtResp += itemResp[i].getItem().getTitle() + ": " + itemResp[i].getResponse() + "\n";
        }

        const parsedData = geminiParse(userTxtResp);
        if (!parsedData || !parsedData.startTime || !parsedData.endTime) return;

        // PRIORITIZE PUBLISHER AVAILABILITY: Check if publisher calendar is free during requested window
        const cal = CalendarApp.getDefaultCalendar();
        const start = new Date(parsedData.startTime);
        const end = new Date(parsedData.endTime);

        const conflictingEvents = cal.getEvents(start, end);
        if (conflictingEvents.length > 0) {
            Logger.log("Rejected: Time slot conflicts with publisher's calendar.");
            // Notify respondent via email that their requested slot conflicted
            if (respEmail) {
                MailApp.sendEmail(
                    respEmail,
                    "Meeting Request Conflict",
                    "Hello,\n\nThe time slot you selected conflicts with an existing event on the publisher's calendar. Please submit a new time.\n\nThank you!"
                );
            }
            return;
        }

        parsedData.guestEmail = respEmail;
        const mode = getScheduleMode();
        if (mode === 'SINGLE') {
            handleIndEvent(parsedData);
        } else {
            handleGroupEvent(parsedData);
        }
    } catch (f) {
        Logger.log("Error processing submission: " + f.toString());
    }
}


// ==========================================
// 5. SINGLE SCHEDULING MODE HANDLER
// ==========================================
/**
 * Creates or updates an individual calendar event for each respondent submission
 * and emails an explicit confirmation to the respondent.
 */
function handleIndEvent(eventData) {
    const docProps = PropertiesService.getDocumentProperties();
    const emailKey = 'EVENT_ID_' + eventData.guestEmail.toLowerCase();
    const existingEventId = docProps.getProperty(emailKey);

    const cal = CalendarApp.getDefaultCalendar();
    const startTime = new Date(eventData.startTime);
    const endTime = new Date(eventData.endTime);

    const options = {
        description: eventData.description || "Scheduled with CommonTime",
        sendInvites: true,
        guests: eventData.guestEmail
    };

    if (existingEventId) {
        try {
            const existingEvent = cal.getEventById(existingEventId);
            if (existingEvent) {
                existingEvent.setTime(startTime, endTime);
                existingEvent.setTitle(eventData.summary || "Meeting");
                existingEvent.setDescription(options.description);
                Logger.log("Updated existing event for: " + eventData.guestEmail);
                
                // Email respondent for accepted/updated timeslot
                sendConfirmationEmail(eventData.guestEmail, eventData.summary || "Meeting", startTime, endTime);
                return;
            }
        } catch (err) {
            Logger.log("No existing event found, creating new one");
        }
    }

    // Create new event if one doesn't already exist
    const newEvent = cal.createEvent(eventData.summary || "Meeting", startTime, endTime, options);
    docProps.setProperty(emailKey, newEvent.getId());
    Logger.log("Created new event for " + eventData.guestEmail);

    // Email respondent for accepted timeslot
    sendConfirmationEmail(eventData.guestEmail, eventData.summary || "Meeting", startTime, endTime);
}


// ==========================================
// 6. GROUP SCHEDULING MODE HANDLER
// ==========================================
/**
 * Aggregates group submissions, calculates the optimal overlapping time slot,
 * updates the master group calendar event, and notifies participants.
 */
function handleGroupEvent(eventData) {
    const docProps = PropertiesService.getDocumentProperties();
    const submissionKey = "ALL_GROUP_SUBMISSIONS";
    let submissions = JSON.parse(docProps.getProperty(submissionKey) || '{}');

    // Save/Update current user's submission preference
    submissions[eventData.guestEmail] = {
        startTime: eventData.startTime,
        endTime: eventData.endTime,
        summary: eventData.summary,
        description: eventData.description
    };
    docProps.setProperty(submissionKey, JSON.stringify(submissions));

    const bestFit = calculateBestFit(Object.values(submissions));
    if (!bestFit) {
        Logger.log("No common time found yet for the group");
        return;
    }

    const allEmails = Object.keys(submissions);
    const cal = CalendarApp.getDefaultCalendar();
    const groupEventIdKey = 'GROUP_MASTER_EVENT_ID';
    const masterEventId = docProps.getProperty(groupEventIdKey);

    const meetingTitle = eventData.summary || "Group Meeting";
    const meetingDescription = eventData.description || "Scheduled with CommonTime";

    if (masterEventId) {
        try {
            const masterEvent = cal.getEventById(masterEventId);
            if (masterEvent) {
                masterEvent.setTime(new Date(bestFit.startTime), new Date(bestFit.endTime));
                masterEvent.setTitle(meetingTitle);
                masterEvent.setDescription(meetingDescription);

                allEmails.forEach(email => {
                    try {
                        masterEvent.addGuest(email);
                    } catch (e) {
                        Logger.log("Could not add guest: " + email);
                    }
                });

                Logger.log("Updated master group event successfully.");
                
                // Email confirmation to the latest submitter
                sendConfirmationEmail(eventData.guestEmail, meetingTitle, bestFit.startTime, bestFit.endTime);
                return;
            }
        } catch (r) {
            Logger.log("No master event found via ID, creating a new one.");
        }
    }

    // Create new master group event if none exists yet
    const options = {
        description: meetingDescription,
        sendInvites: true,
        guests: allEmails.join(',')
    };

    const newMasterEvent = cal.createEvent(
        meetingTitle,
        new Date(bestFit.startTime),
        new Date(bestFit.endTime),
        options
    );
    docProps.setProperty(groupEventIdKey, newMasterEvent.getId());
    Logger.log("Created new master group event.");

    // Email confirmation to the respondent
    sendConfirmationEmail(eventData.guestEmail, meetingTitle, bestFit.startTime, bestFit.endTime);
}

/**
 * Computes the best overlapping meeting time range across all group submissions.
 */
function calculateBestFit(subList) {
    if (!subList || subList.length === 0) return null;

    let latestStart = new Date(Math.max(...subList.map(s => new Date(s.startTime).getTime())));
    let earliestEnd = new Date(Math.min(...subList.map(s => new Date(s.endTime).getTime())));

    if (latestStart < earliestEnd) {
        return {
            startTime: latestStart.toISOString(),
            endTime: earliestEnd.toISOString()
        };
    }

    Logger.log("No overlap found, using best estimation");
    return {
        startTime: subList[subList.length - 1].startTime,
        endTime: subList[subList.length - 1].endTime
    };
}


// ==========================================
// 7. GEMINI AI PARSING HELPER
// ==========================================
/**
 * Sends form text responses to the Gemini API to extract structured JSON meeting details.
 */
function geminiParse(input) {
    const apiKey = PropertiesService.getScriptProperties().getProperty('gemini_api_key');
    if (!apiKey) throw new Error("Missing 'gemini_api_key' in Script Properties.");

    const timezone = Session.getScriptTimeZone();
    const nowISO = new Date().toISOString();
    const modelsToTry = ['gemini-3.8-flash', 'gemini-3.6-flash',
        'gemini-2.5-flash', 'gemini-2.5-pro',
        'gemini-1.5-flash', 'gemini-flash-latest'];

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


// ==========================================
// 8. CALENDAR EVENT UTILITY
// ==========================================
/**
 * Helper utility to directly create a calendar event with standard options.
 */
function createCalendarEvent(eventData) {
    const cal = CalendarApp.getDefaultCalendar();
    const startTime = new Date(eventData.startTime);
    const endTime = new Date(eventData.endTime);

    const options = {
        description: eventData.description || "Scheduled with CommonTime",
        sendInvites: true,
        guests: eventData.guestEmail
    };

    if (eventData.guestEmail) {
        options.guests = eventData.guestEmail;
    }

    return cal.createEvent(eventData.summary || "Meeting", startTime, endTime, options);
}


// ==========================================
// 9. EMAIL NOTIFICATION UTILITY
// ==========================================
/**
 * Sends a direct email confirmation to the respondent for an accepted timeslot.
 */
function sendConfirmationEmail(email, summary, startTime, endTime) {
    if (!email) return;
    try {
        const subject = "Meeting Confirmed: " + summary;
        const body = `Hello,\n\nYour meeting "${summary}" has been successfully scheduled and added to the publisher's calendar.\n\n`
                   + `📅 Time: ${new Date(startTime).toLocaleString()} - ${new Date(endTime).toLocaleString()}\n\n`
                   + `A calendar invitation has also been sent to your inbox.\n\nThank you!`;
        MailApp.sendEmail(email, subject, body);
        Logger.log("Confirmation email successfully sent to " + email);
    } catch (e) {
        Logger.log("Failed to send confirmation email: " + e.toString());
    }
}


// ==========================================
// 10. FORM TEMPLATE MANAGEMENT
// ==========================================
/**
 * Returns available layout templates for configuring the form elements.
 */
function getAvailableTemplates() {
    return [
        { id: 'standard', name: 'Standard 30-min Meeting', description: 'Asks for preferred date and time.' },
        { id: 'strict_availability', name: 'Strict Publisher Slots', description: 'Forces respondents to choose from available publisher windows.' }
    ];
}

/**
 * Applies a selected template structure to the active Google Form.
 */
function applyTemplate(templateId) {
    const form = FormApp.getActiveForm();

    const items = form.getItems();
    items.forEach(item => form.deleteItem(item));

    if (templateId === 'standard') {
        form.setTitle('CommonTime Scheduler - Standard');
        form.addTextItem().setTitle('Meeting Summary / Purpose').setRequired(true);
        form.addParagraphTextItem().setTitle('Proposed Date and Time (e.g., Tomorrow at 2 PM)').setRequired(true);
    } else if (templateId === 'strict_availability') {
        form.setTitle('CommonTime Scheduler - Select a Slot');
        form.addTextItem().setTitle('Meeting Summary / Purpose').setRequired(true);

        // Fetch publisher's open slots for the next 7 days and create a Multiple Choice item
        const openSlots = getPublisherOpenSlots();
        const choices = openSlots.map(slot => slot.label);

        if (choices.length > 0) {
            form.addMultipleChoiceItem()
                .setTitle('Select an available time slot')
                .setChoices(choices.map(c => form.createChoice(c)))
                .setRequired(true);
        } else {
            form.addTextItem().setTitle('No automated slots found. Enter your preferred time:').setRequired(true);
        }
    }

    PropertiesService.getDocumentProperties().setProperty('ACTIVE_TEMPLATE', templateId);
    return "Template applied successfully!";
}


// ==========================================
// 11. PUBLISHER AVAILABILITY & FREE/BUSY CHECK
// ==========================================
/**
 * Scans the publisher's default calendar over the next 7 days during working hours (9 AM - 5 PM),
 * filters out conflicting busy slots, and returns a list of genuinely available windows.
 */
function getPublisherOpenSlots() {
    const cal = CalendarApp.getDefaultCalendar();
    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const events = cal.getEvents(now, sevenDaysLater);

    const slots = [];
    let curr = new Date(now);
    curr.setHours(9, 0, 0, 0);

    for (let i = 0; i < 5; i++) { // Look at next 5 weekdays
        let dayStart = new Date(curr);
        dayStart.setDate(dayStart.getDate() + i);
        dayStart.setHours(9, 0, 0, 0);

        let dayEnd = new Date(dayStart);
        dayEnd.setHours(17, 0, 0, 0);

        let slotTime = new Date(dayStart);
        while (slotTime < dayEnd) {
            let slotEnd = new Date(slotTime.getTime() + 60 * 60 * 1000);

            // Check if publisher is busy during this window
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