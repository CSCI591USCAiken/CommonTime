
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



}