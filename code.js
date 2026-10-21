// Automatically adds the menu option to the Google Form editor
function onOpen(e) {
    FormApp.getUi()
        .createAddonMenu()
        .addItem('Open CommonTime', 'showSidebar')
        .addToUi();
}

// Opens the custom HTML sidebar
function showSidebar() {
    const ui = HtmlService.createHtmlOutputFromFile('Sidebar')
        .setTitle('CommonTime Scheduler');
    FormApp.getUi().showSidebar(ui);
}


function setScheduleMode(mode) {
    PropertiesService.getDocumentProperties().setProperty('SCHEDULING_MODE', mode);
}

function getScheduleMode() {
    return PropertiesService.getDocumentProperties().getProperty('SCHEDULING_MODE');
}


// Handler to create submission trigger for current form from your sidebar/code
function toggleTriggerOn() {
    const form = FormApp.getActiveForm();
    removeExistingTriggers(form.getId());

    ScriptApp.newTrigger('onFormSubmit')
        .forForm(form)
        .onFormSubmit()
        .create();

    Logger.log("CommonTime enabled for form: " + form.getTitle());
}

function toggleTriggerOff() {
    const form = FormApp.getActiveForm();
    removeExistingTriggers(form.getId());
    Logger.log("CommonTime disabled for form: " + form.getTitle());
}

function checkExistingTrigger(formId) {
    const triggers = ScriptApp.getUserTriggers(FormApp.getActiveForm());
    return triggers.some(
        (t) => t.getHandlerFunction() === 'onFormSubmit'
            && t.getTriggerSourceId() === formId
    );
}

function removeExistingTriggers(formId) {
    const triggers = ScriptApp.getUserTriggers(FormApp.getActiveForm());
    triggers.forEach((trigger) => {
        if (trigger.getHandlerFunction() === 'onFormSubmit'
            && trigger.getTriggerSourceId() === formId) {
            ScriptApp.deleteTrigger(trigger);
        }
    });
}

function onFormSubmit(e) {
    try {
        const respEmail = e.response.getRespondentEmail();
        const itemResp = e.response.getItemResponses();
        let userTxtResp = "";

        for (let i = 0; i < itemResp.length; i++) {
            userTxtResp += itemResp[i].getItem().getTitle()
                + ": " + itemResp[i].getResponse() + "\n";
        }

        const parsedData = geminiParse(userTxtResp);

        if (!parsedData || !parsedData.startTime || !parsedData.endTime) {
            Logger.log("Gemini failed to return valid format");
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
        Logger.log("Error while processing form submission: " + f.toString());
    }
}

// ==========================================
// SINGLE MODE: CREATE EVENTS FOR EACH INDIVIDUAL SUBMISSION
// ==========================================
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
                return;
            }
        } catch (err) {
            Logger.log("No existing event found, creating new one");
        }
    }

    //Create new event if one doesnt already exist

    const newEvent = cal.createEvent(eventData.summary || "Meeting", startTime, endTime, options);
    docProps.setProperty(emailKey, newEvent.getId());
    Logger.log("Created new event for " + eventData.guestEmail);

}

// ==========================================
// GROUP MODE: CREATE ONE EVENT THAT BEST FITS ALL SUBMISSIONS
// ==========================================
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
                // Update timing, title, and description safely
                masterEvent.setTime(new Date(bestFit.startTime), new Date(bestFit.endTime));
                masterEvent.setTitle(meetingTitle);
                masterEvent.setDescription(meetingDescription);

                // Add any new submitters to the event guests list
                allEmails.forEach(email => {
                    try {
                        masterEvent.addGuest(email);
                    } catch (e) {
                        Logger.log("Could not add guest: " + email);
                    }
                });

                Logger.log("Updated master group event successfully.");
                return;
            }
        } catch (r) {
            Logger.log("No master event found via ID, creating a new one.");
        }
    }

    // If no master event exists yet, create it fresh
    const options = {
        description: meetingDescription,
        sendInvites: true,
        guests: allEmails.join(',') // Comma-separated string works on creation
    };

    const newMasterEvent = cal.createEvent(
        meetingTitle,
        new Date(bestFit.startTime),
        new Date(bestFit.endTime),
        options
    );
    docProps.setProperty(groupEventIdKey, newMasterEvent.getId());
    Logger.log("Created new master group event.");
}

function calculateBestFit(subList) {
    if(!subList || subList.length === 0) return null;

    let latestStart = new Date(Math.max(...subList.map(s => new Date(s.startTime).getTime())));
    let earliestEnd = new Date(Math.min(...subList.map(s => new Date(s.endTime).getTime())));

    if (latestStart < earliestEnd){
        return{
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