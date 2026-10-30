function installMinimalFormTrigger(formId) {
    const form = formId ? FormApp.openById(formId) : FormApp.getActiveForm();
    if (!form) {
        throw new Error("No active form found. Run this from the bound form project or pass a form ID.");
    }

    ScriptApp.getProjectTriggers().forEach(function (trigger) {
        if (trigger.getHandlerFunction() === 'minimalFormSubmitProbe' &&
            trigger.getTriggerSourceId() === form.getId()) {
            ScriptApp.deleteTrigger(trigger);
        }
    });

    ScriptApp.newTrigger('minimalFormSubmitProbe')
        .forForm(form)
        .onFormSubmit()
        .create();

    Logger.log("Minimal form trigger installed for form ID " + form.getId());
}

function minimalFormSubmitProbe(e) {
    if (!e || !e.response) {
        throw new Error("No form-submit event received. Submit a response to invoke this function.");
    }

    Logger.log(JSON.stringify({
        eventReceived: true,
        formId: e.source.getId(),
        responseId: e.response.getId(),
        itemResponseCount: e.response.getItemResponses().length
    }));
}
