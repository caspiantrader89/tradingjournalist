/* =========================================================
   MULTIVERSO ↔ DIARIO
   Legge (SOLA LETTURA) journals/{uid} e compila il simulatore.
   Le formule seguono quelle di app.js: se le cambi lì,
   aggiornale anche qui.
   ========================================================= */

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var MIN_TRADES = 30; // soglia indicativa per l'avviso "pochi dati"
  var accounts = {};
  var loadToken = 0;

  var num = function (n, d) { return n.toLocaleString('it-IT', { maximumFractionDigits: d }); };
  var hasNum = function (v) { return typeof v === 'number' && isFinite(v); };

  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* Calcola i parametri del simulatore a partire dallo STATE di un conto */
  function computeParams(state) {
    var settings = state.settings || {};
    var trades = state.trades || [];
    var instruments = state.instruments || [];
    var initial = Number(settings.initialCapital) || 0;
    var thr = settings.beThreshold || 0;
    var closed = trades.filter(function (t) { return t.status === 'CLOSED' && t.closeDate; });

    var events = [];
    (state.movements || []).forEach(function (m) {
      var amount = Number(m.amount) || 0;
      events.push({ date: new Date(m.date), delta: m.type === 'DEPOSIT' ? amount : -amount });
    });
    closed.forEach(function (t) {
      events.push({ date: new Date(t.closeDate), delta: Number(t.profit) || 0, trade: t });
    });
    events.sort(function (a, b) { return a.date - b.date; });

    var equity = initial, wins = [], losses = [], be = 0, risks = [];
    events.forEach(function (e) {
      var t = e.trade;
      if (t && hasNum(t.profit)) {
        if (Math.abs(t.profit) <= thr) be++;
        else if (t.profit > 0) wins.push(t.profit);
        else losses.push(-t.profit);

        var instr = instruments.filter(function (i) { return i.name === t.instrument; })[0];
        if (instr && t.entryPrice && t.slPrice && t.lots && instr.pipSize && equity > 0) {
          var risk = Math.abs(t.entryPrice - t.slPrice) / instr.pipSize * instr.pipValue * t.lots;
          if (risk > 0) risks.push(risk / equity * 100);
        }
      }
      equity += e.delta;
    });

    var sum = function (a) { return a.reduce(function (s, v) { return s + v; }, 0); };
    var n = wins.length + losses.length;
    return {
      capital: equity,
      currency: settings.currency || 'EUR',
      wins: wins.length, losses: losses.length, be: be, n: n,
      winrate: n ? wins.length / n * 100 : null,
      rr: wins.length && losses.length ? (sum(wins) / wins.length) / (sum(losses) / losses.length) : null,
      riskPct: risks.length ? median(risks) : null,
      riskSample: risks.length
    };
  }

  function status(html, kind) {
    var el = $('tj-status');
    el.className = 'tj-status' + (kind ? ' ' + kind : '');
    el.innerHTML = html;
  }

  function show(mode) {
    $('tj-guest').hidden = mode !== 'guest';
    $('tj-user').hidden = mode !== 'user';
  }

  function applyAccount() {
    var acc = accounts[$('tj-account').value];
    if (!acc) return;
    var p = computeParams(acc.state || {});
    if (!p.n) {
      status('Questo conto non ha ancora trade chiusi in guadagno o in perdita. Puoi usare il simulatore con valori manuali.', 'warn');
      return;
    }

    var done = window.Multiverso.apply({
      capital: p.capital > 0 ? p.capital : null,
      currency: p.currency,
      winrate: p.winrate,
      rr: p.rr,
      riskPct: p.riskPct
    });

    var lines = ['<b>' + p.n + ' trade</b> usati: ' + p.wins + ' in guadagno, ' + p.losses + ' in perdita' +
      (p.be ? ' (' + p.be + ' break even esclusi)' : '') + '.'];
    var warn = false;
    if (p.capital <= 0) { lines.push('Il capitale del conto non è positivo: inseriscilo a mano.'); warn = true; }
    if (p.rr === null) { lines.push('Servono almeno un guadagno e una perdita per calcolare il rapporto R:R: controlla il valore impostato.'); warn = true; }
    if (p.riskPct === null) lines.push('Rischio per trade non stimabile (mancano gli stop loss): resta quello impostato a mano.');
    else lines.push('Rischio per trade: mediana di ' + p.riskSample + ' trade con stop loss (' + num(p.riskPct, 2) + '%).');
    if (done.clamped.length) { lines.push('Fuori dai limiti del cursore, quindi ridotto: ' + done.clamped.join(', ') + '.'); warn = true; }
    if (p.n < MIN_TRADES) { lines.push('Pochi dati: sotto i ' + MIN_TRADES + ' trade le stime sono poco affidabili.'); warn = true; }
    status(lines.join('<br>'), warn ? 'warn' : 'ok');
  }

  /* Legge il diario solo da Firebase (stesso documento usato da app.js) */
  async function loadWrapper(user) {
    var raw = null, failed = false;
    try {
      var snap = await db.collection('journals').doc(user.uid).get();
      if (snap.exists) raw = snap.data();
    } catch (e) { console.warn('Multiverso: lettura da Firebase fallita', e); failed = true; }
    if (raw && !raw.accounts && raw.state) {
      raw = { currentAccountId: 'main', accounts: { main: { name: 'Conto principale', state: raw.state } } };
    }
    return { wrapper: raw, failed: failed };
  }

  async function loadUser(user) {
    var token = ++loadToken;
    show('user');
    $('tj-controls').hidden = true;
    status('Carico i dati del diario…');
    var res = await loadWrapper(user);
    if (token !== loadToken) return; // nel frattempo è cambiato il login

    accounts = (res.wrapper && res.wrapper.accounts) || {};
    var ids = Object.keys(accounts);
    if (!ids.length) {
      status(res.failed ? 'Non riesco a leggere il diario da Firebase. Controlla la connessione e ricarica la pagina.'
        : 'Non ci sono ancora dati nel diario.', 'warn');
      return;
    }
    var sel = $('tj-account');
    sel.textContent = '';
    ids.forEach(function (id) { sel.add(new Option(accounts[id].name || 'Conto', id)); });
    sel.value = accounts[res.wrapper.currentAccountId] ? res.wrapper.currentAccountId : ids[0];
    $('tj-controls').hidden = false;
    applyAccount();
  }

  $('tj-account').addEventListener('change', applyAccount);
  $('tj-reload').addEventListener('click', function () {
    if (auth.currentUser) loadUser(auth.currentUser);
  });

  var hadUser = false;
  auth.onAuthStateChanged(function (user) {
    if (user && user.emailVerified) { hadUser = true; loadUser(user); return; }
    loadToken++;
    accounts = {};
    $('tj-account').textContent = '';
    status('');
    // dopo un logout i valori del conto non devono restare a schermo
    if (hadUser) { hadUser = false; window.location.reload(); return; }
    show('guest');
  });
})();
