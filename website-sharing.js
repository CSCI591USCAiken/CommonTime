// Website sharing for forms created by the host. Public links contain no credentials.
var CT_FORM_CONTEXT_ = null;
function withWebsiteForm_(formId, action) {
    const previous = CT_FORM_CONTEXT_;
    CT_FORM_CONTEXT_ = formId;
    try { return action(); } finally { CT_FORM_CONTEXT_ = previous; }
}
function websiteFormProps_(formId) {
    const store = PropertiesService.getScriptProperties(), prefix = 'CT_FORM_' + formId + '_';
    return {
        getProperty: function (key) { return store.getProperty(prefix + key); },
        setProperty: function (key, value) { store.setProperty(prefix + key, value); return this; },
        deleteProperty: function (key) { store.deleteProperty(prefix + key); return this; }
    };
}
function websiteBase_() {
    const raw = PropertiesService.getScriptProperties().getProperty('COMMONTIME_WEBSITE_URL') || 'https://stingingend.github.io/commontime-scheduler/';
    if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[a-z0-9._~!$&'()*+,;=:@%/-]*)?$/i.test(raw)) throw new Error('Set COMMONTIME_WEBSITE_URL to your public HTTPS website directory.');
    return raw.replace(/\/$/, '') + '/';
}
function websiteShareDetails_(form) {
    if (!form) throw new Error('Open CommonTime from a Google Form first.');
    const base = websiteBase_(), respondentUrl = form.getPublishedUrl();
    if (!/^https:\/\/docs\.google\.com\/forms\/d\/(?:e\/)?[\w-]+\/viewform(?:\?.*)?$/.test(respondentUrl)) throw new Error('Google did not return a valid respondent link.');
    const title = form.getTitle(), purpose = (form.getDescription() || '').slice(0, 500);
    return {
        formId: form.getId(), title: title, respondentUrl: respondentUrl, editUrl: form.getEditUrl(),
        published: form.isPublished(), acceptingResponses: form.isAcceptingResponses(),
        participantUrl: base + 'forms.html?form=' + encodeURIComponent(respondentUrl) + '&title=' + encodeURIComponent(title) + '&purpose=' + encodeURIComponent(purpose),
        organizerUrl: base + 'organizer.html?created_form=' + encodeURIComponent(respondentUrl) + '&created_title=' + encodeURIComponent(title) + '&created_purpose=' + encodeURIComponent(purpose) + '#pages'
    };
}
function getWebsiteShareDetails() { return websiteShareDetails_(FormApp.getActiveForm()); }
function publishActiveFormForWebsite() {
    const form = FormApp.getActiveForm();
    if (!form) throw new Error('Open CommonTime from a Google Form first.');
    websiteBase_();
    form.setPublished(true);
    form.setAcceptingResponses(true);
    return websiteShareDetails_(form);
}
function createWebsiteMeetingForm(input) {
    if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 100) throw new Error('Enter a meeting title of up to 100 characters.');
    if (!['standard', 'strict_availability'].includes(input.templateId)) throw new Error('Choose a supported template.');
    if (!['SINGLE', 'GROUP'].includes(input.mode)) throw new Error('Choose a scheduling mode.');
    const minimumResponses = validateMinimumResponses_(input.minimumResponses == null ? 1 : input.minimumResponses);
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(input.requestId || '')) throw new Error('Reopen the creator and try again.');
    const base = websiteBase_(), store = PropertiesService.getScriptProperties(), lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
        const requestKey = 'CT_CREATE_' + input.requestId, cached = store.getProperty(requestKey);
        if (cached) { const prior = JSON.parse(cached); if (prior.error) throw new Error(prior.error); return websiteShareDetails_(FormApp.openById(prior.formId)); }
        let form;
        try {
            form = FormApp.create(input.title.trim(), false);
            withWebsiteForm_(form.getId(), function () {
                setScheduleMode(input.mode);
                if (minimumResponses > 1) saveResponseGateForForm_(form, minimumResponses);
                applyTemplateToForm_(form, input.templateId);
                form.setTitle(input.title.trim());
                form.setDescription(String(input.purpose || '').trim().slice(0, 500));
                toggleTriggerOn(form.getId());
            });
            store.setProperty('CT_WEBSITE_FORM_' + form.getId(), '1');
            form.setPublished(true);
            form.setAcceptingResponses(true);
            const result = websiteShareDetails_(form);
            store.setProperty(requestKey, JSON.stringify({formId: form.getId()}));
            return result;
        } catch (error) {
            if (form) {
                const message = 'Form setup did not finish. Review the draft at ' + form.getEditUrl() + '. ' + error.message;
                store.setProperty(requestKey, JSON.stringify({error: message}));
                throw new Error(message);
            }
            throw error;
        }
    } finally { lock.releaseLock(); }
}
function onFormSubmit(e) {
    const id = e && e.source && e.source.getId();
    if (id && PropertiesService.getScriptProperties().getProperty('CT_WEBSITE_FORM_' + id)) {
        return withWebsiteForm_(id, function () { return dispatchResponseGate_(e); });
    }
    return dispatchResponseGate_(e);
}
function runQueuedGroupWithGate_() {
    if (!responseGateCanSchedule_()) return;
    return processQueuedGroupEvent_();
}
function processQueuedGroupEvent(e) {
    const store = PropertiesService.getScriptProperties(), key = e && e.triggerUid ? 'CT_GROUP_TRIGGER_' + e.triggerUid : null;
    const id = key && store.getProperty(key);
    if (id) {
        try { return withWebsiteForm_(id, runQueuedGroupWithGate_); } finally { store.deleteProperty(key); }
    }
    return runQueuedGroupWithGate_();
}
