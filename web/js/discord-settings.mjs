const form = document.getElementById('discord-settings-form');
const address = document.getElementById('discord-url');
const password = document.getElementById('discord-password');
const reveal = document.getElementById('discord-reveal');
const feedback = document.getElementById('discord-feedback');
let revealedAddress = null;
let revealedAddressEdited = false;

/** Efface l’adresse révélée inchangée mais conserve toute valeur retapée par l’utilisateur. */
function concealUnchangedAddress() {
  if (revealedAddress !== null && !revealedAddressEdited && address.value === revealedAddress) {
    address.value = '';
    address.placeholder = '•'.repeat(60);
  }
  revealedAddress = null;
  revealedAddressEdited = false;
}

/** Montre un retour dans l’emplacement réservé, sans déplacer le pied de carte. */
function showFeedback(text, state = 'error') {
  feedback.textContent = text || feedback.parentElement.dataset.default;
  feedback.title = text;
  feedback.parentElement.dataset.state = text ? state : 'neutral';
}

/** Révèle l’adresse enregistrée seulement après une confirmation serveur récente. */
async function revealSavedWebhook() {
  if (reveal.getAttribute('aria-pressed') === 'true') {
    address.type = 'password';
    concealUnchangedAddress();
    reveal.setAttribute('aria-pressed', 'false');
    reveal.setAttribute('aria-label', 'Afficher l’adresse du webhook');
    showFeedback('', 'success');
    return;
  }
  if (address.value) {
    address.type = 'text';
    reveal.setAttribute('aria-pressed', 'true');
    reveal.setAttribute('aria-label', 'Masquer l’adresse du webhook');
    return;
  }
  if (!password.value) {
    password.focus();
    showFeedback('Saisissez le mot de passe web pour afficher le webhook.');
    return;
  }
  reveal.disabled = true;
  try {
    const response = await fetch(`${form.action}?operation=reveal`, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({operation: 'reveal', password: password.value}),
    });
    const result = await response.json();
    if (!response.ok || typeof result.url !== 'string') {
      showFeedback(result.message || 'Impossible d’afficher le webhook.');
      return;
    }
    address.value = result.url;
    revealedAddress = result.url;
    revealedAddressEdited = false;
    address.placeholder = '';
    address.type = 'text';
    reveal.setAttribute('aria-pressed', 'true');
    reveal.setAttribute('aria-label', 'Masquer l’adresse du webhook');
    showFeedback('Webhook affiché. Masquez-le avant de quitter cette page.', 'success');
  } catch {
    showFeedback('Impossible de joindre l’atelier. Réessayez.');
  } finally {
    password.value = '';
    reveal.disabled = false;
  }
}

reveal.addEventListener('click', revealSavedWebhook);
form.addEventListener('submit', concealUnchangedAddress);
window.addEventListener('pagehide', () => {
  concealUnchangedAddress();
  address.type = 'password';
  reveal.setAttribute('aria-pressed', 'false');
  reveal.setAttribute('aria-label', 'Afficher l’adresse du webhook');
});
address.addEventListener('input', () => {
  if (address.value) reveal.disabled = false;
  if (revealedAddress !== null) revealedAddressEdited = true;
  showFeedback('', 'success');
});
