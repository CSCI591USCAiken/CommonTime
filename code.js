// ==========================================
// WEB APP ENTRY POINT (Handles External Website Requests)
// ==========================================
function doPost(e) {
    try {
        const data = JSON.parse(e.postData.contents);

        // Expected payload structure from external site:
        // {
        //   "title": "Team Sprint Planning",
        //   "mode": "GROUP", // or "SINGLE"
        //   "timeframe": "Next week between 9am and 5pm",
        //   "emails": ["user1@example.com", "user2@example.com"],
        //   "description": "Please select your available time."
        // }

        const result = createCommonTimeForm(data);

        return ContentService.createTextOutput(JSON.stringify({
            status: "success",
            formId: result.formId,
            formUrl: result.formUrl,
            editUrl: result.editUrl
        })).setMimeType(ContentService.MimeType.JSON);

    } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({
            status: "error",
            message: err.toString()
        })).setMimeType(ContentService.MimeType.JSON);
    }
}

// ==========================================
// PROGRAMMATIC FORM CREATOR
// ==========================================
function createCommonTimeForm(data) {
    // 1. Create a new Google Form in Drive
    const form = FormApp.create(data.title || "CommonTime Scheduler");
    const formId = form.getId();

    // 2. Set up form questions (Template)
    form.setDescription(data.description || `Time-frame: ${data.timeframe || "Standard"}`);
    form.setCollectEmail(true); // Required for guest matching!

    // Add standard questions for Gemini to parse
    form.addTextItem()
        .setTitle("What is your available date and time?")
        .setHelpText("e.g., Monday from 2 PM to 4 PM");

    form.addTextItem()
        .setTitle("Meeting Summary / Notes")
        .setRequired(false);

    // 3. Save configuration in Script Properties keyed by formId
    const scriptProps = PropertiesService.getScriptProperties();
    scriptProps.setProperty(`MODE_${formId}`, data.mode || "SINGLE");
    scriptProps.setProperty(`EMAILS_${formId}`, JSON.stringify(data.emails || []));

    // 4. Automatically attach the form submission trigger
    ScriptApp.newTrigger('onFormSubmit')
        .forForm(form)
        .onFormSubmit()
        .create();

    Logger.log("Created and configured form: " + form.getTitle() + " (ID: " + formId + ")");

    return {
        formId: formId,
        formUrl: form.getPublishedUrl(),
        editUrl: form.getEditUrl()
    };
}

// ==========================================
// FORM SUBMISSION EVENT HANDLER
// ==========================================
function onFormSubmit(e) {
    try {
        const form = e.source || FormApp.openById(e.triggerSourceId);
        const formId = form.getId();
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

        const scriptProps = PropertiesService.getScriptProperties();
        const mode = scriptProps.getProperty(`MODE_${formId}`) || 'SINGLE';

        if (mode === 'SINGLE') {
            handleIndEvent(formId, parsedData);
        } else {
            handleGroupEvent(formId, parsedData);
        }

    } catch (f) {
        Logger.log("Error while processing form submission: " + f.toString());
    }
}

// ==========================================
// SINGLE MODE: CREATE EVENTS FOR EACH INDIVIDUAL SUBMISSION
// ==========================================
function handleIndEvent(formId, eventData) {
    const scriptProps = PropertiesService.getScriptProperties();
    const emailKey = `EVENT_${formId}_${eventData.guestEmail.toLowerCase()}`;
    const existingEventId = scriptProps.getProperty(emailKey);

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
    scriptProps.setProperty(emailKey, newEvent.getId());
    Logger.log("Created new event for " + eventData.guestEmail);

}

// ==========================================
// GROUP MODE: CREATE ONE EVENT THAT BEST FITS ALL SUBMISSIONS
// ==========================================
function handleGroupEvent(formId, eventData) {
    const scriptProps = PropertiesService.getScriptProperties();
    const submissionKey = `SUBMISSIONS_${formId}`;
    let submissions = JSON.parse(scriptProps.getProperty(submissionKey) || '{}');

    submissions[eventData.guestEmail] = {
        startTime: eventData.startTime,
        endTime: eventData.endTime,
        summary: eventData.summary,
        description: eventData.description
    };
    scriptProps.setProperty(submissionKey, JSON.stringify(submissions));

    const bestFit = calculateBestFit(Object.values(submissions));
    if (!bestFit) {
        Logger.log("No common time found yet for the group");
        return;
    }

    // Combine invited emails from payload + submitters
    let invitedEmails = JSON.parse(scriptProps.getProperty(`EMAILS_${formId}`) || '[]');
    const submitterEmails = Object.keys(submissions);
    const allEmails = Array.from(new Set([...invitedEmails, ...submitterEmails])).join(',');

    const cal = CalendarApp.getDefaultCalendar();
    const groupEventIdKey = `GROUP_MASTER_${formId}`;
    const masterEventId = scriptProps.getProperty(groupEventIdKey);

    const options = {
        description: eventData.description || "Scheduled with CommonTime",
        sendInvites: true,
        guests: allEmails
    };

    if (masterEventId) {
        try {
            const masterEvent = cal.getEventById(masterEventId);
            if (masterEvent) {
                masterEvent.setTime(new Date(bestFit.startTime), new Date(bestFit.endTime));
                masterEvent.setTitle(eventData.summary || "Group Meeting");
                masterEvent.setGuests(allEmails);
                Logger.log("Updated master group event.");
                return;
            }
        } catch (r) {
            Logger.log("No master event found, creating new.");
        }
    }

    const newMasterEvent = cal.createEvent(
        eventData.summary || "Group Meeting",
        new Date(bestFit.startTime),
        new Date(bestFit.endTime),
        options
    );
    scriptProps.setProperty(groupEventIdKey, newMasterEvent.getId());
}

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

    Logger.log("No overlap found, using latest submission window");
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

/*
in web app:

async function createSchedulerForm() {
    const payload = {
        title: "Q3 Strategy Sync",
        mode: "GROUP",
        timeframe: "Next week between 1 PM and 5 PM",
        emails: ["colleague1@example.com", "colleague2@example.com"],
        description: "Please input your preferred timing for the sync."
    };

    const response = await fetch("YOUR_APPS_SCRIPT_WEB_APP_URL", {
        method: "POST",
        body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (result.status === "success") {
        console.log("Form created successfully!");
        console.log("Live Form URL:", result.formUrl);
        console.log("Edit URL:", result.editUrl);
    } else {
        console.error("Error:", result.message);
    }
}
    */