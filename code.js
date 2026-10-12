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

        if (parsedData && parsedData.startTime && parsedData.endTime) {
            parsedData.guestEmail = respEmail;
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
        sendInvites: true
    };

    if (eventData.guestEmail) {
        options.guests = eventData.guestEmail;
    }

    return cal.createEvent(eventData.summary || "Meeting", startTime, endTime, options);
}