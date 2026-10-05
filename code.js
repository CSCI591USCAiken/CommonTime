const FORM_ID = '1224liCQoT93XDfEdzQKYZWE-mCny4ILcRekJANnmPfo';

function setupFormTrigger() {
    const form = FormApp.openById(FORM_ID);

    // 1. Fetch all triggers for this project
    const existingTriggers = ScriptApp.getProjectTriggers();

    // 2. Remove any existing triggers bound to onFormSubmit
    for (let i = 0; i < existingTriggers.length; i++) {
        if (existingTriggers[i].getHandlerFunction() === 'onFormSubmit') {
            ScriptApp.deleteTrigger(existingTriggers[i]);
        }
    }

    // 3. Create the single active trigger
    ScriptApp.newTrigger('onFormSubmit')
        .forForm(form)
        .onFormSubmit()
        .create();

    Logger.log('Trigger successfully linked to Form: ' + form.getTitle());
}


function onFormAddonOpen(e) {
    Logger.log("Add-on opened. Event object: " + JSON.stringify(e));

    const card = CardService.newCardBuilder()
        .setHeader(CardService.newCardHeader().setTitle("CommonTime Scheduler"))
        .addSection(
            CardService.newCardSection().addWidget(
                CardService.newTextParagraph().setText("Welcome to CommonTime! Submit a form entry.")
            )
        )
        .build();

    return [card];
}


function onFormSubmit(e) {
    try {
        //Extract user's email
        const respEmail = e.response.getRespondentEmail();

        // get user's response
        const itemResp = e.response.getItemResponses();
        let userTxtResp = "";

        for (let i = 0; i < itemResp.length; i++) {
            userTxtResp += itemResp[i].getItem().getTitle()
                + ": " + itemResp[i].getResponse() + "\n";
        }

        Logger.log("Raw Response:\n" + userTxtResp);

        //Call Gemini to extract data
        const parsedData = geminiParse(userTxtResp);

        if (parsedData && parsedData.startTime && parsedData.endTime) {
            parsedData.guestEmail = respEmail;

            //Create G. Calendar event
            createCalendarEvent(parsedData);
        } else {
            Logger.log("Gemini failed to return valid format");
        }
    } catch (f) {
        Logger.log("Error while processing form submission: " + f.toString());
    }
}

function geminiParse(input) {
    const apiKey = PropertiesService.getScriptProperties().getProperty('gemini_api_key');
    if (!apiKey) {
        throw new Error("Missing 'gemini_api_key' in Script Properties.");
    }

    // 1. Get current time and active timezone from Google Apps Script context
    const timezone = Session.getScriptTimeZone();
    const nowISO = new Date().toISOString();

    // 2. Use standard production model target
    const model = 'gemini-3.5-flash'; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // 3. Anchor the LLM prompt with absolute reference time and ISO offset requirements
    const prompt = `You are a professional calendar scheduling assistant. 
Extract meeting timing details from the user input. 
Create the meeting based on the time the user states they are available. If multiple users submit times,
try to place the event at a time that satisfies the most possible users. Make the event an RSVP so users can accept or reject
the time as necessary.

Context Information:
- Current Time (ISO): ${nowISO}
- Target Timezone: ${timezone}

User Input:
"${input}"

Instructions:
- Convert any relative terms (e.g., "tomorrow", "next Friday at 2pm") into full ISO 8601 strings.
- Include the exact timezone offset in the return string (e.g., "2026-10-01T14:00:00-04:00").
- If duration is unspecified, assume a 30-minute duration.`;

    const payload = {
        "contents": [{
            "parts": [{ "text": prompt }]
        }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "summary": { "type": "STRING" },
                    "startTime": { 
                        "type": "STRING", 
                        "description": "ISO 8601 formatted date-time string WITH offset, e.g. 2026-10-01T15:00:00-04:00" 
                    },
                    "endTime": { 
                        "type": "STRING", 
                        "description": "ISO 8601 formatted date-time string WITH offset, e.g. 2026-10-01T16:00:00-04:00" 
                    },
                    "description": { "type": "STRING" }
                },
                "required": ["summary", "startTime", "endTime"]
            }
        }
    };

    const options = {
        "method": "post",
        "contentType": "application/json",
        "payload": JSON.stringify(payload),
        "muteHttpExceptions": true
    };

    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode !== 200) {
        Logger.log(`Gemini API Error (Status ${responseCode}):\n${responseText}`);
        throw new Error(`Gemini API returned status code ${responseCode}`);
    }

    const jsonResponse = JSON.parse(responseText);
    const rawText = jsonResponse.candidates[0].content.parts[0].text;

    return JSON.parse(rawText);
}

//Create Event on Calendar
function createCalendarEvent(eventData) {
    const cal = CalendarApp.getDefaultCalendar();
    const calendarTimeZone = cal.getTimeZone();

    Logger.log(`--- Event Creation Diagnostics ---`);
    Logger.log(`Script Timezone: ${scriptTimeZone}`);
    Logger.log(`Target Calendar Timezone: ${calendarTimeZone}`);
    Logger.log(`Raw Gemini startTime: ${eventData.startTime}`);
    Logger.log(`Raw Gemini endTime: ${eventData.endTime}`);

    // Parse dates
    const startTime = new Date(eventData.startTime);
    const endTime = new Date(eventData.endTime);

    // 1. Check for invalid date strings (e.g. malformed ISO output from API)
    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
        throw new Error(
            `Invalid date format received from Gemini.\n` +
            `Parsed Start: ${eventData.startTime} -> ${startTime}\n` +
            `Parsed End: ${eventData.endTime} -> ${endTime}`
        );
    }

    // 2. Validate timing logic (Start must occur before End)
    if (endTime <= startTime) {
        throw new Error(
            `End time must be after start time.\n` +
            `Start: ${startTime.toISOString()}\n` +
            `End: ${endTime.toISOString()}`
        );
    }

    // Log formatted local times as interpreted by Apps Script
    const formattedStart = Utilities.formatDate(startTime, calendarTimeZone, "yyyy-MM-dd HH:mm:ss z");
    const formattedEnd = Utilities.formatDate(endTime, calendarTimeZone, "yyyy-MM-dd HH:mm:ss z");
    
    Logger.log(`Resolved Start Time (Calendar TZ): ${formattedStart}`);
    Logger.log(`Resolved End Time (Calendar TZ): ${formattedEnd}`);

    // Construct event
    const title = eventData.summary || "CommonTime Scheduled Meeting";
    const options = {
        description: eventData.description || "Scheduled with CommonTime Add-On",
        sendInvites: true
    };

    if(eventData.guestEmail) {
        options.guests = eventData.guestEmail;
    }

    const event = cal.createEvent(title, startTime, endTime, options);
    Logger.log(`Successfully created event: ID ${event.getId()}`);
    return event;
}

function listGeminiModels() {
    const apiKey = PropertiesService.getScriptProperties()
        .getProperty('gemini_api_key');

    const response = UrlFetchApp.fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        { method: 'get', muteHttpExceptions: true }
    );

    Logger.log(response.getContentText());

    if (response.getResponseCode() !== 200) {
        throw new Error(`List models failed: ${response.getResponseCode()}`);
    }

    const result = JSON.parse(response.getContentText());
    (result.models || []).forEach(model => {
        if ((model.supportedGenerationMethods || []).includes('generateContent')) {
            Logger.log(model.name);
        }
    });
}
// This is a test of Jira commits (again)