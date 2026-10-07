// Deprecated: Hard coded version of add-on
/*
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
*/


//This is an experimental change to convert this fully into an addon:

function onFormAddonOpen(e) {
    return [buildCard()];
}

//Create the UI to show addon trigger status and toggle button
function buildCard() {
    const form = FormApp.getActiveForm();
    const formId = form.getId();
    const isTriggerActive = checkExistingTrigger(formId);

    const statusText = isTriggerActive
        ? "Status: Active (Syncing Submissions)"
        : "Status Inactive";

    const buttonText = isTriggerActive 
        ? "Disable Calendar Integration" : "Enable Calendar Integreation";
    const buttonAction = isTriggerActive
        ? "toggleTriggerOff" : "toggleTriggerOn";
    
    const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle("CommonTime Scheduler"))
    .addSection(
        CardService.newCardSection()
        .addWidget(CardService.newTextParagraph().setText(statusText))
        .addWidget(
            CardService.newTextButton()
            .setText(buttonText)
            .setOnClickAction(CardService.newAction().setFunctionName(buttonAction))
        )
    ).build();

    return card;
}

//Handler to create submission trigger for current form
function toggleTriggerOn(e) {
    const form = FormApp.getActiveForm();

    //remove any duplicate triggers
    removeExistingTriggers(form.getId);

    //create form submission trigger for active form
    ScriptApp.newTrigger('onFormSubmit')
        .forForm(form)
        .onFormSubmit()
        .create();
    
    return CardService.newActionResponseBuilder()
        .setNotification(CardService.newNotification().setText("CommonTime enabled for current form"))
        .setNavigation(CardService.newNavigation().updateCard(buildCard()))
        .build();
}

//Handler to remove submission trigger for current form
function toggleTriggerOff(e) {
    const form = FormApp.getActiveForm();
    removeExistingTriggers(form.getId());

    return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText("CommonTime disabled for current form"))
        .setNavigation(CardService.newNavigation().updateCard(buildCard()))
        .build();
}

//Check if "onFormSubmit" trigger is active for target form
function checkExistingTrigger(formId) {
    const triggers = ScriptApp.getUserTriggers(FormApp.getActiveForm());
    return triggers.some(
        (t) => t.getHandlerFunction() === 'onFormSubmit'
            && t.getTriggerSourceId() === formId
    );
}

// remove all triggers assigned to target form
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

    const timezone = Session.getScriptTimeZone();
    const nowISO = new Date().toISOString();

    // Primary model and fallback options in order of preference
    const modelsToTry = ['gemini-3.8-flash', 'gemini-3.6-flash', 
        'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-pro',
         'gemini-1.5-flash', 'gemini-flash-latest'];
    
    const prompt = `You are a professional calendar scheduling assistant. 
Extract meeting timing details from the user input.
Determine the start and end times based on the availability stated by the user.

Context Information:
- Current Time (ISO): ${nowISO}
- Target Timezone: ${timezone}

User Input:
"${input}"

Instructions:
- Convert any relative time expressions (e.g., "tomorrow at 3pm") into absolute ISO 8601 strings.
- Include the exact timezone offset in the returned string (e.g., "2026-10-01T14:00:00-04:00").
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
                    "startTime": { "type": "STRING" },
                    "endTime": { "type": "STRING" },
                    "description": { "type": "STRING" }
                },
                "required": ["summary", "startTime", "endTime"]
            }
        }
    };

    let lastError = null;

    // Loop through fallback models if a 404 occurs
    for (const model of modelsToTry) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        
        const options = {
            "method": "post",
            "contentType": "application/json",
            "payload": JSON.stringify(payload),
            "muteHttpExceptions": true
        };

        const response = UrlFetchApp.fetch(url, options);
        const responseCode = response.getResponseCode();
        const responseText = response.getContentText();

        if (responseCode === 200) {
            const jsonResponse = JSON.parse(responseText);
            const rawText = jsonResponse.candidates[0].content.parts[0].text;
            return JSON.parse(rawText);
        } else if (responseCode === 404 || responseCode === 503) {
            Logger.log(`Model ${model} returned error. Trying next model...`);
            lastError = `Model ${model} not found.`;
        } else {
            throw new Error(`Gemini API Error (Status ${responseCode}): ${responseText}`);
        }
    }

    throw new Error(`All model endpoints failed. Last error: ${lastError}`);
}

//Create Event on Calendar
function createCalendarEvent(eventData) {
    const cal = CalendarApp.getDefaultCalendar();
    const scriptTimeZone = Session.getScriptTimeZone();
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