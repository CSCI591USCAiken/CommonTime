// Hold scheduling until a form receives the requested number of distinct respondents.
function validateMinimumResponses_(value) {
    const minimum = Number(value);
    if (!Number.isInteger(minimum) || minimum < 1 || minimum > 500) throw new Error('Choose a whole number from 1 to 500.');
    return minimum;
}
function gateConfig_(id) {
    const raw = PropertiesService.getScriptProperties().getProperty('CT_GATE_' + id);
    return raw ? JSON.parse(raw) : null;
}
function gateResponses_(form, config) {
    const latest = {};
    form.getResponses().forEach(function (response) {
        const email = String(response.getRespondentEmail() || '').trim().toLowerCase();
        if (!email || response.getTimestamp().getTime() < config.startedAt) return;
        if (!latest[email] || latest[email].getTimestamp() <= response.getTimestamp()) latest[email] = response;
    });
    return Object.keys(latest).map(function (email) { return latest[email]; });
}
function gateStatus_(form) {
    const config = gateConfig_(form.getId());
    const count = config ? gateResponses_(form, config).length : 0;
    return {formId: form.getId(), title: form.getTitle(), minimum: config ? config.minimum : 1,
        count: count, released: !!(config && config.released), configured: !!config,
        message: config && config.released ? 'Target reached. Scheduling has been released.' :
            config && config.minimum > 1 ? 'Waiting: ' + count + ' of ' + config.minimum + ' distinct respondents since this hold was enabled.' : 'Schedule as responses arrive.'};
}
function saveResponseGateForForm_(form, minimum) {
    minimum = validateMinimumResponses_(minimum);
    const store = PropertiesService.getScriptProperties(), id = form.getId(), previous = gateConfig_(id);
    if (previous && previous.released && previous.minimum !== minimum) throw new Error('This form has already released its responses. Use a new form for a new response target.');
    const config = {minimum: minimum, startedAt: previous ? previous.startedAt : Date.now(), released: !!(previous && previous.released)};
    store.setProperty('CT_GATE_' + id, JSON.stringify(config));
    // Let the existing delayed group handler find the same form's hold setting.
    getProps().setProperty('RESPONSE_GATE_FORM_ID', id);
    return gateStatus_(form);
}
function responseGateForm_(formId) {
    const form = formId ? FormApp.openById(formId) : FormApp.getActiveForm();
    if (!form) throw new Error('Open CommonTime from a Google Form first.');
    return form;
}
function getResponseGateSettings(formId) { return gateStatus_(responseGateForm_(formId)); }
function saveResponseGateSettings(input) {
    if (!input) throw new Error('Choose a response target.');
    const form = responseGateForm_(input.formId), lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
        const action = function () { return saveResponseGateForForm_(form, input.minimum); };
        return PropertiesService.getScriptProperties().getProperty('CT_WEBSITE_FORM_' + form.getId()) ? withWebsiteForm_(form.getId(), action) : action();
    } finally { lock.releaseLock(); }
}
function responseGateCanSchedule_() {
    const id = CT_FORM_CONTEXT_ || getProps().getProperty('RESPONSE_GATE_FORM_ID');
    const config = id && gateConfig_(id);
    return !config || config.minimum === 1 || config.released;
}
function responseReceipt_(response) { return String(response.getId()) + ':' + response.getTimestamp().getTime(); }
function dispatchResponseGate_(e) {
    const form = e && e.source, config = form && gateConfig_(form.getId());
    // Preserve the original behavior until the host explicitly saves a hold.
    if (!config) return processFormSubmission_(e);
    if (!e.response) throw new Error('The trigger did not provide a form response.');
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
        const current = gateConfig_(form.getId()), responses = gateResponses_(form, current), store = PropertiesService.getScriptProperties();
        if (!current.released && responses.length < current.minimum) {
            store.setProperty('CT_GATE_STATUS_' + form.getId(), 'Waiting: ' + responses.length + ' of ' + current.minimum + ' respondents. No events or emails created.');
            return;
        }
        current.released = true;
        store.setProperty('CT_GATE_' + form.getId(), JSON.stringify(current));
        // Receipt checks skip completed responses and retry earlier failures on the next submission.
        const pending = responses;
        const errors = [];
        pending.forEach(function (response) {
            const email = String(response.getRespondentEmail() || '').trim().toLowerCase();
            if (!email) return;
            const key = 'CT_GATE_DONE_' + form.getId() + '_' + encodeURIComponent(email), receipt = responseReceipt_(response);
            if (store.getProperty(key) === receipt) return;
            try {
                processFormSubmission_({source: form, response: response});
                store.setProperty(key, receipt);
            } catch (error) { errors.push(error); }
        });
        store.setProperty('CT_GATE_STATUS_' + form.getId(), errors.length ? 'Target reached, but ' + errors.length + ' responses need organizer review. See failed executions.' : 'Target reached. Waiting responses released to the scheduler.');
        if (errors.length) throw new Error(errors.length + ' responses could not be scheduled: ' + errors[0].message);
    } finally { lock.releaseLock(); }
}
