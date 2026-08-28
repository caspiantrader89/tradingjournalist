/* =========================================================
   AUTH — login / registrazione / logout con Firebase Auth
   ========================================================= */

let _lastUid = null;

function hideAllScreens() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('verify-email-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'none';
}
function showApp() {
  hideAllScreens();
  document.getElementById('app-shell').style.display = 'flex';
}
function showLogin() {
  hideAllScreens();
  document.getElementById('login-screen').style.display = 'flex';
}
function showVerifyEmail(user) {
  hideAllScreens();
  document.getElementById('verify-email-address').textContent = user.email || '';
  document.getElementById('verify-email-screen').style.display = 'flex';
}

function translateAuthError(err) {
  const map = {
    'auth/invalid-email': 'Email non valida.',
    'auth/user-disabled': 'Questo utente è stato disabilitato.',
    'auth/user-not-found': 'Nessun account trovato con questa email.',
    'auth/wrong-password': 'Password errata.',
    'auth/email-already-in-use': 'Esiste già un account con questa email.',
    'auth/weak-password': 'Password troppo debole (minimo 6 caratteri).',
    'auth/invalid-credential': 'Email o password non corrette.',
    'auth/too-many-requests': 'Troppi tentativi falliti. Riprova più tardi.',
    'auth/network-request-failed': 'Errore di rete. Controlla la connessione.',
    'auth/popup-closed-by-user': 'Accesso annullato.',
  };
  return map[err.code] || ('Errore: ' + err.message);
}

function setLoginBusy(busy) {
  document.querySelectorAll('#login-screen button, #login-screen input').forEach(el => el.disabled = busy);
}

auth.onAuthStateChanged(async (user) => {
  const errBox = document.getElementById('login-error');
  if (errBox) errBox.textContent = '';

  if (user) {
    window.firebaseUser = user;
    const label = document.getElementById('user-email-label');
    if (label) label.textContent = user.email || user.displayName || 'Account';

    if (!user.emailVerified) {
      showVerifyEmail(user);
      return;
    }

    showApp();

    if (_lastUid !== user.uid) {
      _lastUid = user.uid;
      if (typeof window.initJournal === 'function') {
        await window.initJournal();
      }
    }
  } else {
    window.firebaseUser = null;
    _lastUid = null;
    showLogin();
  }
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-password').value;
  const errBox = document.getElementById('login-error');
  errBox.textContent = '';
  if (!email || !pass) { errBox.textContent = 'Inserisci email e password.'; return; }
  setLoginBusy(true);
  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch (err) {
    errBox.textContent = translateAuthError(err);
  } finally {
    setLoginBusy(false);
  }
});

document.getElementById('forgot-password-link').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const errBox = document.getElementById('login-error');
  errBox.textContent = '';
  if (!email) { errBox.textContent = 'Inserisci la tua email nel campo sopra, poi clicca di nuovo.'; return; }
  try {
    await auth.sendPasswordResetEmail(email);
    errBox.style.color = 'var(--pos, #2ecc71)';
    errBox.textContent = 'Email per reimpostare la password inviata.';
  } catch (err) {
    errBox.style.color = '';
    errBox.textContent = translateAuthError(err);
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  auth.signOut();
});

/* ---------- Verifica email ---------- */

const verifyRefreshBtn = document.getElementById('verify-refresh-btn');
if (verifyRefreshBtn) verifyRefreshBtn.addEventListener('click', async () => {
  const msg = document.getElementById('verify-msg');
  msg.style.color = '';
  msg.textContent = 'Controllo in corso...';
  try {
    await auth.currentUser.reload();
    if (auth.currentUser.emailVerified) {
      _lastUid = null; // forza il ricaricamento del diario dopo la verifica
      showApp();
      if (typeof window.initJournal === 'function') {
        _lastUid = auth.currentUser.uid;
        await window.initJournal();
      }
    } else {
      msg.style.color = 'var(--amber, #E0A23C)';
      msg.textContent = 'Email non ancora confermata. Controlla la posta (e lo spam).';
    }
  } catch (e) {
    msg.style.color = 'var(--red, #F14D68)';
    msg.textContent = 'Errore durante il controllo. Riprova.';
  }
});

const verifyResendBtn = document.getElementById('verify-resend-btn');
if (verifyResendBtn) verifyResendBtn.addEventListener('click', async () => {
  const msg = document.getElementById('verify-msg');
  msg.style.color = '';
  msg.textContent = 'Invio in corso...';
  try {
    await auth.currentUser.sendEmailVerification();
    msg.style.color = 'var(--green, #33C48B)';
    msg.textContent = 'Email inviata di nuovo.';
  } catch (err) {
    if (err && err.code === 'auth/too-many-requests') {
      msg.style.color = 'var(--amber, #E0A23C)';
      msg.textContent = 'Hai richiesto troppe email in poco tempo. Riprova tra qualche minuto.';
    } else {
      msg.style.color = 'var(--red, #F14D68)';
      msg.textContent = 'Errore durante l\'invio. Riprova.';
    }
  }
});

const verifyLogoutLink = document.getElementById('verify-logout-link');
if (verifyLogoutLink) verifyLogoutLink.addEventListener('click', (e) => {
  e.preventDefault();
  auth.signOut();
});

