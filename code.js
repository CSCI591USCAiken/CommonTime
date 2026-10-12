function onFormAddonOpen(e) {
    // The event object provides target draft information for Google Forms
    const formId = e && e.draftMetadata ? e.draftMetadata.formId : null;
    return [buildCard(formId)];
}

function buildCard(formId) {
    // Fallback to active form if test running manually from Apps Script editor
    if (!formId) {
        const activeForm = FormApp.getActiveForm();
        if (activeForm) formId = activeForm.getId();
    }

    const isTriggerActive = formId ? checkExistingTrigger(formId) : false;

    const statusText = isTriggerActive
        ? "Status: Active (Syncing Submissions)"
        : "Status: Inactive";

    const buttonText = isTriggerActive 
        ? "Disable Calendar Integration" 
        : "Enable Calendar Integration";
        
    const buttonAction = isTriggerActive
        ? "toggleTriggerOff" 
        : "toggleTriggerOn";
    
    return CardService.newCardBuilder()
        .setHeader(CardService.newCardHeader().setTitle("CommonTime Scheduler"))
        .addSection(
            CardService.newCardSection()
                .addWidget(CardService.newTextParagraph().setText(statusText))
                .addWidget(
                    CardService.newTextButton()
                        .setText(buttonText)
                        .setOnClickAction(
                            CardService.newAction()
                                .setFunctionName(buttonAction)
                                .setParameters({ formId: formId || "" })
                        )
                )
        ).build();
}

// Handler to create submission trigger for current form
function toggleTriggerOn(e) {
    const formId = e && e.parameters ? e.parameters.formId : null;
    const form = formId ? FormApp.openById(formId) : FormApp.getActiveForm();

    if (!form) {
        throw new Error("Unable to determine target form for trigger.");
    }

    // Remove any duplicate triggers
    removeExistingTriggers(form.getId());

    // Create form submission trigger for active form
    ScriptApp.newTrigger('onFormSubmit')
        .forForm(form)
        .onFormSubmit()
        .create();
    
    return CardService.newActionResponseBuilder()
        .setNotification(CardService.newNotification().setText("CommonTime enabled for current form"))
        .setNavigation(CardService.newNavigation().updateCard(buildCard(form.getId())))
        .build();
}

// Handler to remove submission trigger for current form
function toggleTriggerOff(e) {
    const formId = e && e.parameters ? e.parameters.formId : null;
    const form = formId ? FormApp.openById(formId) : FormApp.getActiveForm();

    if (!form) {
        throw new Error("Unable to determine target form for trigger.");
    }

    removeExistingTriggers(form.getId());

    return CardService.newActionResponseBuilder()
        .setNotification(CardService.newNotification().setText("CommonTime disabled for current form"))
        .setNavigation(CardService.newNavigation().updateCard(buildCard(form.getId())))
        .build();
}

// Check if "onFormSubmit" trigger is active for target form
function checkExistingTrigger(formId) {
    const triggers = ScriptApp.getUserTriggers(FormApp.getActiveForm() || FormApp.openById(formId));
    return triggers.some(
        (t) => t.getHandlerFunction() === 'onFormSubmit'
            && t.getTriggerSourceId() === formId
    );
}

// Remove all triggers assigned to target form
function removeExistingTriggers(formId) {
    const form = FormApp.getActiveForm() || FormApp.openById(formId);
    const triggers = ScriptApp.getUserTriggers(form);
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

        Logger.log("Raw Response:\n" + userTxtResp);

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
    if (!apiKey) {
        throw new Error("Missing 'gemini_api_key' in Script Properties.");
    }

    const timezone = Session.getScriptTimeZone();
    const nowISO = new Date().toISOString();

    const modelsToTry = ['gemini-3.8-flash', 'gemini-3.6-flash',
         'gemini-2.5-flash', 'gemini-2.5-pro',
         'gemini-1.5-flash', 'gemini-flash-latest'];
    
    const prompt = `You are a professional calendar scheduling assistant. 
Extract meeting timing details from the user input.
Determine the start and end times based on the availability stated by the user.

Context Information:
- Current Time (ISO): 
${nowISO}
- Target Timezone: 
${timezone}

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

function createCalendarEvent(eventData) {
    const cal = CalendarApp.getDefaultCalendar();
    const startTime = new Date(eventData.startTime);
    const endTime = new Date(eventData.endTime);

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
        throw new Error(`Invalid date format received from Gemini.`);
    }

    if (endTime <= startTime) {
        throw new Error(`End time must be after start time.`);
    }

    const title = eventData.summary || "CommonTime Scheduled Meeting";
    const options = {
        description: eventData.description || "Scheduled with CommonTime Add-On",
        sendInvites: true
    };

    if (eventData.guestEmail) {
        options.guests = eventData.guestEmail;
    }

    const event = cal.createEvent(title, startTime, endTime, options);
    Logger.log(`Successfully created event: ID ${event.getId()}`);
    return event;
}