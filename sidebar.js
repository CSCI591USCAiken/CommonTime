/**
 * ============================================================================
 * COMMONTIME SCHEDULER ADD-ON - SIDEBAR CLIENT-SIDE LOGIC
 * ============================================================================
 */

/**
 * Executes automatically when the sidebar HTML window loads.
 * Fetches the currently saved scheduling mode from backend properties and initializes the UI.
 */
window.onload = function () {
    google.script.run
        .withSuccessHandler(updateModeUI)
        .withFailureHandler(showError)
        .getScheduleMode();
};

/**
 * Updates the backend scheduling mode ('SINGLE' or 'GROUP') and reflects the change in the UI.
 * 
 * @param {string} mode - The scheduling mode selected by the user.
 */
function selectMode(mode) {
    google.script.run
        .withSuccessHandler(() => {
            updateModeUI(mode);
            showStatus("Mode updated to " + mode, "success");
        })
        .withFailureHandler(showError)
        .setScheduleMode(mode);
}

/**
 * Updates the visual active state of the Single vs. Group scheduling mode buttons.
 * 
 * @param {string} mode - The active scheduling mode ('SINGLE' or 'GROUP').
 */
function updateModeUI(mode) {
    const currentMode = mode || 'SINGLE'; // Default fallback if no property is set
    document.getElementById('btnSingle').classList.toggle('active', currentMode === 'SINGLE');
    document.getElementById('btnGroup').classList.toggle('active', currentMode === 'GROUP');
}

/**
 * Reads the selected template choice from the dropdown menu and commands the backend
 * to apply the chosen template layout to the active Google Form.
 */
function applyTemplateChoice() {
    const templateId = document.getElementById('templateSelect').value;
    google.script.run
        .withSuccessHandler((msg) => showStatus(msg, "success"))
        .withFailureHandler(showError)
        .applyTemplate(templateId);
}

/**
 * Enables automated background form submission sync and Gemini calendar event creation triggers.
 */
function turnOnSync() {
    google.script.run
        .withSuccessHandler(() => showStatus("CommonTime sync enabled successfully!", "success"))
        .withFailureHandler(showError)
        .toggleTriggerOn();
}

/**
 * Disables automated background sync by deleting active form submission triggers.
 */
function turnOffSync() {
    google.script.run
        .withSuccessHandler(() => showStatus("CommonTime sync disabled.", "error"))
        .withFailureHandler(showError)
        .toggleTriggerOff();
}

/**
 * Displays an ephemeral status message banner at the bottom of the sidebar.
 * Automatically hides the message box after 4 seconds.
 * 
 * @param {string} text - The message content to display.
 * @param {string} type - The CSS class defining message style ('success' or 'error').
 */
function showStatus(text, type) {
    const msg = document.getElementById('statusMsg');
    msg.innerText = text;
    msg.className = type;
    setTimeout(() => { 
        msg.style.display = 'none'; 
    }, 4000);
}

/**
 * Error failure handler callback. Automatically passes caught errors to the status banner.
 * 
 * @param {Error} err - The error object returned from backend script execution.
 */
function showError(err) {
    showStatus("Error: " + err.message, "error");
}