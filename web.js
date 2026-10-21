
const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
const control = document.getElementById('motionControl');
let paused = false;
function syncPreference() { control.hidden = preference.matches; }
syncPreference();
preference.addEventListener('change', syncPreference);
control.addEventListener('click', () => {
    paused = !paused;
    document.body.classList.toggle('motion-paused', paused);
    control.setAttribute('aria-pressed', String(paused));
    control.setAttribute('aria-label', paused ? 'Resume decorative animations' : 'Pause decorative animations');
    control.textContent = paused ? '▷ Resume motion' : 'Ⅱ Pause motion';
});
if ('IntersectionObserver' in window && !preference.matches) {
    const targets = document.querySelectorAll('.step, .booking>div, .faq>h2, .faq>details');
    targets.forEach((target, index) => {
        target.classList.add('reveal');
        target.style.setProperty('--reveal-delay', (index < 3 ? index * 75 : 0) + 'ms');
    });
    document.body.classList.add('motion-ready');
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
        });
    }, { threshold: 0.08 });
    targets.forEach(target => observer.observe(target));
}
async function reqFormCreation() {
    const promptNeeds = document.getElementById('promptNeeds').value;
    const promptReason = document.getElementById('promptReason').value;
    const promptInfo = document.getElementById('promptInfo').value;
    const meetType = document.querySelector('input[name="meetType"]:checked');

    if (!promptReason.trim()
        || !promptNeeds.trim()
        || !meetType) {

        alert("Please fill all required fields");
        return;
    }

    resultArea.innerHTML = "<em>Connecting to your Google account and building your custom form...</em>";

    try {
        const WEB_APP_URL = "YOUR_APPS_SCRIPT_WEB_APP_URL";

        const payload = {
            title: "CommonTime Scheduler",
            mode: "GROUP",
            timeframe: promptNeeds,
            emails: [],
            description: promptReason
        };

        const response = await fetch(WEB_APP_URL, {
            method: "POST",
            mode: "cors",
            headers: {
                "Content-Type": "text/plain;charset=utf-8"
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.status === "success") {
            resultArea.innerHTML = `
                <div style="padding: 12px; background: #e8f4ed; border-radius: 6px; color: #2e6930; margin-top: 10px;">
                  <strong>Form Created in Your Google Drive!</strong><br>
                  <a href="${result.formUrl}" target="_blank" rel="noopener">Open Live Form ↗</a> | 
                  <a href="${result.editUrl}" target="_blank" rel="noopener">Edit Form in Drive ↗</a>
                </div>
            `;

            const iframe = document.getElementById('availabilityForm');
            iframe.src = result.formUrl + "?embedded=true";
        } else {
            resultArea.innerHTML = `<span style="color: red;">Error: ${result.message}</span>`;
        }
    } catch (err) {
        resultArea.innerHTML = `<span style="color: red;">Connection failed. Make sure you authorized the script popup: ${err.toString()}</span>`;
    }
}

}