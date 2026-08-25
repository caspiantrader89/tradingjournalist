/* =========================================================
   COOKIE CONSENT — banner GDPR con categorie, persistenza
   locale (localStorage) e log su Firestore per l'utente
   loggato (prova di consenso ai sensi dell'art. 7 GDPR).
   ========================================================= */

(function () {
  const CONSENT_KEY = 'cookie_consent';
  const CONSENT_VERSION = 1;

  function readConsent() {
    try {
      const raw = localStorage.getItem(CONSENT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.version !== CONSENT_VERSION) return null;
      return parsed;
    } catch (e) { return null; }
  }

  function writeConsent(consent) {
    const payload = {
      version: CONSENT_VERSION,
      necessary: true,
      analytics: !!consent.analytics,
      marketing: !!consent.marketing,
      updatedAt: new Date().toISOString()
    };
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify(payload)); } catch (e) { /* ignore */ }
    syncToFirestore(payload);
    applyConsent(payload);
    return payload;
  }

  function syncToFirestore(payload) {
    try {
      const user = (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser : null;
      if (!user || typeof db === 'undefined') return;
      db.collection('consents').doc(user.uid).set({
        necessary: true,
        analytics: payload.analytics,
        marketing: payload.marketing,
        version: payload.version,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        history: firebase.firestore.FieldValue.arrayUnion({
          analytics: payload.analytics,
          marketing: payload.marketing,
          at: payload.updatedAt
        })
      }, { merge: true }).catch(err => console.warn('Consent sync failed', err));
    } catch (e) { /* firebase not ready, ignore */ }
  }

  let _analyticsLoaded = false;

  function loadAnalytics() {
    if (_analyticsLoaded) return;
    if (typeof firebase === 'undefined' || typeof firebaseConfig === 'undefined') return;
    _analyticsLoaded = true;
    const script = document.createElement('script');
    script.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics-compat.js';
    script.onload = () => {
      try { firebase.analytics(); } catch (e) { console.warn('Impossibile inizializzare Analytics', e); }
    };
    script.onerror = () => { _analyticsLoaded = false; };
    document.head.appendChild(script);
  }

  function applyConsent(payload) {
    // Analytics (Firebase/Google Analytics) viene caricato SOLO se l'utente ha
    // acconsentito alla categoria "Analitici". Nessuno script viene scaricato
    // o eseguito prima di questo momento.
    if (payload.analytics) {
      loadAnalytics();
    }
    // Punto di estensione per il marketing: qui puoi caricare script di
    // marketing solo se l'utente ha dato il consenso alla relativa categoria, es:
    // if (payload.marketing && !window._pixelLoaded) { loadMarketingPixel(); }
    document.dispatchEvent(new CustomEvent('cookieconsentchange', { detail: payload }));
  }

  /* ---------- UI ---------- */

  let els = null;

  function injectStyles() {
    if (document.getElementById('cc-styles')) return;
    const style = document.createElement('style');
    style.id = 'cc-styles';
    style.textContent = `
      #cc-banner{position:fixed; left:16px; right:16px; bottom:16px; z-index:2000;
        max-width:640px; margin:0 auto; background:var(--surface,#141922);
        border:1px solid var(--border,#232B37); border-radius:14px; padding:18px 20px;
        box-shadow:0 12px 40px rgba(0,0,0,0.45); font-family:inherit; color:var(--text,#E9EDF3);
        display:none; flex-direction:column; gap:12px;}
      #cc-banner p{font-size:13px; color:var(--text-dim,#8592A3); margin:0; line-height:1.5;}
      #cc-banner a{color:var(--blue,#5B8CFF);}
      .cc-btn-row{display:flex; gap:8px; flex-wrap:wrap;}
      .cc-btn{flex:1; min-width:120px; padding:10px 14px; border-radius:8px; font-size:13px; font-weight:600;
        cursor:pointer; border:1px solid var(--border,#232B37); background:var(--surface-2,#191F2A); color:var(--text,#E9EDF3);}
      .cc-btn:hover{opacity:.9;}
      .cc-btn-primary{background:var(--green,#33C48B); border-color:var(--green,#33C48B); color:#0a1a12;}
      #cc-modal-backdrop{position:fixed; inset:0; z-index:2100; background:rgba(5,7,10,0.7);
        display:none; align-items:center; justify-content:center; padding:20px;}
      #cc-modal{width:100%; max-width:420px; background:var(--surface,#141922); border:1px solid var(--border,#232B37);
        border-radius:14px; padding:24px; color:var(--text,#E9EDF3); font-family:inherit;}
      #cc-modal h3{font-size:16px; margin-bottom:14px;}
      .cc-row{display:flex; align-items:flex-start; justify-content:space-between; gap:14px;
        padding:12px 0; border-bottom:1px solid var(--border-soft,#1A212B);}
      .cc-row:last-of-type{border-bottom:none;}
      .cc-row-text{flex:1;}
      .cc-row-title{font-size:13.5px; font-weight:600; margin-bottom:2px;}
      .cc-row-desc{font-size:12px; color:var(--text-dim,#8592A3); line-height:1.4;}
      .cc-switch{position:relative; width:40px; height:22px; flex:none; margin-top:2px;}
      .cc-switch input{opacity:0; width:0; height:0;}
      .cc-slider{position:absolute; inset:0; background:var(--border,#232B37); border-radius:22px; cursor:pointer; transition:.15s;}
      .cc-slider:before{content:""; position:absolute; width:16px; height:16px; left:3px; top:3px; background:#fff; border-radius:50%; transition:.15s;}
      .cc-switch input:checked + .cc-slider{background:var(--green,#33C48B);}
      .cc-switch input:checked + .cc-slider:before{transform:translateX(18px);}
      .cc-switch input:disabled + .cc-slider{opacity:.5; cursor:not-allowed;}
      #cc-modal .cc-btn-row{margin-top:18px;}
    `;
    document.head.appendChild(style);
  }

  function injectDom() {
    if (document.getElementById('cc-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'cc-banner';
    banner.innerHTML = `
      <p>Usiamo cookie tecnici necessari al funzionamento del servizio e, solo con il tuo consenso,
      cookie analitici e di marketing. Consulta la <a href="cookie.html" target="_blank">Cookie Policy</a>.</p>
      <div class="cc-btn-row">
        <button type="button" class="cc-btn" id="cc-reject">Rifiuta non necessari</button>
        <button type="button" class="cc-btn" id="cc-customize">Personalizza</button>
        <button type="button" class="cc-btn cc-btn-primary" id="cc-accept">Accetta tutti</button>
      </div>
    `;
    document.body.appendChild(banner);

    const backdrop = document.createElement('div');
    backdrop.id = 'cc-modal-backdrop';
    backdrop.innerHTML = `
      <div id="cc-modal">
        <h3>Preferenze cookie</h3>
        <div class="cc-row">
          <div class="cc-row-text">
            <div class="cc-row-title">Necessari</div>
            <div class="cc-row-desc">Indispensabili per l'accesso e il funzionamento del servizio. Sempre attivi.</div>
          </div>
          <label class="cc-switch"><input type="checkbox" checked disabled><span class="cc-slider"></span></label>
        </div>
        <div class="cc-row">
          <div class="cc-row-text">
            <div class="cc-row-title">Analitici</div>
            <div class="cc-row-desc">Ci aiutano a capire come viene usato il servizio, in forma aggregata.</div>
          </div>
          <label class="cc-switch"><input type="checkbox" id="cc-toggle-analytics"><span class="cc-slider"></span></label>
        </div>
        <div class="cc-row">
          <div class="cc-row-text">
            <div class="cc-row-title">Marketing</div>
            <div class="cc-row-desc">Usati per personalizzare comunicazioni e misurare eventuali campagne.</div>
          </div>
          <label class="cc-switch"><input type="checkbox" id="cc-toggle-marketing"><span class="cc-slider"></span></label>
        </div>
        <div class="cc-btn-row">
          <button type="button" class="cc-btn" id="cc-modal-cancel">Annulla</button>
          <button type="button" class="cc-btn cc-btn-primary" id="cc-modal-save">Salva preferenze</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    els = {
      banner,
      backdrop,
      analytics: document.getElementById('cc-toggle-analytics'),
      marketing: document.getElementById('cc-toggle-marketing'),
    };

    document.getElementById('cc-accept').addEventListener('click', () => {
      writeConsent({ analytics: true, marketing: true });
      hideBanner();
    });
    document.getElementById('cc-reject').addEventListener('click', () => {
      writeConsent({ analytics: false, marketing: false });
      hideBanner();
    });
    document.getElementById('cc-customize').addEventListener('click', () => openModal());
    document.getElementById('cc-modal-cancel').addEventListener('click', () => closeModal());
    document.getElementById('cc-modal-save').addEventListener('click', () => {
      writeConsent({ analytics: els.analytics.checked, marketing: els.marketing.checked });
      closeModal();
      hideBanner();
    });
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
  }

  function showBanner() { injectStyles(); injectDom(); els.banner.style.display = 'flex'; }
  function hideBanner() { if (els) els.banner.style.display = 'none'; }

  function openModal(prefill) {
    injectStyles(); injectDom();
    const current = prefill || readConsent() || { analytics: false, marketing: false };
    els.analytics.checked = !!current.analytics;
    els.marketing.checked = !!current.marketing;
    els.backdrop.style.display = 'flex';
  }
  function closeModal() { if (els) els.backdrop.style.display = 'none'; }

  function init() {
    injectStyles(); injectDom();
    const consent = readConsent();
    if (consent) {
      applyConsent(consent);
    } else {
      showBanner();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Se un utente effettua il login dopo aver già espresso un consenso da
  // anonimo, sincronizziamo quel consenso sul suo profilo alla prima occasione.
  try {
    if (typeof auth !== 'undefined') {
      auth.onAuthStateChanged((user) => {
        if (user) {
          const consent = readConsent();
          if (consent) syncToFirestore(consent);
        }
      });
    }
  } catch (e) { /* auth non disponibile su questa pagina */ }

  window.CookieConsent = {
    get: readConsent,
    openPreferences: () => openModal(),
  };
})();
