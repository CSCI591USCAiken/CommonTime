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
        if (formId) {
            form = FormApp.openById(formId);
        } else {
            form = FormApp.getActiveForm();
        }
    } catch (e) {
        Logger.log("Error opening form: " + e.toString());
    }
    
    if (!form) {
        throw new Error("Could not detect active form. Please open this from the Form editor.");
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
    const triggers = ScriptApp.getUserTriggers(FormApp.getActiveForm());
    triggers.forEach((trigger) => {
        if (trigger.getHandlerFunction() === 'onFormSubmit' && trigger.getTriggerSourceId() === formId) {
            ScriptApp.deleteTrigger(trigger);
        }
    });
}

function onFormSubmit(e) {
    try {
        if (!e || !e.response) {
            Logger.log("Trigger fired without event object data.");
            return;
        }

        const respEmail = e.response.getRespondentEmail();
        const itemResp = e.response.getItemResponses();
        let userTxtResp = "";

        for (let i = 0; i < itemResp.length; i++) {
            userTxtResp += itemResp[i].getItem().getTitle() + ": " + itemResp[i].getResponse() + "\n";
        }

        Logger.log("Parsed Form Responses:\n" + userTxtResp);

        const parsedData = geminiParse(userTxtResp);
        if (!parsedData || !parsedData.startTime || !parsedData.endTime) {
            Logger.log("Gemini failed to parse valid start/end times.");
            return;
        }

        const cal = CalendarApp.getDefaultCalendar();
        const start = new Date(parsedData.startTime);
        const end = new Date(parsedData.endTime);

        parsedData.guestEmail = respEmail;
        const mode = getScheduleMode();
        
        if (mode === 'SINGLE') {
            handleIndEvent(parsedData);
        } else {
            handleGroupEvent(parsedData);
        }
    } catch (f) {
        Logger.log("CRITICAL ERROR in onFormSubmit: " + f.toString());
    }
}

function handleIndEvent(eventData) {
    const docProps = PropertiesService.getDocumentProperties();
    const emailKey = 'EVENT_ID_' + (eventData.guestEmail ? eventData.guestEmail.toLowerCase() : 'anonymous');
    const existingEventId = docProps.getProperty(emailKey);

    const cal = CalendarApp.getDefaultCalendar();
    const startTime = new Date(eventData.startTime);
    const endTime = new Date(eventData.endTime);

    const options = {
        description: eventData.description || "Scheduled with CommonTime",
        sendInvites: true
    };
    if (eventData.guestEmail) options.guests = eventData.guestEmail;

    if (existingEventId) {
        try {
            const existingEvent = cal.getEventById(existingEventId);
            if (existingEvent) {
                existingEvent.setTime(startTime, endTime);
                existingEvent.setTitle(eventData.summary || "Meeting");
                existingEvent.setDescription(options.description);
                Logger.log("Updated existing event for: " + eventData.guestEmail);
                sendConfirmationEmail(eventData.guestEmail, eventData.summary || "Meeting", startTime, endTime);
                return;
            }
        } catch (err) {
            Logger.log("Could not find existing event ID, creating new one.");
        }
    }

    const newEvent = cal.createEvent(eventData.summary || "Meeting", startTime, endTime, options);
    docProps.setProperty(emailKey, newEvent.getId());
    Logger.log("Created new event for " + eventData.guestEmail);

    sendConfirmationEmail(eventData.guestEmail, eventData.summary || "Meeting", startTime, endTime);
}

function handleGroupEvent(eventData) {
    const docProps = PropertiesService.getDocumentProperties();
    const submissionKey = "ALL_GROUP_SUBMISSIONS";
    let submissions = JSON.parse(docProps.getProperty(submissionKey) || '{}');

    const identifier = eventData.guestEmail || ('user_' + Date.now());
    submissions[identifier] = {
        startTime: eventData.startTime,
        endTime: eventData.endTime,
        summary: eventData.summary,
        description: eventData.description,
        guestEmail: eventData.guestEmail
    };
    docProps.setProperty(submissionKey, JSON.stringify(submissions));

    const bestFit = calculateBestFit(Object.values(submissions));
    if (!bestFit) return;

    const allEmails = Object.values(submissions).map(s => s.guestEmail).filter(Boolean);
    const cal = CalendarApp.getDefaultCalendar();
    const groupEventIdKey = 'GROUP_MASTER_EVENT_ID';
    const masterEventId = docProps.getProperty(groupEventIdKey);

    const allSubmissions = Object.values(submissions);
    let aggregatedDescription = "Scheduled with CommonTime (Group)\n\nSubmitted Details:\n" + 
        allSubmissions.map(s => `- ${s.guestEmail || 'Anonymous'}: "${s.summary || 'Meeting'}"`).join('\n');

    const meetingTitle = "Group Meeting";

    if (masterEventId) {
        try {
            const masterEvent = cal.getEventById(masterEventId);
            if (masterEvent) {
                masterEvent.setTime(new Date(bestFit.startTime), new Date(bestFit.endTime));
                masterEvent.setTitle(meetingTitle);
                masterEvent.setDescription(aggregatedDescription);
                allEmails.forEach(email => {
                    try { masterEvent.addGuest(email); } catch (e) {}
                });
                sendConfirmationEmail(eventData.guestEmail, meetingTitle, bestFit.startTime, bestFit.endTime);
                return;
            }
        } catch (r) {}
    }

    const options = {
        description: aggregatedDescription,
        sendInvites: true,
        guests: allEmails.join(',')
    };

    const newMasterEvent = cal.createEvent(meetingTitle, new Date(bestFit.startTime), new Date(bestFit.endTime), options);
    docProps.setProperty(groupEventIdKey, newMasterEvent.getId());
    sendConfirmationEmail(eventData.guestEmail, meetingTitle, bestFit.startTime, bestFit.endTime);
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