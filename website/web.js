
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

// Invites select the form belonging to the PrototypeB installation.
(() => {
    const provided = new URLSearchParams(location.search).get('form')
        ?? 'https://docs.google.com/forms/d/e/1FAIpQLSchaYhJnOxO9AslMSm_c7jn4tDQyoXVjbKWwM9iZcX4O4I_FA/viewform';
    const status = document.getElementById('connectionStatus');
    const frame = document.getElementById('availabilityForm');
    const fallback = document.querySelector('.fallback');
    const direct = document.getElementById('directFormLink');
    try {
        if (!provided) throw Error('Open the website invite from your organizer to load their form.');
        const form = new URL(provided);
        if (form.protocol !== 'https:' || form.hostname !== 'docs.google.com'
            || !/^\/forms\/d\/(?:e\/)?[\w-]+\/viewform$/.test(form.pathname)
            || form.username || form.password || form.port) throw Error('This invite has an invalid form link. Ask your organizer for a new invite.');
        form.searchParams.delete('embedded');
        fallback.querySelector('a').href = form.href;
        direct.href = form.href;
        form.searchParams.set('embedded', 'true');
        frame.src = form.href;
        frame.hidden = fallback.hidden = direct.hidden = false;
        status.textContent = 'Connected to your organizer’s form · check the form title before submitting';
    } catch (error) {
        frame.removeAttribute('src');
        frame.hidden = fallback.hidden = direct.hidden = true;
        status.textContent = error.message;
    }
})();
