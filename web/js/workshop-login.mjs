import { tr } from './workshop-ui.mjs?v=00bb8ecf6593';

/** Préserve le POST serveur et les gestionnaires de mots de passe en ajoutant un retour accessible. */
export function initializeLogin() {
  const form = document.querySelector('.login-card form');
  if (!form) return;
  const password = form.elements.password;
  const toggle = document.getElementById('password-visibility');
  const submit = form.querySelector('[type=submit]');
  const status = document.getElementById('login-status');
  toggle.disabled = false;
  toggle.addEventListener('click', () => {
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(visible));
    toggle.textContent = tr(visible ? 'Masquer' : 'Afficher');
  });
  form.addEventListener('submit', event => {
    if (form.getAttribute('aria-busy') === 'true') { event.preventDefault(); return; }
    form.setAttribute('aria-busy', 'true');
    submit.disabled = true;
    status.textContent = tr('Vérification de la connexion…');
    submit.querySelector('span').textContent = tr('Connexion en cours…');
  });
  window.addEventListener('pageshow', () => {
    form.removeAttribute('aria-busy');
    submit.disabled = false;
    status.textContent = '';
    submit.querySelector('span').textContent = tr('Se connecter');
  });
  const error = document.querySelector('.login-error');
  if (error) { error.setAttribute('role', 'alert'); error.tabIndex = -1; error.focus(); }
}
initializeLogin();
