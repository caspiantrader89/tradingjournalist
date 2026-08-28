/* =========================================================
   REGISTRAZIONE — creazione account con profilo completo
   ========================================================= */

const CONSENT_VERSION = 1;

function translateRegisterError(err) {
  const map = {
    'auth/invalid-email': 'Email non valida.',
    'auth/email-already-in-use': 'Esiste già un account con questa email.',
    'auth/weak-password': 'Password troppo debole (minimo 6 caratteri).',
    'auth/network-request-failed': 'Errore di rete. Controlla la connessione.',
  };
  return map[err.code] || ('Errore: ' + err.message);
}

function setRegisterBusy(busy) {
  document.querySelectorAll('#register-form button, #register-form input, #register-form select').forEach(el => el.disabled = busy);
}

async function saveRegistrationProfile(user, data) {
  await db.collection('users').doc(user.uid).set({
    email: user.email || null,
    nome: data.nome,
    cognome: data.cognome,
    paese: data.paese,
    esperienzaTrading: data.esperienza,
    comeCiHaConosciuto: data.referral,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    termsAccepted: true,
    termsAcceptedAt: firebase.firestore.FieldValue.serverTimestamp(),
    consentVersion: CONSENT_VERSION,
    marketingConsent: !!data.marketingOk,
    marketingConsentAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('reg-error');
  errBox.textContent = '';

  const nome = document.getElementById('reg-nome').value.trim();
  const cognome = document.getElementById('reg-cognome').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass = document.getElementById('reg-password').value;
  const passConfirm = document.getElementById('reg-password-confirm').value;
  const paese = document.getElementById('reg-paese').value;
  const esperienza = document.getElementById('reg-esperienza').value;
  const referral = document.getElementById('reg-referral').value;
  const termsOk = document.getElementById('reg-consent-terms').checked;
  const marketingOk = document.getElementById('reg-consent-marketing').checked;

  if (!nome || !cognome || !email || !pass || !passConfirm) {
    errBox.textContent = 'Compila tutti i campi obbligatori.';
    return;
  }
  if (!paese || !esperienza || !referral) {
    errBox.textContent = 'Seleziona tutte le opzioni richieste.';
    return;
  }
  if (pass.length < 6) {
    errBox.textContent = 'La password deve avere almeno 6 caratteri.';
    return;
  }
  if (pass !== passConfirm) {
    errBox.textContent = 'Le due password non coincidono.';
    return;
  }
  if (!termsOk) {
    errBox.textContent = 'Devi accettare Termini di Servizio e Informativa Privacy per registrarti.';
    return;
  }

  setRegisterBusy(true);
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await cred.user.updateProfile({ displayName: (nome + ' ' + cognome).trim() });
    await saveRegistrationProfile(cred.user, { nome, cognome, paese, esperienza, referral, marketingOk });
    await cred.user.sendEmailVerification();

    document.getElementById('reg-form-block').style.display = 'none';
    document.getElementById('reg-success-block').style.display = 'block';
  } catch (err) {
    errBox.textContent = translateRegisterError(err);
    setRegisterBusy(false);
  }
});