/* ---------- Pannello "Privacy e dati" ---------- */

function openPrivacyPanel() {
  const backdrop = document.getElementById('privacy-panel-backdrop');
  const msg = document.getElementById('privacy-panel-msg');
  msg.textContent = '';
  backdrop.classList.add('active');
  if (window.firebaseUser) {
    db.collection('users').doc(window.firebaseUser.uid).get()
      .then(snap => {
        const data = snap.exists ? snap.data() : {};
        document.getElementById('marketing-pref-toggle').checked = !!data.marketingConsent;
      })
      .catch(() => {});
  }
}
function closePrivacyPanel() {
  document.getElementById('privacy-panel-backdrop').classList.remove('active');
}

const openPrivacyLink = document.getElementById('open-privacy-panel-link');
if (openPrivacyLink) openPrivacyLink.addEventListener('click', (e) => { e.preventDefault(); openPrivacyPanel(); });

const closePrivacyBtn = document.getElementById('close-privacy-panel-btn');
if (closePrivacyBtn) closePrivacyBtn.addEventListener('click', closePrivacyPanel);

const privacyBackdrop = document.getElementById('privacy-panel-backdrop');
if (privacyBackdrop) privacyBackdrop.addEventListener('click', (e) => { if (e.target === privacyBackdrop) closePrivacyPanel(); });

const openCookiePrefsLink = document.getElementById('open-cookie-prefs-link');
if (openCookiePrefsLink) openCookiePrefsLink.addEventListener('click', (e) => {
  e.preventDefault();
  if (window.CookieConsent) window.CookieConsent.openPreferences();
});

const saveMarketingBtn = document.getElementById('save-marketing-pref-btn');
if (saveMarketingBtn) saveMarketingBtn.addEventListener('click', async () => {
  const msg = document.getElementById('privacy-panel-msg');
  if (!window.firebaseUser) return;
  const checked = document.getElementById('marketing-pref-toggle').checked;
  msg.style.color = '';
  msg.textContent = 'Salvataggio...';
  try {
    await db.collection('users').doc(window.firebaseUser.uid).set({
      marketingConsent: checked,
      marketingConsentAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    msg.style.color = 'var(--green, #33C48B)';
    msg.textContent = 'Preferenza salvata.';
  } catch (e) {
    msg.style.color = 'var(--red, #F14D68)';
    msg.textContent = 'Errore nel salvataggio. Riprova.';
  }
});

const exportBtn = document.getElementById('export-data-btn');
if (exportBtn) exportBtn.addEventListener('click', async () => {
  const msg = document.getElementById('privacy-panel-msg');
  if (!window.firebaseUser) return;
  msg.style.color = '';
  msg.textContent = 'Preparazione export...';
  try {
    const uid = window.firebaseUser.uid;
    const [userSnap, journalSnap, consentSnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection('journals').doc(uid).get(),
      db.collection('consents').doc(uid).get().catch(() => null)
    ]);
    const exportPayload = {
      exportedAt: new Date().toISOString(),
      account: { uid, email: window.firebaseUser.email },
      profile: userSnap.exists ? userSnap.data() : null,
      journal: journalSnap.exists ? journalSnap.data() : null,
      cookieConsent: (consentSnap && consentSnap.exists) ? consentSnap.data() : null
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tradejournalist-dati-' + uid.slice(0, 6) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    msg.style.color = 'var(--green, #33C48B)';
    msg.textContent = 'Export scaricato.';
  } catch (e) {
    console.error(e);
    msg.style.color = 'var(--red, #F14D68)';
    msg.textContent = 'Errore durante l\'export. Riprova.';
  }
});

const deleteBtn = document.getElementById('delete-account-btn');
if (deleteBtn) deleteBtn.addEventListener('click', async () => {
  const msg = document.getElementById('privacy-panel-msg');
  if (!window.firebaseUser) return;
  const first = window.confirm('Questa operazione eliminerà definitivamente il tuo account e tutti i tuoi dati. Vuoi continuare?');
  if (!first) return;
  const second = window.confirm('Confermi in modo definitivo? Non sarà possibile recuperare i dati dopo questa azione.');
  if (!second) return;

  msg.style.color = '';
  msg.textContent = 'Eliminazione in corso...';
  const uid = window.firebaseUser.uid;
  try {
    await Promise.all([
      db.collection('journals').doc(uid).delete().catch(() => {}),
      db.collection('users').doc(uid).delete().catch(() => {})
      // Nota: il documento in "consents" viene mantenuto come da Informativa Privacy
      // (prova del consenso ai fini di accountability, art. 5.2 GDPR).
    ]);
    await window.firebaseUser.delete();
    closePrivacyPanel();
  } catch (err) {
    if (err && err.code === 'auth/requires-recent-login') {
      msg.style.color = 'var(--red, #F14D68)';
      msg.textContent = 'Per motivi di sicurezza, effettua di nuovo il login e riprova subito dopo.';
    } else {
      console.error(err);
      msg.style.color = 'var(--red, #F14D68)';
      msg.textContent = 'Errore durante l\'eliminazione. Riprova o contattaci.';
    }
  }
});
