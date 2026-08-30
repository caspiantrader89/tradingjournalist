/* =========================================================
   JOURNAL — Trading Journal
   Persistence: Firebase Firestore (per-account, cloud sync),
   con fallback locale (localStorage) se offline.
   Richiede login (vedi auth.js / firebase-config.js).
   ========================================================= */

const STORAGE_KEY = 'trading_journal_data';

function newAccountId() { return 'acc_' + uid(); }

// Elenco conti (solo metadati: id + nome) e id del conto attualmente
// selezionato. Lo STATE globale (settings/trades/movements/...) contiene
// sempre e solo i dati del conto corrente: il resto del file non cambia.
let ACCOUNTS = [];
let CURRENT_ACCOUNT_ID = null;

/* Persistenza: Firestore (per-utente, richiede login) con fallback
   locale (localStorage) usato solo se offline o non ancora loggati.
   Il documento salvato ha la forma:
   { currentAccountId, accounts: { [id]: { name, state } } } */
const Storage = {
  _wrapperCache: null,

  _localKey() {
    // chiave locale separata per utente, per non mischiare dati tra account
    const uid = window.firebaseUser ? window.firebaseUser.uid : 'anon';
    return STORAGE_KEY + ':' + uid;
  },

  async _loadWrapper() {
    let raw = null;
    if (window.firebaseUser && typeof db !== 'undefined') {
      try {
        const snap = await db.collection('journals').doc(window.firebaseUser.uid).get();
        if (snap.exists) raw = snap.data();
      } catch (e) {
        console.warn('Firestore load failed, uso copia locale', e);
        toast('Cloud non raggiungibile, uso i dati salvati localmente', true);
      }
    }
    if (!raw) {
      try {
        const local = localStorage.getItem(this._localKey());
        raw = local ? JSON.parse(local) : null;
      } catch (e) { raw = null; }
    }
    if (!raw) return null;

    if (raw.accounts && raw.currentAccountId) return raw; // già multi-conto
    if (raw.state) {
      // formato precedente (mono-conto): lo incapsuliamo in un unico conto,
      // così i dati esistenti non vengono persi passando al multi-conto.
      const id = newAccountId();
      return { currentAccountId: id, accounts: { [id]: { name: 'Conto principale', state: raw.state } } };
    }
    return null;
  },

  async _saveWrapper(wrapper) {
    try { localStorage.setItem(this._localKey(), JSON.stringify(wrapper)); } catch (e) { /* ignore */ }
    if (window.firebaseUser && typeof db !== 'undefined') {
      try {
        await db.collection('journals').doc(window.firebaseUser.uid).set({
          currentAccountId: wrapper.currentAccountId,
          accounts: wrapper.accounts,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return true;
      } catch (e) {
        console.error('Firestore save failed', e);
        toast('Errore nel salvataggio cloud (dati comunque salvati in locale)', true);
        return false;
      }
    }
    return true;
  },

  // Carica il conto attualmente selezionato (o il primo disponibile) e
  // popola ACCOUNTS/CURRENT_ACCOUNT_ID. Ritorna lo STATE di quel conto,
  // esattamente come faceva la vecchia load() mono-conto.
  async load() {
    const wrapper = await this._loadWrapper();
    if (!wrapper || !wrapper.accounts || !Object.keys(wrapper.accounts).length) return null;
    this._wrapperCache = wrapper;
    ACCOUNTS = Object.keys(wrapper.accounts).map(id => ({ id, name: wrapper.accounts[id].name || 'Conto' }));
    CURRENT_ACCOUNT_ID = (wrapper.currentAccountId && wrapper.accounts[wrapper.currentAccountId])
      ? wrapper.currentAccountId
      : ACCOUNTS[0].id;
    return wrapper.accounts[CURRENT_ACCOUNT_ID].state || null;
  },

  // Salva i dati passati come STATE del conto attualmente selezionato,
  // dentro il wrapper multi-conto (mantiene intatti gli altri conti).
  async save(data) {
    if (!this._wrapperCache) {
      const id = CURRENT_ACCOUNT_ID || newAccountId();
      CURRENT_ACCOUNT_ID = id;
      this._wrapperCache = { currentAccountId: id, accounts: {} };
    }
    this._wrapperCache.currentAccountId = CURRENT_ACCOUNT_ID;
    const existing = this._wrapperCache.accounts[CURRENT_ACCOUNT_ID];
    this._wrapperCache.accounts[CURRENT_ACCOUNT_ID] = {
      name: (existing && existing.name) || 'Conto principale',
      state: data,
    };
    return this._saveWrapper(this._wrapperCache);
  }
};

/* ---------------- default data ---------------- */

function defaultInstruments() {
  const fx = (name, quote, pip=0.0001, val=10) => ({ id: uid(), name, category: 'Forex', currency: quote, pipSize: pip, pipValue: val, contractSize: 100000 });
  const jpy = (name, quote='USD') => fx(name, quote, 0.01, 9);
  const metal = (name, pip, contract, cur='USD') => ({ id: uid(), name, category: 'Metalli', currency: cur, pipSize: pip, pipValue: +(contract*pip).toFixed(4), contractSize: contract });
  const idx = (name, cur='USD') => ({ id: uid(), name, category: 'Indici', currency: cur, pipSize: 0.01, pipValue: 1, contractSize: 1 });
  const commo = (name, pip, val, cur='USD') => ({ id: uid(), name, category: 'Materie prime', currency: cur, pipSize: pip, pipValue: val, contractSize: 1 });
  const crypto = (name) => ({ id: uid(), name, category: 'Crypto', currency: 'USD', pipSize: 1, pipValue: 1, contractSize: 1 });
  const fut = (name, pip, tickVal, cur='USD') => ({ id: uid(), name, category: 'Future', currency: cur, pipSize: pip, pipValue: tickVal, contractSize: 1 });

  return [
    // --- Forex majors ---
    fx('EURUSD', 'USD'), fx('GBPUSD', 'USD'), fx('AUDUSD', 'USD'), fx('NZDUSD', 'USD'),
    jpy('USDJPY'), fx('USDCAD', 'USD'), fx('USDCHF', 'USD'),
    // --- Forex minors / cross ---
    fx('EURGBP', 'EUR'), fx('EURAUD', 'EUR'), fx('EURCAD', 'EUR'), fx('EURCHF', 'EUR'), fx('EURNZD', 'EUR'),
    jpy('EURJPY', 'EUR'), jpy('GBPJPY'), jpy('CADJPY'), jpy('CHFJPY'), jpy('AUDJPY'), jpy('NZDJPY'),
    fx('GBPCHF', 'GBP'), fx('GBPAUD', 'GBP'), fx('GBPCAD', 'GBP'), fx('GBPNZD', 'GBP'),
    fx('AUDCAD', 'AUD'), fx('AUDCHF', 'AUD'), fx('AUDNZD', 'AUD'),
    fx('CADCHF', 'CAD'), fx('NZDCAD', 'NZD'), fx('NZDCHF', 'NZD'),
    // --- Forex exotics ---
    fx('USDMXN', 'USD', 0.0001, 5), fx('USDZAR', 'USD', 0.0001, 5), fx('USDTRY', 'USD', 0.0001, 3),
    fx('USDSEK', 'USD', 0.0001, 8), fx('USDNOK', 'USD', 0.0001, 8), fx('EURTRY', 'EUR', 0.0001, 3),
    fx('USDPLN', 'USD', 0.0001, 5), fx('USDHKD', 'USD', 0.0001, 5),
    // --- Metalli ---
    metal('XAUUSD', 0.01, 100), metal('XAGUSD', 0.001, 5000), metal('XPTUSD', 0.01, 50), metal('XPDUSD', 0.01, 100),
    // --- Indici ---
    idx('US100'), idx('US500'), idx('US30'), idx('FRA40', 'EUR'), idx('GER40', 'EUR'), idx('UK100', 'GBP'),
    idx('JPN225', 'JPY'), idx('EU50', 'EUR'), idx('AUS200', 'AUD'), idx('ESP35', 'EUR'),
    // --- Materie prime ---
    commo('USOIL', 0.01, 10), commo('UKOIL', 0.01, 10), commo('NATGAS', 0.001, 10),
    // --- Crypto ---
    crypto('BTCUSD'), crypto('ETHUSD'), crypto('SOLUSD'), crypto('XRPUSD'), crypto('LTCUSD'), crypto('BNBUSD'),
    // --- Future ---
    fut('ES', 0.25, 12.5), fut('NQ', 0.25, 5), fut('YM', 1, 5), fut('RTY', 0.1, 5),
    fut('CL', 0.01, 10), fut('GC', 0.1, 10), fut('6E', 0.0001, 12.5),
  ];
}

function defaultState() {
  return {
    settings: { initialCapital: 10000, currency: 'EUR', beThreshold: 0 },
    instruments: defaultInstruments(),
    trades: [],
    movements: [],
    strategies: [],
    csvMappings: {}, // firma intestazioni -> mappatura colonne scelta l'ultima volta
  };
}

const CHANGELOG = [
  { version: '1.0.0', date: '2026-08-23', notes: ['Prima versione: dashboard, registro, conto, strumenti.'] },
  { version: '1.1.0', date: '2026-08-23', notes: [
    'Aggiunte Strategie con bias, struttura, tolleranze e checklist operativa.',
    'Aggiunto Calcolatore di posizione (position sizing).',
    'Aggiunta vista Posizioni aperte con P&L non realizzato.',
    'Aggiunti flag colorati e link TradingView per trade.',
    'Aggiunto import CSV con mappatura colonne.',
    'Aggiunte analisi per strategia, per giorno della settimana e curva R ultime 50 operazioni.',
    'Aggiunta sezione Note con frase motivazionale e annotazioni libere.'
  ]},
  { version: '1.2.0', date: '2026-08-24', notes: [
    'L\'import CSV ora può leggere anche il capitale iniziale (colonna saldo/balance/capitale) invece di inserirlo solo a mano.'
  ]},
];

let STATE = null;
let CHARTS = {};
let BUBBLE_RAF_ID = null;

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

/* ---------------- formatting helpers ---------------- */

function fmtMoney(v, opts = {}) {
  const cur = (STATE && STATE.settings.currency) || 'EUR';
  if (v === null || v === undefined || isNaN(v)) return '—';
  const sign = v > 0 ? '+' : '';
  const formatted = new Intl.NumberFormat('it-IT', { style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(v));
  return (opts.signed ? (v < 0 ? '-' : (v > 0 ? '+' : '')) : (v < 0 ? '-' : '')) + formatted;
}
function fmtNum(v, dec = 2) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
}
function fmtPct(v, dec = 1) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return fmtNum(v, dec) + '%';
}

// Simbolo della valuta correntemente impostata sul conto (es. "€", "$", "£"),
// ricavato da Intl in base al codice ISO in STATE.settings.currency: funziona
// per qualsiasi valuta supportata dal browser, non solo EUR/USD/GBP, così i
// pulsanti del toggle valuta/percentuale non hanno più l'euro scritto fisso.
function currencySymbol() {
  const cur = (STATE && STATE.settings && STATE.settings.currency) || 'EUR';
  try {
    const parts = new Intl.NumberFormat('it-IT', { style: 'currency', currency: cur, minimumFractionDigits: 0, maximumFractionDigits: 0 }).formatToParts(0);
    const symbolPart = parts.find(p => p.type === 'currency');
    return symbolPart ? symbolPart.value : cur;
  } catch (e) {
    return cur; // codice valuta non riconosciuto da Intl: mostra il codice stesso
  }
}
function updateCurrencySymbols() {
  const sym = currencySymbol();
  document.querySelectorAll('.dm-symbol').forEach(el => { el.textContent = sym; });
}

/* ---------------- modalità di visualizzazione: valuta / percentuale ----------------
   Preferenza puramente visiva (non tocca i dati salvati): vive in localStorage,
   quindi è per browser/dispositivo e vale per tutti i conti. Un'unica leva,
   usata ovunque nell'app (dashboard, registro, posizioni aperte, report PDF,
   share card), così il toggle nella sidebar vale davvero "su tutto".
   ------------------------------------------------------------------------------- */
const DISPLAY_MODE_KEY = 'tj_display_mode';
let DISPLAY_MODE = (localStorage.getItem(DISPLAY_MODE_KEY) === 'percent') ? 'percent' : 'currency';

function pctBase() {
  return (STATE && STATE.settings && STATE.settings.initialCapital) || 0;
}

// Per importi che sono già una VARIAZIONE (P&L di un trade/giorno/mese/
// strumento/strategia, P&L totale, rischio esposto...): in modalità
// percentuale li esprime come % del capitale iniziale del conto.
function fmtMoneyOrPercent(v, opts = {}) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  if (DISPLAY_MODE === 'percent') {
    const base = pctBase();
    if (!base) return fmtMoney(v, opts); // nessun capitale iniziale: niente base per calcolare la %
    const pct = (v / base) * 100;
    const sign = opts.signed ? (pct > 0 ? '+' : (pct < 0 ? '-' : '')) : (pct < 0 ? '-' : '');
    return sign + fmtNum(Math.abs(pct), opts.pctDec !== undefined ? opts.pctDec : 2) + '%';
  }
  return fmtMoney(v, opts);
}

// Per importi che sono un LIVELLO (capitale attuale, equity in un istante,
// non una variazione): in modalità percentuale mostra il rendimento totale
// del conto rispetto al capitale iniziale, cioè quanto quel livello si è
// mosso in percentuale dal punto di partenza.
function fmtLevelOrPercent(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  if (DISPLAY_MODE === 'percent') {
    const base = pctBase();
    if (!base) return fmtMoney(v);
    const pct = ((v - base) / base) * 100;
    return (pct > 0 ? '+' : (pct < 0 ? '-' : '')) + fmtNum(Math.abs(pct), 2) + '%';
  }
  return fmtMoney(v);
}

function updateDisplayModeToggleUI() {
  updateCurrencySymbols();
  document.querySelectorAll('.display-mode-btn[data-mode]').forEach(btn => {
    btn.classList.toggle('btn-primary', btn.dataset.mode === DISPLAY_MODE);
    btn.classList.toggle('btn-ghost', btn.dataset.mode !== DISPLAY_MODE);
  });
}

// Ridisegna solo la vista attualmente visibile (più il capitale in sidebar,
// sempre visibile) invece di richiamare showView(), per evitare di far
// scattare lo scroll-to-top ad ogni click sul toggle.
function refreshCurrentView() {
  if (!STATE) return;
  const renderers = {
    dashboard: renderDashboard,
    registro: renderRegistro,
    conto: renderConto,
    strumenti: renderStrumenti,
    aperte: renderAperte,
    strategie: renderStrategie,
    calcolatore: renderCalcolatore,
  };
  const activeView = document.querySelector('.view.active');
  const name = activeView ? activeView.id.replace('view-', '') : null;
  if (name && renderers[name]) {
    try { renderers[name](); } catch (e) { console.error('[display-mode] refresh vista corrente:', e); }
  }
  const sidebarCap = document.getElementById('sidebar-capital');
  if (sidebarCap) sidebarCap.textContent = fmtLevelOrPercent(currentCapital());

  // se il pannello share card è aperto, ridisegna anche quello
  const shareBackdrop = document.getElementById('share-card-backdrop');
  if (shareBackdrop && shareBackdrop.classList.contains('active') && window.ShareCard && window.ShareCard.render) {
    window.ShareCard.render();
  }
}

function setDisplayMode(mode) {
  DISPLAY_MODE = (mode === 'percent') ? 'percent' : 'currency';
  try { localStorage.setItem(DISPLAY_MODE_KEY, DISPLAY_MODE); } catch (e) { /* ignore */ }
  updateDisplayModeToggleUI();
  refreshCurrentView();
}

document.querySelectorAll('.display-mode-btn[data-mode]').forEach(btn => {
  btn.addEventListener('click', () => setDisplayMode(btn.dataset.mode));
});
updateDisplayModeToggleUI();
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  return dt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtDateShort(d) {
  const dt = new Date(d);
  return dt.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
}
function toDatetimeLocal(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  t.classList.toggle('err', isErr);
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------------- domain calculations ---------------- */

function getInstrument(name) {
  return STATE.instruments.find(i => i.name === name);
}

function calcTradeProfit(t) {
  const instr = getInstrument(t.instrument);
  if (!instr || !t.entryPrice || !t.exitPrice || !t.lots) return null;
  const dirSign = t.direction === 'BUY' ? 1 : -1;
  const priceDiff = (t.exitPrice - t.entryPrice) * dirSign;
  const pips = priceDiff / instr.pipSize;
  const profit = pips * instr.pipValue * t.lots;
  return profit;
}

function calcTradeR(t) {
  const instr = getInstrument(t.instrument);
  if (!instr || !t.entryPrice || !t.slPrice || !t.lots) return null;
  const riskPips = Math.abs(t.entryPrice - t.slPrice) / instr.pipSize;
  const riskAmount = riskPips * instr.pipValue * t.lots;
  if (!riskAmount) return null;
  const profit = (t.profit !== null && t.profit !== undefined) ? t.profit : calcTradeProfit(t);
  if (profit === null) return null;
  return profit / riskAmount;
}

function closedTrades() {
  return STATE.trades.filter(t => t.status === 'CLOSED' && t.closeDate);
}
function openTrades() {
  return STATE.trades.filter(t => t.status === 'OPEN');
}

function outcomeOf(t) {
  const p = t.profit;
  if (p === null || p === undefined) return null;
  const thr = STATE.settings.beThreshold || 0;
  if (Math.abs(p) <= thr) return 'be';
  return p > 0 ? 'win' : 'loss';
}

// chronological list of {date, delta} events (trades + movements)
function buildLedger() {
  const events = [];
  STATE.movements.forEach(m => {
    events.push({ date: new Date(m.date), delta: m.type === 'DEPOSIT' ? m.amount : -m.amount, kind: 'movement' });
  });
  closedTrades().forEach(t => {
    events.push({ date: new Date(t.closeDate), delta: (t.profit || 0), kind: 'trade' });
  });
  events.sort((a, b) => a.date - b.date);
  return events;
}

function buildEquityCurve() {
  const events = buildLedger();
  let running = STATE.settings.initialCapital;
  const points = [{ date: null, label: 'Start', equity: running }];
  events.forEach(e => {
    running += e.delta;
    points.push({ date: e.date, label: fmtDateShort(e.date), equity: running });
  });
  return points;
}

function currentCapital() {
  const pts = buildEquityCurve();
  return pts[pts.length - 1].equity;
}

function totalPL() {
  return closedTrades().reduce((s, t) => s + (t.profit || 0), 0);
}

function winRateStats(trades) {
  const closed = trades.filter(t => t.status === 'CLOSED' && t.profit !== null && t.profit !== undefined);
  const wins = closed.filter(t => outcomeOf(t) === 'win').length;
  const losses = closed.filter(t => outcomeOf(t) === 'loss').length;
  const be = closed.filter(t => outcomeOf(t) === 'be').length;
  const rate = closed.length ? (wins / closed.length) * 100 : null;
  return { total: closed.length, wins, losses, be, rate };
}

function avgR(trades) {
  const rs = trades.map(t => calcTradeR(t)).filter(r => r !== null && isFinite(r));
  if (!rs.length) return null;
  return rs.reduce((a, b) => a + b, 0) / rs.length;
}

function maxDrawdown(groupBy) {
  // groupBy: 'day' | 'month'
  const pts = buildEquityCurve().filter(p => p.date);
  if (!pts.length) return 0;
  const map = new Map();
  pts.forEach(p => {
    const d = p.date;
    const key = groupBy === 'month'
      ? `${d.getFullYear()}-${d.getMonth()}`
      : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    map.set(key, p.equity); // last value of the period wins
  });
  const values = Array.from(map.values());
  values.unshift(STATE.settings.initialCapital);
  let peak = values[0], maxDd = 0;
  values.forEach(v => {
    if (v > peak) peak = v;
    const dd = peak > 0 ? ((peak - v) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  });
  return maxDd;
}

function monthlyPL() {
  const map = new Map();
  closedTrades().forEach(t => {
    const d = new Date(t.closeDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, (map.get(key) || 0) + (t.profit || 0));
  });
  const keys = Array.from(map.keys()).sort();
  return { labels: keys.map(k => {
      const [y, m] = k.split('-');
      return new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'short', year: '2-digit' });
    }), values: keys.map(k => map.get(k)) };
}

function perInstrumentStats() {
  const names = Array.from(new Set(closedTrades().map(t => t.instrument)));
  return names.map(name => {
    const trades = closedTrades().filter(t => t.instrument === name);
    const stats = winRateStats(trades);
    const rendimento = trades.reduce((s, t) => s + (t.profit || 0), 0);
    const rr = avgR(trades);
    return { name, n: trades.length, winRate: stats.rate, stop: stats.losses, profit: stats.wins, be: stats.be, rendimento, rr };
  }).sort((a, b) => b.rendimento - a.rendimento);
}

function checklistCompletionPct(t) {
  if (!t.checklist || !Object.keys(t.checklist).length) return null;
  const vals = Object.values(t.checklist);
  if (!vals.length) return null;
  const done = vals.filter(Boolean).length;
  return (done / vals.length) * 100;
}

function perStrategyStats() {
  const names = Array.from(new Set(closedTrades().map(t => t.strategy).filter(Boolean)));
  return names.map(name => {
    const trades = closedTrades().filter(t => t.strategy === name);
    const stats = winRateStats(trades);
    const rendimento = trades.reduce((s, t) => s + (t.profit || 0), 0);
    const rr = avgR(trades);
    const checklistPcts = trades.map(checklistCompletionPct).filter(v => v !== null);
    const avgChecklist = checklistPcts.length ? checklistPcts.reduce((a, b) => a + b, 0) / checklistPcts.length : null;
    return { name, n: trades.length, winRate: stats.rate, rendimento, rr, avgChecklist };
  }).sort((a, b) => b.rendimento - a.rendimento);
}

function weekdayPL() {
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  const totals = [0, 0, 0, 0, 0, 0, 0];
  closedTrades().forEach(t => {
    const d = new Date(t.closeDate);
    totals[d.getDay()] += (t.profit || 0);
  });
  // reorder Mon..Sun
  const order = [1, 2, 3, 4, 5, 6, 0];
  return { labels: order.map(i => dayNames[i]), values: order.map(i => totals[i]) };
}

function topWinsLosses(n = 6) {
  const trades = closedTrades().filter(t => t.profit !== null && t.profit !== undefined && t.profit !== 0);
  const wins = trades.filter(t => t.profit > 0).sort((a, b) => b.profit - a.profit).slice(0, n);
  const losses = trades.filter(t => t.profit < 0).sort((a, b) => a.profit - b.profit).slice(0, n);
  return { wins, losses };
}

function lastNRValues(n) {
  const trades = closedTrades().slice().sort((a, b) => new Date(a.closeDate) - new Date(b.closeDate));
  const last = trades.slice(-n);
  return last.map((t, idx) => ({ label: String(idx + 1), r: calcTradeR(t) })).filter(x => x.r !== null && isFinite(x.r));
}

/* ---------------- calendario P&L (widget dashboard) ---------------- */

let CAL_VIEW = null; // { year, month } — month 0-11, stato di navigazione del widget

function calendarViewOrNow() {
  if (!CAL_VIEW) {
    const now = new Date();
    CAL_VIEW = { year: now.getFullYear(), month: now.getMonth() };
  }
  return CAL_VIEW;
}

// aggrega P&L e numero di trade per giorno di chiusura ('YYYY-MM-DD' -> {trades, pnl})
function calendarDailyStats() {
  const map = {};
  closedTrades().forEach(t => {
    const d = new Date(t.closeDate);
    if (isNaN(d)) return;
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (!map[key]) map[key] = { trades: 0, pnl: 0 };
    map[key].trades += 1;
    map[key].pnl += (t.profit || 0);
  });
  return map;
}

function calendarChangeMonth(delta) {
  const v = calendarViewOrNow();
  v.month += delta;
  if (v.month < 0) { v.month = 11; v.year -= 1; }
  if (v.month > 11) { v.month = 0; v.year += 1; }
  renderCalendarHeatmap();
}
function calendarChangeYear(delta) {
  const v = calendarViewOrNow();
  v.year += delta;
  renderCalendarHeatmap();
}

const CAL_MONTH_NAMES = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

function renderCalendarHeatmap() {
  const grid = document.getElementById('cal-grid');
  const monthLabel = document.getElementById('cal-month-label');
  const yearLabel = document.getElementById('cal-year-label');
  if (!grid || !monthLabel || !yearLabel) return;

  const { year: y, month: m } = calendarViewOrNow();
  monthLabel.textContent = CAL_MONTH_NAMES[m];
  yearLabel.textContent = String(y);

  const stats = calendarDailyStats();
  const lastOfMonth = new Date(y, m + 1, 0);

  // trova il lunedì di inizio griglia: il lunedì della settimana che contiene il giorno 1
  const gridStart = new Date(y, m, 1);
  while (gridStart.getDay() !== 1) gridStart.setDate(gridStart.getDate() - 1);

  const cells = [];
  const cursor = new Date(gridStart);
  // avanza giorno per giorno (solo Lun-Ven) finché non abbiamo coperto il mese
  // e completato l'ultima riga (multiplo di 5 celle)
  while (cursor <= lastOfMonth || cells.length % 5 !== 0) {
    const dow = cursor.getDay();
    if (dow >= 1 && dow <= 5) {
      const inMonth = cursor.getMonth() === m && cursor.getFullYear() === y;
      const key = cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0') + '-' + String(cursor.getDate()).padStart(2, '0');
      cells.push({ dayNum: cursor.getDate(), outside: !inMonth, data: inMonth ? (stats[key] || null) : null });
    }
    cursor.setDate(cursor.getDate() + 1);
    if (cells.length > 60) break; // valvola di sicurezza anti-loop
  }

  grid.innerHTML = cells.map(c => {
    if (c.outside) {
      return `<div class="cal-day cal-outside"><div class="cal-day-num">${c.dayNum}</div></div>`;
    }
    if (!c.data) {
      return `<div class="cal-day"><div class="cal-day-num">${c.dayNum}</div></div>`;
    }
    const cls = c.data.pnl > 0 ? 'cal-win' : (c.data.pnl < 0 ? 'cal-loss' : '');
    return `
      <div class="cal-day ${cls}">
        <div class="cal-day-num">${c.dayNum}</div>
        <div class="cal-day-info">
          <div class="cal-day-trades">${c.data.trades} trade${c.data.trades === 1 ? '' : 's'}</div>
          <div class="cal-day-pnl">${fmtMoneyOrPercent(c.data.pnl, { signed: true })}</div>
        </div>
      </div>`;
  }).join('');
}

/* ---------------- P&L per orario (widget dashboard, nuovo widget separato) ---------------- */

// aggrega P&L e numero di trade per ora di APERTURA (0-23), su tutto lo storico.
// L'idea è: l'informazione utile è "apro un trade in una certa fascia oraria,
// tendo a fare più profitto?" — quindi il trade va "depositato" nel cassetto
// orario corrispondente all'ingresso (openDate), mentre l'importo del P&L
// resta ovviamente quello noto solo a chiusura (t.profit).
// (a differenza del calendario, qui non c'è un mese da navigare: l'ora si ripete ogni giorno)
function hourlyStats() {
  const map = {};
  for (let h = 0; h < 24; h++) map[h] = { trades: 0, pnl: 0 };
  closedTrades().forEach(t => {
    const d = new Date(t.openDate);
    if (isNaN(d)) return;
    const h = d.getHours();
    map[h].trades += 1;
    map[h].pnl += (t.profit || 0);
  });
  return map;
}

function renderHourlyHeatmap() {
  const grid = document.getElementById('hour-grid');
  if (!grid) return;

  const stats = hourlyStats();
  const cells = [];
  for (let h = 0; h < 24; h++) {
    cells.push({ hour: h, data: stats[h].trades > 0 ? stats[h] : null });
  }

  grid.innerHTML = cells.map(c => {
    const label = String(c.hour).padStart(2, '0') + ':00';
    if (!c.data) {
      return `<div class="hour-cell hour-empty"><div class="hour-cell-num">${label}</div></div>`;
    }
    const cls = c.data.pnl > 0 ? 'hour-win' : (c.data.pnl < 0 ? 'hour-loss' : '');
    return `
      <div class="hour-cell ${cls}">
        <div class="hour-cell-num">${label}</div>
        <div class="hour-cell-info">
          <div class="hour-cell-trades">${c.data.trades} trade${c.data.trades === 1 ? '' : 's'}</div>
          <div class="hour-cell-pnl">${fmtMoneyOrPercent(c.data.pnl, { signed: true })}</div>
        </div>
      </div>`;
  }).join('');
}

function initCalendarWidget() {
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  bind('cal-prev-month', () => calendarChangeMonth(-1));
  bind('cal-next-month', () => calendarChangeMonth(1));
  bind('cal-prev-year', () => calendarChangeYear(-1));
  bind('cal-next-year', () => calendarChangeYear(1));
}
initCalendarWidget();

/* ---------------- rendering: dashboard ---------------- */

// Each render* call below is independent — if one throws (bad data, ad-blocker
// stripping the Chart.js CDN script, etc.) it must NOT stop the rest of the
// dashboard from rendering. Run every piece in isolation and log failures.
function safeRender(name, fn) {
  try {
    fn();
  } catch (e) {
    console.error(`[dashboard] "${name}" ha lanciato un errore, salto e continuo:`, e);
  }
}

function renderDashboard() {
  updateCurrencySymbols();
  const cap = currentCapital();
  const pl = totalPL();
  const stats = winRateStats(closedTrades());
  const rr = avgR(closedTrades());
  const ddDay = maxDrawdown('day');

  document.getElementById('sidebar-capital').textContent = fmtLevelOrPercent(cap);
  document.getElementById('hero-equity-num').textContent = fmtLevelOrPercent(cap);

  const chips = [
    { label: 'Capitale attuale', value: fmtLevelOrPercent(cap), delta: null },
    { label: 'P&L totale', value: fmtMoneyOrPercent(pl, { signed: true }), cls: pl > 0 ? 'up' : (pl < 0 ? 'down' : 'flat') },
    { label: 'Win rate', value: stats.total ? fmtPct(stats.rate) : '—', delta: stats.total ? `${stats.wins}W / ${stats.losses}L / ${stats.be}BE` : 'nessun trade chiuso' },
    { label: 'R:R medio', value: rr !== null ? fmtNum(rr, 2) + 'R' : '—' },
    { label: 'Drawdown max (gg)', value: fmtPct(ddDay), cls: ddDay > 0 ? 'down' : 'flat' },
    { label: 'Trade totali', value: String(STATE.trades.length), delta: `${openTrades().length} aperti` },
  ];
  document.getElementById('dash-stats').innerHTML = chips.map(c => `
    <div class="stat-card">
      <div class="stat-label">${c.label}</div>
      <div class="stat-value ${c.cls || ''}">${c.value}</div>
      ${c.delta ? `<div class="stat-delta flat">${c.delta}</div>` : ''}
    </div>
  `).join('');

  if (typeof Chart === 'undefined') {
    console.error('[dashboard] Chart.js non è disponibile (typeof Chart === "undefined"). ' +
      'Probabile blocco dello script CDN (adblock/Brave Shields/rete offline). I grafici resteranno vuoti, ma tabelle e statistiche funzionano comunque.');
    const warn = document.getElementById('chart-load-warning');
    if (warn) warn.style.display = 'block';
  } else {
    const warn = document.getElementById('chart-load-warning');
    if (warn) warn.style.display = 'none';
    safeRender('renderEquityChart', renderEquityChart);
    safeRender('renderOutcomeChart', () => renderOutcomeChart(stats));
    safeRender('renderMonthlyChart', renderMonthlyChart);
    safeRender('renderDrawdownChart', renderDrawdownChart);
    safeRender('renderWeekdayChart', renderWeekdayChart);
    safeRender('renderR50Chart', renderR50Chart);
  }
  safeRender('renderPerInstrumentTable', renderPerInstrumentTable);
  safeRender('renderPerStrategyTable', renderPerStrategyTable);
  safeRender('renderBubbleChart', renderBubbleChart);
  safeRender('renderCalendarHeatmap', renderCalendarHeatmap);
  safeRender('renderHourlyHeatmap', renderHourlyHeatmap);
}


function renderEquityChart() {
  const pts = buildEquityCurve();
  const labels = pts.map((p, i) => i === 0 ? 'Start' : p.label);
  const data = pts.map(p => p.equity);
  const ctx = document.getElementById('chart-equity').getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 220);
  grad.addColorStop(0, 'rgba(51,196,139,0.32)');
  grad.addColorStop(1, 'rgba(51,196,139,0)');

  if (CHARTS.equity) CHARTS.equity.destroy();
  CHARTS.equity = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ data, borderColor: '#33C48B', backgroundColor: grad, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: true, tension: 0.25 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: '#151B24', borderColor: '#232B37', borderWidth: 1, titleColor: '#8592A3', bodyColor: '#E9EDF3', padding: 10, displayColors: false,
        callbacks: { label: (c) => fmtLevelOrPercent(c.parsed.y) }
      } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#4C5768', maxTicksLimit: 8, font: { family: 'IBM Plex Mono', size: 10 } } },
        y: { grid: { color: '#1A212B' }, ticks: { color: '#4C5768', font: { family: 'IBM Plex Mono', size: 10 }, callback: v => fmtLevelOrPercent(v) } }
      },
      interaction: { intersect: false, mode: 'index' }
    }
  });
}

function renderOutcomeChart(stats) {
  const ctx = document.getElementById('chart-outcome').getContext('2d');
  if (CHARTS.outcome) CHARTS.outcome.destroy();
  const data = [stats.wins, stats.losses, stats.be];
  const hasData = stats.total > 0;
  CHARTS.outcome = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: ['Profit', 'Stop', 'BE'], datasets: [{ data: hasData ? data : [1], backgroundColor: hasData ? ['#33C48B', '#F14D68', '#4C5768'] : ['#191F2A'], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false }, tooltip: { enabled: hasData } } }
  });
  const legend = document.getElementById('outcome-legend');
  const rows = [
    ['Profit', stats.wins, '#33C48B'], ['Stop', stats.losses, '#F14D68'], ['Break-even', stats.be, '#4C5768']
  ];
  legend.innerHTML = rows.map(([label, val, color]) => `
    <div style="display:flex; align-items:center; justify-content:space-between; font-size:12.5px;">
      <span style="display:flex; align-items:center; gap:8px; color:var(--text-dim);">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;"></span>${label}
      </span>
      <span class="mono" style="font-weight:600;">${val}</span>
    </div>`).join('');
}

function renderMonthlyChart() {
  const { labels, values } = monthlyPL();
  const ctx = document.getElementById('chart-monthly').getContext('2d');
  if (CHARTS.monthly) CHARTS.monthly.destroy();
  CHARTS.monthly = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: values.map(v => v >= 0 ? 'rgba(51,196,139,0.75)' : 'rgba(241,77,104,0.75)'), borderRadius: 4, maxBarThickness: 26 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#151B24', borderColor: '#232B37', borderWidth: 1, titleColor: '#8592A3', bodyColor: '#E9EDF3', padding: 10, displayColors: false, callbacks: { label: c => fmtMoneyOrPercent(c.parsed.y, { signed: true }) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#4C5768', font: { family: 'IBM Plex Mono', size: 10 } } },
        y: { grid: { color: '#1A212B' }, ticks: { color: '#4C5768', font: { family: 'IBM Plex Mono', size: 10 }, callback: v => fmtMoneyOrPercent(v) } }
      }
    }
  });
}

function renderDrawdownChart() {
  const pts = buildEquityCurve().filter(p => p.date);
  let peak = STATE.settings.initialCapital;
  const dd = pts.map(p => {
    if (p.equity > peak) peak = p.equity;
    return peak > 0 ? -((peak - p.equity) / peak) * 100 : 0;
  });
  const labels = pts.map(p => p.label);
  const ctx = document.getElementById('chart-drawdown').getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 220);
  grad.addColorStop(0, 'rgba(241,77,104,0)');
  grad.addColorStop(1, 'rgba(241,77,104,0.28)');
  if (CHARTS.drawdown) CHARTS.drawdown.destroy();
  CHARTS.drawdown = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ data: dd, borderColor: '#F14D68', backgroundColor: grad, borderWidth: 1.5, pointRadius: 0, fill: true, tension: 0.15 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#151B24', borderColor: '#232B37', borderWidth: 1, titleColor: '#8592A3', bodyColor: '#E9EDF3', padding: 10, displayColors: false, callbacks: { label: c => fmtPct(c.parsed.y) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#4C5768', maxTicksLimit: 8, font: { family: 'IBM Plex Mono', size: 10 } } },
        y: { grid: { color: '#1A212B' }, ticks: { color: '#4C5768', font: { family: 'IBM Plex Mono', size: 10 }, callback: v => v + '%' } }
      }
    }
  });
}

function renderPerInstrumentTable() {
  const rows = perInstrumentStats();
  const tbody = document.getElementById('tbl-per-instrument');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="txt" style="text-align:center; color:var(--text-faint); padding:24px;">Nessuna operazione chiusa ancora</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td class="txt" style="font-weight:600;">${r.name}</td>
      <td>${r.n}</td>
      <td>${r.winRate !== null ? fmtPct(r.winRate) : '—'}</td>
      <td class="p-neg">${r.stop}</td>
      <td class="p-pos">${r.profit}</td>
      <td>${r.be}</td>
      <td class="${r.rendimento > 0 ? 'p-pos' : (r.rendimento < 0 ? 'p-neg' : 'p-zero')}">${fmtMoneyOrPercent(r.rendimento, { signed: true })}</td>
      <td>${r.rr !== null ? fmtNum(r.rr, 2) + 'R' : '—'}</td>
    </tr>
  `).join('');
}

function renderPerStrategyTable() {
  const rows = perStrategyStats();
  const tbody = document.getElementById('tbl-per-strategy');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="txt" style="text-align:center; color:var(--text-faint); padding:24px;">Nessuna operazione chiusa collegata a una strategia</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td class="txt" style="font-weight:600;">${r.name}</td>
      <td>${r.n}</td>
      <td>${r.winRate !== null ? fmtPct(r.winRate) : '—'}</td>
      <td class="${r.rendimento > 0 ? 'p-pos' : (r.rendimento < 0 ? 'p-neg' : 'p-zero')}">${fmtMoneyOrPercent(r.rendimento, { signed: true })}</td>
      <td>${r.rr !== null ? fmtNum(r.rr, 2) + 'R' : '—'}</td>
      <td>${r.avgChecklist !== null ? fmtPct(r.avgChecklist, 0) : '—'}</td>
    </tr>
  `).join('');
}

function renderWeekdayChart() {
  const { labels, values } = weekdayPL();
  const ctx = document.getElementById('chart-weekday').getContext('2d');
  if (CHARTS.weekday) CHARTS.weekday.destroy();
  CHARTS.weekday = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: values.map(v => v >= 0 ? 'rgba(51,196,139,0.75)' : 'rgba(241,77,104,0.75)'), borderRadius: 4, maxBarThickness: 30 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#151B24', borderColor: '#232B37', borderWidth: 1, titleColor: '#8592A3', bodyColor: '#E9EDF3', padding: 10, displayColors: false, callbacks: { label: c => fmtMoneyOrPercent(c.parsed.y, { signed: true }) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#4C5768', font: { family: 'IBM Plex Mono', size: 10 } } },
        y: { grid: { color: '#1A212B' }, ticks: { color: '#4C5768', font: { family: 'IBM Plex Mono', size: 10 }, callback: v => fmtMoneyOrPercent(v) } }
      }
    }
  });
}

function renderR50Chart() {
  const pts = lastNRValues(50);
  const labels = pts.map(p => p.label);
  const values = pts.map(p => p.r);
  const ctx = document.getElementById('chart-r50').getContext('2d');
  if (CHARTS.r50) CHARTS.r50.destroy();
  CHARTS.r50 = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: values.map(v => v >= 0 ? 'rgba(51,196,139,0.75)' : 'rgba(241,77,104,0.75)'), borderRadius: 3, maxBarThickness: 14 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#151B24', borderColor: '#232B37', borderWidth: 1, titleColor: '#8592A3', bodyColor: '#E9EDF3', padding: 10, displayColors: false, callbacks: { label: c => fmtNum(c.parsed.y, 2) + 'R' } } },
      scales: {
        x: { grid: { display: false }, ticks: { display: false } },
        y: { grid: { color: '#1A212B' }, ticks: { color: '#4C5768', font: { family: 'IBM Plex Mono', size: 10 }, callback: v => v + 'R' } }
      }
    }
  });
}

/* ---------------- rendering: bubble chart top vincite/perdite ---------------- */

function renderBubbleChart() {
  const stage = document.getElementById('bubble-stage');
  if (!stage) return;

  if (BUBBLE_RAF_ID) { cancelAnimationFrame(BUBBLE_RAF_ID); BUBBLE_RAF_ID = null; }

  // Usiamo lo stesso breakpoint mobile del resto dell'app (760px, vedi
  // mobile-nav.js e i media query in index.html) invece di una soglia
  // basata sulla sola larghezza dello stage: su molti telefoni lo stage
  // resta comunque sopra i 400-450px (è largo quanto la card, non quanto
  // lo schermo), quindi una soglia troppo stretta non scattava mai e le
  // bolle restavano 12 anche su mobile.
  const isMobile = window.matchMedia('(max-width:760px)').matches;
  const topN = isMobile ? 3 : 6;
  const { wins, losses } = topWinsLosses(topN);
  const items = [
    ...wins.map(t => ({ t, kind: 'win' })),
    ...losses.map(t => ({ t, kind: 'loss' })),
  ];

  stage.innerHTML = '';
  stage.classList.remove('empty');

  if (!items.length) {
    stage.classList.add('empty');
    stage.innerHTML = `
      <div class="empty-state" style="padding:0;">
        <div class="et">Nessuna operazione chiusa ancora</div>
        <div class="es">Le vincite e le perdite più grandi appariranno qui.</div>
      </div>`;
    return;
  }

  const W = stage.clientWidth || 600;
  const H = stage.clientHeight || 380;
  const maxAbs = Math.max(...items.map(i => Math.abs(i.t.profit)));
  // Su mobile i raggi partono e arrivano più piccoli a prescindere da
  // quanto sia larga in pixel la card, non solo in proporzione a W: con
  // sole 6 bolle invece di 12 c'è già più spazio, ma le teniamo comunque
  // compatte per lasciare margine alla fisica di separazione.
  const MIN_R = isMobile
    ? Math.max(20, Math.min(30, W / 13))
    : Math.max(24, Math.min(40, W / 11));
  const MAX_R = isMobile
    ? Math.max(MIN_R + 8, Math.min(70, H / 2 - 12, W / 5.5))
    : Math.max(MIN_R + 10, Math.min(115, H / 2 - 12, W / 4.3));

  // stato fisico di ogni bolla: posizione, raggio, velocità di deriva
  const bubbles = items.map(i => {
    const ratio = maxAbs ? Math.sqrt(Math.abs(i.t.profit) / maxAbs) : 1;
    const r = MIN_R + ratio * (MAX_R - MIN_R);
    const speed = 0.35 + Math.random() * 0.35; // deriva lenta, non frenetica
    const angle = Math.random() * Math.PI * 2;
    return {
      t: i.t, kind: i.kind, r,
      x: r + Math.random() * Math.max(1, W - 2 * r),
      y: r + Math.random() * Math.max(1, H - 2 * r),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      dragging: false,
      el: null,
    };
  });

  // separazione iniziale, per non far partire due bolle sovrapposte
  for (let iter = 0; iter < 220; iter++) {
    resolveBubbleCollisions(bubbles, W, H, { separateOnly: true });
  }

  bubbles.forEach(b => {
    const el = document.createElement('div');
    el.className = `bubble ${b.kind}`;
    const d = b.r * 2;
    el.style.width = d + 'px';
    el.style.height = d + 'px';
    el.style.left = (b.x - b.r) + 'px';
    el.style.top = (b.y - b.r) + 'px';

    const fontPair = Math.max(11, Math.min(15, b.r / 5.5));
    const fontAmt = Math.max(11, Math.min(18, b.r / 4.4));
    el.innerHTML = `
      <div class="bubble-pair" style="font-size:${fontPair}px;">${b.t.instrument}</div>
      <div class="bubble-amount" style="font-size:${fontAmt}px;">${fmtMoneyOrPercent(b.t.profit, { signed: true })}</div>
    `;

    b.el = el;
    makeBubbleDraggable(b, stage);
    stage.appendChild(el);
  });

  startBubblePhysics(stage, bubbles);
}

// risolve le collisioni bolla-bolla (separazione + scambio elastico di velocità)
// e il rimbalzo sui bordi dello stage. Le bolle trascinate dal mouse spingono
// le altre ma non vengono a loro volta spostate dalla fisica.
const BUBBLE_MAX_SPEED = 2.6;       // limite di velocità "di deriva" (px/frame)
const BUBBLE_DRAG_PUSH = 1.1;       // spinta gentile impressa quando trascini una bolla contro un'altra
const BUBBLE_RESTITUTION = 0.85;    // smorzamento negli urti normali, per evitare accumuli di energia

function resolveBubbleCollisions(bubbles, W, H, opts = {}) {
  for (let a = 0; a < bubbles.length; a++) {
    for (let b = a + 1; b < bubbles.length; b++) {
      const A = bubbles[a], B = bubbles[b];
      const dx = B.x - A.x, dy = B.y - A.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const minDist = A.r + B.r;
      if (dist < minDist) {
        const overlap = (minDist - dist) / 2;
        const ux = dx / dist, uy = dy / dist;
        if (!A.dragging) { A.x -= ux * overlap; A.y -= uy * overlap; }
        if (!B.dragging) { B.x += ux * overlap; B.y += uy * overlap; }

        if (!opts.separateOnly) {
          if (A.dragging || B.dragging) {
            // una delle due è "in mano": spinta costante e contenuta, indipendente
            // dalla velocità del mouse (che può essere molto più alta e frenetica)
            if (!A.dragging) { A.vx -= ux * BUBBLE_DRAG_PUSH; A.vy -= uy * BUBBLE_DRAG_PUSH; }
            if (!B.dragging) { B.vx += ux * BUBBLE_DRAG_PUSH; B.vy += uy * BUBBLE_DRAG_PUSH; }
          } else {
            // scontro elastico smorzato lungo la normale, massa ~ area (r^2)
            const mA = A.r * A.r, mB = B.r * B.r;
            const va = A.vx * ux + A.vy * uy;
            const vb = B.vx * ux + B.vy * uy;
            const newVa = (va * (mA - mB) + 2 * mB * vb) / (mA + mB);
            const newVb = (vb * (mB - mA) + 2 * mA * va) / (mA + mB);
            A.vx += (newVa - va) * ux * BUBBLE_RESTITUTION;
            A.vy += (newVa - va) * uy * BUBBLE_RESTITUTION;
            B.vx += (newVb - vb) * ux * BUBBLE_RESTITUTION;
            B.vy += (newVb - vb) * uy * BUBBLE_RESTITUTION;
          }
        }
      }
    }
  }
  bubbles.forEach(b => {
    if (b.dragging) return;
    if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx); }
    if (b.x + b.r > W) { b.x = W - b.r; b.vx = -Math.abs(b.vx); }
    if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy); }
    if (b.y + b.r > H) { b.y = H - b.r; b.vy = -Math.abs(b.vy); }

    // limite di velocità: evita che gli urti ripetuti accumulino energia
    // e mandino le bolle in giro come impazzite
    const speed = Math.hypot(b.vx, b.vy);
    if (speed > BUBBLE_MAX_SPEED) {
      b.vx = (b.vx / speed) * BUBBLE_MAX_SPEED;
      b.vy = (b.vy / speed) * BUBBLE_MAX_SPEED;
    }
  });
}

function startBubblePhysics(stage, bubbles) {
  function tick() {
    // lo stage può essere cambiato view/rimosso: fermati se non è più in pagina
    if (!document.body.contains(stage)) { BUBBLE_RAF_ID = null; return; }

    const W = stage.clientWidth || 600;
    const H = stage.clientHeight || 380;

    bubbles.forEach(b => {
      if (b.dragging) return;
      b.x += b.vx;
      b.y += b.vy;
    });

    resolveBubbleCollisions(bubbles, W, H);

    bubbles.forEach(b => {
      b.el.style.left = (b.x - b.r) + 'px';
      b.el.style.top = (b.y - b.r) + 'px';
    });

    BUBBLE_RAF_ID = requestAnimationFrame(tick);
  }
  BUBBLE_RAF_ID = requestAnimationFrame(tick);
}

function makeBubbleDraggable(bubble, container) {
  const el = bubble.el;
  let offX = 0, offY = 0;
  let lastX = 0, lastY = 0, lastT = 0;

  el.addEventListener('pointerdown', (e) => {
    bubble.dragging = true;
    bubble.vx = 0; bubble.vy = 0;
    el.classList.add('dragging');
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    const rect = el.getBoundingClientRect();
    offX = e.clientX - rect.left - bubble.r;
    offY = e.clientY - rect.top - bubble.r;
    lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
    e.preventDefault();
  });

  el.addEventListener('pointermove', (e) => {
    if (!bubble.dragging) return;
    const cRect = container.getBoundingClientRect();
    bubble.x = e.clientX - cRect.left - offX;
    bubble.y = e.clientY - cRect.top - offY;

    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    // velocità "di lancio": derivata dal movimento del mouse, usata al rilascio
    bubble.vx = (e.clientX - lastX) / dt * 8;
    bubble.vy = (e.clientY - lastY) / dt * 8;
    lastX = e.clientX; lastY = e.clientY; lastT = now;
  });

  const stopDrag = (e) => {
    if (!bubble.dragging) return;
    bubble.dragging = false;
    el.classList.remove('dragging');
    // limita la velocità di lancio per non farla schizzare via troppo forte
    const maxV = BUBBLE_MAX_SPEED * 1.4;
    bubble.vx = Math.max(-maxV, Math.min(maxV, bubble.vx));
    bubble.vy = Math.max(-maxV, Math.min(maxV, bubble.vy));
    try { el.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  };
  el.addEventListener('pointerup', stopDrag);
  el.addEventListener('pointercancel', stopDrag);
}

/* ---------------- rendering: registro ---------------- */

function populateInstrumentSelects() {
  const opts = STATE.instruments.map(i => `<option value="${i.name}">${i.name}</option>`).join('');
  document.getElementById('f-instrument').innerHTML = opts;
  document.getElementById('filter-instrument').innerHTML = `<option value="">Tutti gli strumenti</option>` + opts;
  document.getElementById('c-instrument').innerHTML = opts;
}

function populateStrategyDatalist() {
  document.getElementById('strategy-list').innerHTML = STATE.strategies.map(s => `<option value="${s.name}">`).join('');
  document.getElementById('filter-strategy').innerHTML = `<option value="">Tutte le strategie</option>` +
    STATE.strategies.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
}

function getFilteredTrades() {
  const search = document.getElementById('filter-search').value.trim().toLowerCase();
  const instr = document.getElementById('filter-instrument').value;
  const status = document.getElementById('filter-status').value;
  const outcome = document.getElementById('filter-outcome').value;
  const strategy = document.getElementById('filter-strategy').value;
  return STATE.trades
    .slice()
    .sort((a, b) => new Date(b.openDate || 0) - new Date(a.openDate || 0))
    .filter(t => {
      if (instr && t.instrument !== instr) return false;
      if (status && t.status !== status) return false;
      if (outcome && outcomeOf(t) !== outcome) return false;
      if (strategy && t.strategy !== strategy) return false;
      if (search) {
        const hay = `${t.instrument} ${t.notes || ''} ${t.strategy || ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
}

function renderRegistro() {
  const trades = getFilteredTrades();
  document.getElementById('registro-count').textContent = `${STATE.trades.length} operazion${STATE.trades.length === 1 ? 'e' : 'i'}`;
  const tbody = document.getElementById('tbl-registro');
  const empty = document.getElementById('registro-empty');
  if (!trades.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  tbody.innerHTML = trades.map(t => {
    const r = calcTradeR(t);
    const outcome = outcomeOf(t);
    const plCls = t.profit > 0 ? 'p-pos' : (t.profit < 0 ? 'p-neg' : 'p-zero');
    return `
    <tr>
      <td>${t.flag ? `<span class="flag-dot flag-${t.flag}" title="${t.flag}"></span>` : ''}</td>
      <td>${fmtDate(t.openDate)}</td>
      <td class="txt" style="font-weight:600;">${t.instrument}</td>
      <td><span class="pill ${t.direction === 'BUY' ? 'pill-buy' : 'pill-sell'}">${t.direction}</span></td>
      <td>${fmtNum(t.lots, 2)}</td>
      <td>${t.entryPrice ?? '—'}</td>
      <td>${t.exitPrice ?? '—'}</td>
      <td>${t.slPrice ?? '—'}</td>
      <td>${t.tpPrice ?? '—'}</td>
      <td>${r !== null ? fmtNum(r, 2) + 'R' : '—'}</td>
      <td class="${plCls}">${t.profit !== null && t.profit !== undefined ? fmtMoneyOrPercent(t.profit, { signed: true }) : '—'}</td>
      <td><span class="pill ${t.status === 'OPEN' ? 'pill-open' : 'pill-closed'}">${t.status === 'OPEN' ? 'Aperta' : 'Chiusa'}</span></td>
      <td class="txt">${t.strategy || '—'}</td>
      <td>
        <div class="row-actions">
          ${t.link1 ? `<a class="icon-btn" href="${t.link1}" target="_blank" title="Apri link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3h7v7M21 3l-9 9M5 5h6M5 5v14h14v-6"/></svg></a>` : ''}
          <button class="icon-btn" title="Modifica" onclick="editTrade('${t.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="icon-btn" title="Elimina" onclick="confirmDeleteTrade('${t.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* ---------------- rendering: conto ---------------- */

function renderConto() {
  document.getElementById('f-initial-capital').value = STATE.settings.initialCapital;
  document.getElementById('f-currency').value = STATE.settings.currency;
  const deposits = STATE.movements.filter(m => m.type === 'DEPOSIT').reduce((s, m) => s + m.amount, 0);
  const withdrawals = STATE.movements.filter(m => m.type === 'WITHDRAW').reduce((s, m) => s + m.amount, 0);
  document.getElementById('conto-deposits').textContent = fmtMoney(deposits);
  document.getElementById('conto-withdrawals').textContent = fmtMoney(withdrawals);

  const tbody = document.getElementById('tbl-movements');
  const empty = document.getElementById('movements-empty');
  const rows = STATE.movements.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!rows.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  tbody.innerHTML = rows.map(m => `
    <tr>
      <td>${fmtDate(m.date)}</td>
      <td><span class="pill ${m.type === 'DEPOSIT' ? 'pill-buy' : 'pill-sell'}">${m.type === 'DEPOSIT' ? 'Deposito' : 'Prelievo'}</span></td>
      <td class="${m.type === 'DEPOSIT' ? 'p-pos' : 'p-neg'}">${fmtMoney(m.amount)}</td>
      <td class="txt">${m.note || '—'}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" title="Elimina" onclick="confirmDeleteMovement('${m.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

/* ---------------- rendering: posizioni aperte ---------------- */

function calcUnrealized(t) {
  const instr = getInstrument(t.instrument);
  if (!instr || !t.entryPrice || !t.currentPrice || !t.lots) return null;
  const dirSign = t.direction === 'BUY' ? 1 : -1;
  const priceDiff = (t.currentPrice - t.entryPrice) * dirSign;
  const pips = priceDiff / instr.pipSize;
  return pips * instr.pipValue * t.lots;
}

function daysOpen(t) {
  if (!t.openDate) return '—';
  const d = Math.floor((Date.now() - new Date(t.openDate).getTime()) / 86400000);
  return d < 0 ? 0 : d;
}

function renderAperte() {
  const open = STATE.trades.filter(t => t.status === 'OPEN');
  document.getElementById('aperte-count').textContent = `${open.length} posizion${open.length === 1 ? 'e' : 'i'} aperte`;
  document.getElementById('badge-open').textContent = String(open.length);

  const totalUnrealized = open.reduce((s, t) => s + (calcUnrealized(t) || 0), 0);
  const totalRisk = open.reduce((s, t) => {
    const r = calcTradeR({ ...t, profit: null });
    const instr = getInstrument(t.instrument);
    if (!instr || !t.slPrice || !t.entryPrice || !t.lots) return s;
    const riskPips = Math.abs(t.entryPrice - t.slPrice) / instr.pipSize;
    return s + riskPips * instr.pipValue * t.lots;
  }, 0);
  document.getElementById('aperte-stats').innerHTML = [
    { label: 'Posizioni aperte', value: String(open.length) },
    { label: 'P&L non realizzato', value: fmtMoneyOrPercent(totalUnrealized, { signed: true }), cls: totalUnrealized > 0 ? 'up' : (totalUnrealized < 0 ? 'down' : 'flat') },
    { label: 'Rischio totale esposto', value: fmtMoneyOrPercent(totalRisk) },
  ].map(c => `
    <div class="stat-card">
      <div class="stat-label">${c.label}</div>
      <div class="stat-value ${c.cls || ''}">${c.value}</div>
    </div>
  `).join('');

  const tbody = document.getElementById('tbl-aperte');
  const empty = document.getElementById('aperte-empty');
  if (!open.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  tbody.innerHTML = open.map(t => {
    const unreal = calcUnrealized(t);
    const cls = unreal > 0 ? 'p-pos' : (unreal < 0 ? 'p-neg' : 'p-zero');
    return `
    <tr>
      <td>${t.flag ? `<span class="flag-dot flag-${t.flag}" title="${t.flag}"></span>` : ''}</td>
      <td>${fmtDate(t.openDate)}</td>
      <td class="txt" style="font-weight:600;">${t.instrument}</td>
      <td><span class="pill ${t.direction === 'BUY' ? 'pill-buy' : 'pill-sell'}">${t.direction}</span></td>
      <td>${fmtNum(t.lots, 2)}</td>
      <td>${t.entryPrice ?? '—'}</td>
      <td>${t.currentPrice ?? '—'}</td>
      <td>${t.slPrice ?? '—'}</td>
      <td>${t.tpPrice ?? '—'}</td>
      <td>${daysOpen(t)}</td>
      <td class="${cls}">${unreal !== null ? fmtMoneyOrPercent(unreal, { signed: true }) : '—'}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" title="Modifica" onclick="editTrade('${t.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="icon-btn" title="Chiudi posizione" onclick="quickCloseTrade('${t.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

window.quickCloseTrade = function (id) {
  const t = STATE.trades.find(x => x.id === id);
  if (!t) return;
  openModal(`
    <h3>Chiudi posizione — ${t.instrument}</h3>
    <p>Inserisci il prezzo e la data di chiusura per calcolare il risultato finale.</p>
    <div style="display:flex; flex-direction:column; gap:12px;">
      <div class="field"><label>Prezzo di chiusura</label><input type="number" step="any" id="modal-close-price" value="${t.currentPrice ?? ''}"></div>
      <div class="field"><label>Data di chiusura</label><input type="datetime-local" id="modal-close-date" value="${toDatetimeLocal(new Date())}"></div>
    </div>
    <div class="modal-actions" style="margin-top:18px;">
      <button class="btn btn-ghost" onclick="closeModal()">Annulla</button>
      <button class="btn btn-primary" id="confirm-close-trade">Chiudi trade</button>
    </div>
  `);
  document.getElementById('confirm-close-trade').onclick = async () => {
    const price = parseFloat(document.getElementById('modal-close-price').value);
    if (!price) { toast('Inserisci un prezzo valido', true); return; }
    t.exitPrice = price;
    t.closeDate = new Date(document.getElementById('modal-close-date').value).toISOString();
    t.status = 'CLOSED';
    t.profit = calcTradeProfit(t);
    await Storage.save(STATE);
    closeModal();
    renderAperte();
    toast('Posizione chiusa');
  };
};

/* ---------------- rendering: strategie ---------------- */

function renderStrategie() {
  const list = document.getElementById('strategie-list');
  const empty = document.getElementById('strategie-empty');
  if (!STATE.strategies.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = STATE.strategies.map(s => `
    <div class="strategy-card">
      <div class="strategy-card-head">
        <div class="strategy-name">${s.name}</div>
        <div class="row-actions" style="opacity:1;">
          <button class="icon-btn" title="Modifica" onclick="editStrategy('${s.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="icon-btn" title="Elimina" onclick="confirmDeleteStrategy('${s.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
          </button>
        </div>
      </div>
      ${s.description ? `<div class="strategy-desc">${s.description}</div>` : ''}
      <div class="tag-row">
        ${s.bias ? `<span class="tag">Bias: ${s.bias}</span>` : ''}
        ${s.struttura ? `<span class="tag">Struttura: ${s.struttura}</span>` : ''}
        ${(s.riskPctFrom || s.riskPctTo) ? `<span class="tag">Rischio: ${s.riskPctFrom ?? '?'}–${s.riskPctTo ?? '?'}%</span>` : ''}
        ${(s.rrFrom || s.rrTo) ? `<span class="tag">R:R: ${s.rrFrom ?? '?'}–${s.rrTo ?? '?'}</span>` : ''}
        ${(s.hoursFrom || s.hoursTo) ? `<span class="tag">Orario: ${s.hoursFrom ?? '?'}–${s.hoursTo ?? '?'}</span>` : ''}
      </div>
      ${(s.checklist && s.checklist.length) ? `
        <div class="checklist-mini">
          ${s.checklist.map((c, idx) => `<div class="checklist-mini-item"><span class="n">${idx + 1}.</span>${c}</div>`).join('')}
        </div>` : ''}
    </div>
  `).join('');
}

function strategyModalHtml(existing) {
  const s = existing || { name: '', description: '', bias: '', struttura: '', riskPctFrom: '', riskPctTo: '', rrFrom: '', rrTo: '', hoursFrom: '', hoursTo: '', checklist: ['', '', '', '', '', '', ''], presetNotes: '' };
  const checklist = (s.checklist && s.checklist.length ? s.checklist : ['', '', '', '', '', '', '']);
  return `
    <h3 style="margin-bottom:14px;">${existing ? 'Modifica strategia' : 'Nuova strategia'}</h3>
    <div style="display:flex; flex-direction:column; gap:12px; max-height:65vh; overflow-y:auto; padding-right:4px;">
      <div class="field"><label>Nome</label><input type="text" id="modal-s-name" value="${s.name}"></div>
      <div class="field"><label>Descrizione</label><textarea id="modal-s-desc" rows="2">${s.description || ''}</textarea></div>
      <div class="form-grid-2" style="gap:12px;">
        <div class="field"><label>Bias</label><input type="text" id="modal-s-bias" value="${s.bias || ''}" placeholder="es. Trend following"></div>
        <div class="field"><label>Struttura</label><input type="text" id="modal-s-struttura" value="${s.struttura || ''}" placeholder="es. Rottura + retest"></div>
      </div>
      <div class="form-grid-2" style="gap:12px;">
        <div class="field"><label>% rischio da</label><input type="number" step="0.01" id="modal-s-riskfrom" value="${s.riskPctFrom ?? ''}"></div>
        <div class="field"><label>% rischio a</label><input type="number" step="0.01" id="modal-s-riskto" value="${s.riskPctTo ?? ''}"></div>
      </div>
      <div class="form-grid-2" style="gap:12px;">
        <div class="field"><label>R:R minimo</label><input type="number" step="0.1" id="modal-s-rrfrom" value="${s.rrFrom ?? ''}"></div>
        <div class="field"><label>R:R massimo</label><input type="number" step="0.1" id="modal-s-rrto" value="${s.rrTo ?? ''}"></div>
      </div>
      <div class="form-grid-2" style="gap:12px;">
        <div class="field"><label>Orario da</label><input type="time" id="modal-s-hoursfrom" value="${s.hoursFrom || ''}"></div>
        <div class="field"><label>Orario a</label><input type="time" id="modal-s-hoursto" value="${s.hoursTo || ''}"></div>
      </div>
      <div class="field">
        <label>Checklist operativa (fino a 7 voci)</label>
        <div style="display:flex; flex-direction:column; gap:6px;">
          ${checklist.map((c, idx) => `<input type="text" class="modal-s-check" data-idx="${idx}" value="${c}" placeholder="Punto checklist ${idx + 1}">`).join('')}
        </div>
      </div>
      <div class="field"><label>Note preimpostate</label><textarea id="modal-s-notes" rows="2">${s.presetNotes || ''}</textarea></div>
    </div>
    <div class="modal-actions" style="margin-top:18px;">
      <button class="btn btn-ghost" onclick="closeModal()">Annulla</button>
      <button class="btn btn-primary" id="confirm-save-strategy">Salva strategia</button>
    </div>
  `;
}

function readStrategyModal() {
  return {
    name: document.getElementById('modal-s-name').value.trim(),
    description: document.getElementById('modal-s-desc').value.trim(),
    bias: document.getElementById('modal-s-bias').value.trim(),
    struttura: document.getElementById('modal-s-struttura').value.trim(),
    riskPctFrom: parseFloat(document.getElementById('modal-s-riskfrom').value) || null,
    riskPctTo: parseFloat(document.getElementById('modal-s-riskto').value) || null,
    rrFrom: parseFloat(document.getElementById('modal-s-rrfrom').value) || null,
    rrTo: parseFloat(document.getElementById('modal-s-rrto').value) || null,
    hoursFrom: document.getElementById('modal-s-hoursfrom').value || '',
    hoursTo: document.getElementById('modal-s-hoursto').value || '',
    checklist: Array.from(document.querySelectorAll('.modal-s-check')).map(el => el.value.trim()).filter(Boolean),
    presetNotes: document.getElementById('modal-s-notes').value.trim(),
  };
}

document.getElementById('btn-add-strategy').addEventListener('click', () => {
  openModal(strategyModalHtml(null));
  document.getElementById('confirm-save-strategy').onclick = async () => {
    const data = readStrategyModal();
    if (!data.name) { toast('Inserisci un nome per la strategia', true); return; }
    STATE.strategies.push({ id: uid(), ...data });
    await Storage.save(STATE);
    closeModal();
    renderStrategie();
    populateStrategyDatalist();
    toast('Strategia creata');
  };
});

window.editStrategy = function (id) {
  const s = STATE.strategies.find(x => x.id === id);
  if (!s) return;
  openModal(strategyModalHtml(s));
  document.getElementById('confirm-save-strategy').onclick = async () => {
    const data = readStrategyModal();
    if (!data.name) { toast('Inserisci un nome per la strategia', true); return; }
    Object.assign(s, data);
    await Storage.save(STATE);
    closeModal();
    renderStrategie();
    populateStrategyDatalist();
    toast('Strategia aggiornata');
  };
};

window.confirmDeleteStrategy = function (id) {
  openModal(`
    <h3>Eliminare la strategia?</h3>
    <p>I trade collegati manterranno il nome come testo libero ma perderanno il riferimento alla checklist.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Annulla</button>
      <button class="btn btn-danger" id="confirm-del-strategy">Elimina</button>
    </div>
  `);
  document.getElementById('confirm-del-strategy').onclick = async () => {
    STATE.strategies = STATE.strategies.filter(s => s.id !== id);
    await Storage.save(STATE);
    closeModal();
    renderStrategie();
    populateStrategyDatalist();
    toast('Strategia eliminata');
  };
};

/* ---------------- rendering: calcolatore ---------------- */

function renderCalcolatore() {
  document.getElementById('c-capital').value = currentCapital().toFixed(2);
  computeCalculator();
}

function computeCalculator() {
  const name = document.getElementById('c-instrument').value;
  const instr = getInstrument(name);
  const direction = document.getElementById('c-seg-direction').dataset.value || 'BUY';
  const capital = parseFloat(document.getElementById('c-capital').value) || 0;
  const riskPct = parseFloat(document.getElementById('c-risk-pct').value) || 0;
  const entry = parseFloat(document.getElementById('c-entry').value);
  const sl = parseFloat(document.getElementById('c-sl').value);
  const tp = parseFloat(document.getElementById('c-tp').value);

  const out = { lots: null, units: null, risk: null, slPips: null, tpProfit: null, rr: null };

  if (instr && entry && sl && capital && riskPct) {
    const riskAmount = capital * (riskPct / 100);
    const slPips = Math.abs(entry - sl) / instr.pipSize;
    const lots = slPips > 0 ? riskAmount / (slPips * instr.pipValue) : null;
    out.risk = riskAmount;
    out.slPips = slPips;
    out.lots = lots;
    out.units = lots !== null ? lots * instr.contractSize : null;
    if (tp && lots !== null) {
      const dirSign = direction === 'BUY' ? 1 : -1;
      const tpPips = ((tp - entry) * dirSign) / instr.pipSize;
      out.tpProfit = tpPips * instr.pipValue * lots;
      out.rr = riskAmount > 0 ? out.tpProfit / riskAmount : null;
    }
  }

  document.getElementById('c-out-lots').textContent = out.lots !== null ? fmtNum(out.lots, 2) : '—';
  document.getElementById('c-out-units').textContent = out.units !== null ? fmtNum(out.units, 0) : '—';
  document.getElementById('c-out-risk').textContent = out.risk !== null ? fmtMoneyOrPercent(out.risk) : '—';
  document.getElementById('c-out-slpips').textContent = out.slPips !== null ? fmtNum(out.slPips, 1) : '—';
  document.getElementById('c-out-tpprofit').textContent = out.tpProfit !== null ? fmtMoneyOrPercent(out.tpProfit, { signed: true }) : '—';
  document.getElementById('c-out-rr').textContent = out.rr !== null ? fmtNum(out.rr, 2) + 'R' : '—';

  return { instrument: name, direction, entry, sl, tp, lots: out.lots };
}

['c-instrument', 'c-capital', 'c-risk-pct', 'c-entry', 'c-sl', 'c-tp'].forEach(id => {
  document.getElementById(id).addEventListener('input', computeCalculator);
  document.getElementById(id).addEventListener('change', computeCalculator);
});
document.getElementById('c-seg-direction').addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  setSeg('c-seg-direction', btn.dataset.val);
  computeCalculator();
});

document.getElementById('btn-use-calc').addEventListener('click', () => {
  const c = computeCalculator();
  resetTradeForm();
  showView('trade-form');
  if (c.instrument) document.getElementById('f-instrument').value = c.instrument;
  setSeg('seg-direction', c.direction);
  if (c.entry) document.getElementById('f-entry').value = c.entry;
  if (c.sl) document.getElementById('f-sl').value = c.sl;
  if (c.tp) document.getElementById('f-tp').value = c.tp;
  if (c.lots) document.getElementById('f-lots').value = c.lots.toFixed(2);
  updateChecklistBox();
  updateRDisplay();
  toast('Valori precompilati nel nuovo trade');
});

/* ---------------- CSV import ---------------- */

const CSV_TARGET_FIELDS = [
  { key: '', label: '— ignora —' },
  { key: 'instrument', label: 'Strumento' },
  { key: 'direction', label: 'Direzione (BUY/SELL)' },
  { key: 'openDate', label: 'Data apertura' },
  { key: 'closeDate', label: 'Data chiusura' },
  { key: 'lots', label: 'Lotti' },
  { key: 'entryPrice', label: 'Prezzo entrata' },
  { key: 'exitPrice', label: 'Prezzo uscita' },
  { key: 'slPrice', label: 'Stop loss' },
  { key: 'tpPrice', label: 'Take profit' },
  { key: 'profit', label: 'Profitto (€)' },
  { key: 'strategy', label: 'Strategia' },
  { key: 'notes', label: 'Note' },
  { key: 'initialCapital', label: 'Capitale iniziale (una tantum)' },
];

let csvRows = [];
let csvHeaders = [];
let csvAutoDetected = false; // true per formati riconosciuti (MetaTrader, Bitget/Bybit): non serve ricordare la mappatura

// Firma stabile delle intestazioni, usata come chiave per ricordare la
// mappatura scelta a mano l'ultima volta per file con questa stessa struttura.
function csvHeaderSignature(headers) {
  return headers.map(h => String(h || '').trim().toLowerCase()).join('|');
}

function parseFlexibleDate(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // yyyy-mm-dd / yyyy.mm.dd / yyyy/mm/dd, optional time — ISO and MetaTrader (MT4/MT5) style
  let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    let [, yyyy, mm, dd, hh, min, sec] = m;
    yyyy = parseInt(yyyy, 10); mm = parseInt(mm, 10); dd = parseInt(dd, 10);
    hh = hh ? parseInt(hh, 10) : 0; min = min ? parseInt(min, 10) : 0; sec = sec ? parseInt(sec, 10) : 0;
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const d = new Date(yyyy, mm - 1, dd, hh, min, sec);
    return isNaN(d.getTime()) ? null : d;
  }

  // dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy (Italian/European), optional time HH:mm(:ss)
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    let [, a, b, yyyy, hh, min, sec] = m;
    let dd = parseInt(a, 10), mm = parseInt(b, 10);
    yyyy = yyyy.length === 2 ? 2000 + parseInt(yyyy, 10) : parseInt(yyyy, 10);
    hh = hh ? parseInt(hh, 10) : 0; min = min ? parseInt(min, 10) : 0; sec = sec ? parseInt(sec, 10) : 0;
    // If the first number can't be a valid day but could be a month (US-style mm/dd/yyyy), swap.
    if (dd > 12 && mm <= 12) {
      // dd/mm already fine (day > 12 means it's definitely the day)
    } else if (mm > 12 && dd <= 12) {
      [dd, mm] = [mm, dd]; // was actually mm/dd/yyyy
    }
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
    const d = new Date(yyyy, mm - 1, dd, hh, min, sec);
    return isNaN(d.getTime()) ? null : d;
  }

  // Fallback: let the browser try (covers e.g. "Aug 23 2026" etc.)
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseCsv(text) {
  const delim = text.split('\n')[0].includes(';') ? ';' : ',';
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  const headers = lines[0].split(delim).map(h => h.trim());
  const rows = lines.slice(1).map(l => l.split(delim).map(c => c.trim()));
  return { headers, rows };
}

function guessMapping(header) {
  const h = header.toLowerCase().trim();
  const clean = h.replace(/[^a-z0-9&]/g, ''); // strips spaces, slashes, dots for exact-ish matches like "s/l" -> "sl"
  const hasPrice = h.includes('prezzo') || h.includes('price');
  const hasDateWord = h.includes('time') || h.includes('data') || h.includes('ora') || h === 'apertura' || h === 'chiusura' || h === 'open' || h === 'close';

  if (h.includes('capitale inizial') || h.includes('saldo inizial') || h.includes('initial balance') || h.includes('initial capital') || clean === 'balance' || clean === 'saldo') return 'initialCapital';

  if (h.includes('strument') || h.includes('simbol') || h.includes('symbol') || h.includes('instrument') || h === 'item') return 'instrument';
  if (h.includes('direz') || h.includes('side') || h.includes('direction') || h.includes('tipo') || h === 'type') return 'direction';

  // price columns take priority when "prezzo"/"price" is combined with open/close wording
  if (hasPrice && (h.includes('apertura') || h.includes('entrata') || h.includes('entry') || h.includes('open'))) return 'entryPrice';
  if (hasPrice && (h.includes('chiusura') || h.includes('uscita') || h.includes('exit') || h.includes('close'))) return 'exitPrice';

  if (h.includes('apertura') || (h.includes('open') && hasDateWord)) return 'openDate';
  if (h.includes('chiusura') || (h.includes('close') && hasDateWord)) return 'closeDate';

  if (h.includes('lott') || h.includes('lot') || h.includes('volume') || h.includes('size')) return 'lots';
  if (h.includes('entrata') || h.includes('entry')) return 'entryPrice';
  if (h.includes('uscita') || h.includes('exit')) return 'exitPrice';
  if (clean === 'sl' || h.includes('stop')) return 'slPrice';
  if (clean === 'tp' || h.includes('target') || h.includes('take')) return 'tpPrice';
  if (h.includes('profit') || h.includes('utile') || h.includes('guadagn') || h.includes('pl') || h.includes('p&l') || h.includes('risultato')) return 'profit';
  if (h.includes('strateg')) return 'strategy';
  if (h.includes('note') || h.includes('comment') || h.includes('commento')) return 'notes';
  return '';
}

// Colonne fisse del blocco "Posizioni" nel Report Cronistorico dei Trade
// esportato da MetaTrader/FTMO (.xlsx). L'ordine è sempre lo stesso:
// Ora apertura | Posizione(id) | Simbolo | Tipo | Volume | Prezzo apertura |
// S/L | T/P | Ora chiusura | Prezzo chiusura | Commissioni | Swap | Profitto
const MT_POSITIONS_COLUMN_MAP = [
  'openDate', '', 'instrument', 'direction', 'lots', 'entryPrice',
  'slPrice', 'tpPrice', 'closeDate', 'exitPrice', '', '', 'profit', 'initialCapital',
];
const MT_POSITIONS_HEADER_LABELS = [
  'Apertura', 'Posizione', 'Simbolo', 'Tipo', 'Volume', 'Prezzo apertura',
  'S/L', 'T/P', 'Chiusura', 'Prezzo chiusura', 'Commissioni', 'Swap', 'Profitto',
  'Saldo conto (dal file)',
];

// Legge il saldo del conto dalla sezione "Affari" del report MetaTrader/FTMO,
// che elenca ogni movimento (trade e depositi/prelievi "balance") con il
// saldo PROGRESSIVO dopo ciascuno ("Bilancio"). Calcoliamo il saldo subito
// PRIMA della prima riga presente nel file (saldo dopo meno l'impatto di
// quella riga), così l'import può poi sommare trade e movimenti importati
// e ritrovare da solo il saldo attuale — stessa logica usata per Bybit.
// Colonne "Affari": Ora, Affare, Simbolo, Tipo, Direzione, Volume, Prezzo,
// Ordine, Commissioni, Spese, Swap, Profitto, Bilancio, Commento.
function extractMTInitialCapital(sheetRows) {
  const dealsIdx = sheetRows.findIndex(r => String(r[0] || '').trim().toLowerCase() === 'affari');
  if (dealsIdx === -1) return null;
  const dataStart = dealsIdx + 2; // salta la riga "Affari" e la riga di intestazione
  const num = (v) => parseFloat(String(v === undefined || v === null ? '' : v).replace(',', '.'));
  for (let i = dataStart; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    const firstCell = String(row[0] || '').trim().toLowerCase();
    if (!firstCell || firstCell === 'posizioni aperte' || firstCell === 'risultati') break;
    const balanceAfter = num(row[12]);
    if (isNaN(balanceAfter)) continue;
    const type = String(row[3] || '').trim().toLowerCase();
    if (type === 'balance') {
      // Deposito/prelievo esplicito (tipicamente il primo, es. "Initial account
      // balance" di una challenge FTMO): il saldo DOPO questo movimento è il
      // vero capitale di partenza del conto, non va sottratto.
      return balanceAfter;
    }
    // Nessun deposito esplicito trovato: usiamo il saldo subito PRIMA di questa
    // prima riga presente nel file (saldo dopo meno l'impatto del trade),
    // così l'import può sommare i trade importati e ritrovare il saldo attuale.
    const commission = num(row[8]) || 0;
    const fee = num(row[9]) || 0;
    const swap = num(row[10]) || 0;
    const profit = num(row[11]) || 0;
    return balanceAfter - commission - fee - swap - profit;
  }
  return null;
}

// Riconosce il report MetaTrader/FTMO cercando la riga "Posizioni" e la riga
// di intestazione subito dopo, poi estrae le righe fino a "Ordini" (o a una
// riga vuota). Ritorna null se il foglio non ha questo formato.
function extractMetaTraderPositions(sheetRows) {
  const positionsRowIdx = sheetRows.findIndex(r => String(r[0] || '').trim().toLowerCase() === 'posizioni');
  if (positionsRowIdx === -1) return null;

  const headerRowIdx = positionsRowIdx + 1;
  const dataStart = headerRowIdx + 1;
  const rows = [];
  for (let i = dataStart; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    const firstCell = String(row[0] || '').trim().toLowerCase();
    if (!firstCell || firstCell === 'ordini' || firstCell === 'totale') break;
    rows.push(MT_POSITIONS_COLUMN_MAP.map((_, idx) => {
      const v = row[idx];
      return v === null || v === undefined ? '' : String(v).trim();
    }));
  }
  if (!rows.length) return null;

  const initialCapital = extractMTInitialCapital(sheetRows);
  if (initialCapital !== null) rows[0][13] = String(initialCapital);

  return rows;
}

// Colonne del report "Export USDT-M Futures transactions" di Bitget/Bybit.
// A differenza del report MetaTrader, qui NON ci sono prezzo di entrata/uscita
// né size: ogni riga è un movimento di ledger (apertura, chiusura, fee di
// settlement, trasferimento tra wallet) con il PnL realizzato (Amount) e il
// saldo del conto DOPO quel movimento (Wallet balance).
const BITGET_EXPECTED_HEADERS = ['order', 'date', 'coin', 'futures', 'margin mode', 'type', 'amount', 'fee', 'wallet balance'];

const BITGET_COLUMN_MAP = ['openDate', 'closeDate', 'instrument', 'direction', 'profit', 'notes', 'initialCapital'];
const BITGET_HEADER_LABELS = [
  'Data apertura (stimata)', 'Data chiusura', 'Simbolo', 'Direzione',
  'Profitto netto (USDT)', 'Note', 'Saldo conto (dal file)',
];

// Ricostruisce i trade chiusi da un export Bitget/Bybit "USDT-M Futures
// transactions". Ogni riga close_*/burst_close_* diventa un trade; l'apertura
// viene abbinata FIFO alla open_long/open_short più vecchia non ancora usata
// sullo stesso simbolo e stessa direzione (se non trovata, si usa la data di
// chiusura come stima). Ritorna null se l'intestazione non corrisponde.
function extractBitgetFuturesPositions(sheetRows) {
  if (!sheetRows.length) return null;
  const header = sheetRows[0].map(h => String(h || '').trim().toLowerCase());
  const matches = BITGET_EXPECTED_HEADERS.every((h, idx) => header[idx] === h);
  if (!matches) return null;

  // Righe grezze con parsing minimo, ordinate cronologicamente: il formato
  // data "YYYY-MM-DD HH:MM:SS" si ordina correttamente anche come stringa.
  const raw = sheetRows.slice(1)
    .map(r => ({
      order: String(r[0] || '').trim(),
      date: String(r[1] || '').trim(),
      futures: String(r[3] || '').trim(),
      type: String(r[5] || '').trim().toLowerCase(),
      amount: parseFloat(String(r[6] === undefined || r[6] === null ? '' : r[6]).replace(',', '.')) || 0,
      fee: parseFloat(String(r[7] === undefined || r[7] === null ? '' : r[7]).replace(',', '.')) || 0,
      walletBalance: parseFloat(String(r[8] === undefined || r[8] === null ? '' : r[8]).replace(',', '.')),
    }))
    .filter(r => r.date && r.type);
  if (!raw.length) return null;

  raw.sort((a, b) => (a.date + a.order).localeCompare(b.date + b.order));

  // Capitale iniziale: usiamo il saldo wallet (Wallet balance) subito PRIMA della
  // riga più vecchia di tutto l'export (aperture, chiusure, fee di settlement,
  // trasferimenti compresi), così il diario può poi sommare i PnL e le fee
  // importate e ritrovare da solo il saldo attuale, invece di doverlo inserire
  // a mano — stessa logica usata per Bybit/MetaTrader.
  let initialCapital = null;
  for (const r of raw) {
    if (!isNaN(r.walletBalance)) {
      initialCapital = r.walletBalance - r.amount - r.fee;
      break;
    }
  }

  const openQueue = {}; // simbolo -> array di { date, dir, fee } in attesa di essere chiusi
  const outRows = [];
  let sumNetProfit = 0;
  let firstDate = raw[0].date;
  let lastWalletBalance = null;

  raw.forEach(r => {
    if (!isNaN(r.walletBalance)) lastWalletBalance = r.walletBalance;

    if (r.type === 'open_long' || r.type === 'open_short') {
      if (!r.futures || r.futures === 'NULL') return;
      const dir = r.type === 'open_long' ? 'long' : 'short';
      if (!openQueue[r.futures]) openQueue[r.futures] = [];
      openQueue[r.futures].push({ date: r.date, dir, fee: r.fee });
      return;
    }

    const isClose = r.type === 'close_long' || r.type === 'close_short' ||
      r.type === 'burst_close_long' || r.type === 'burst_close_short';
    if (!isClose || !r.futures || r.futures === 'NULL') return;

    const dir = r.type.includes('long') ? 'long' : 'short';
    const isBurst = r.type.startsWith('burst_close');

    let openDate = r.date; // fallback: nessuna apertura corrispondente trovata
    let openFee = 0;
    const queue = openQueue[r.futures];
    if (queue && queue.length) {
      const idx = queue.findIndex(o => o.dir === dir);
      if (idx !== -1) {
        const matched = queue.splice(idx, 1)[0];
        openDate = matched.date;
        openFee = matched.fee;
      }
    }

    const gross = r.amount;
    const closeFee = r.fee;
    const net = gross + closeFee + openFee; // PnL lordo + fee apertura + fee chiusura
    sumNetProfit += net;

    const notesParts = [
      `Import Bitget/Bybit`,
      `ordine ${r.order}`,
      `PnL lordo ${gross.toFixed(2)} USDT`,
      `fee apertura+chiusura ${(openFee + closeFee).toFixed(4)} USDT`,
      `saldo wallet dopo: ${!isNaN(r.walletBalance) ? r.walletBalance.toFixed(2) : '-'} USDT`,
    ];
    if (isBurst) notesParts.push('⚠️ posizione liquidata (burst)');

    outRows.push([
      openDate,
      r.date,
      r.futures,
      dir === 'long' ? 'LONG' : 'SHORT',
      String(net),
      notesParts.join(' · '),
    ]);
  });

  if (!outRows.length) return null;
  if (initialCapital !== null) outRows[0][6] = String(initialCapital);
  return outRows;
}

// Colonne del report "Asset Change Details" esportato da Bybit (Assets →
// Financial Records → Change Details, formato .csv). A differenza del report
// Bitget/Bitget-style sopra, qui ogni riga è un singolo fill (esecuzione
// parziale) con la size del contratto (Quantity), il prezzo di quel fill
// (Filled Price) e "Action" = OPEN/CLOSE. Una posizione può aprirsi/chiudersi
// con più fill parziali consecutivi sullo stesso simbolo: li aggreghiamo
// finché la size netta (tracciata dalla colonna "Position") non torna a zero.
const BYBIT_EXPECTED_HEADERS = [
  'uid', 'currency', 'contract', 'type', 'direction', 'quantity', 'position',
  'filled price', 'funding', 'fee paid', 'cash flow', 'change', 'wallet balance',
  'action', 'time(utc)',
];
const BYBIT_COLUMN_MAP = ['openDate', 'closeDate', 'instrument', 'direction', 'lots', 'entryPrice', 'exitPrice', 'profit', 'notes', 'initialCapital'];
const BYBIT_HEADER_LABELS = [
  'Apertura', 'Chiusura', 'Simbolo', 'Direzione', 'Quantità',
  'Prezzo entrata (medio)', 'Prezzo uscita (medio)', 'Profitto netto (USDT)', 'Note',
  'Saldo conto (dal file)',
];

// Il file Bybit ha una riga extra ("UID: ..., Company Name: ...") prima delle
// vere intestazioni: cerchiamo quindi la riga che inizia con "Uid" invece di
// assumere che sia sempre la prima. Ritorna null se il formato non corrisponde.
function extractBybitAssetChanges(sheetRows) {
  const headerIdx = sheetRows.findIndex(r => String(r[0] || '').trim().toLowerCase() === 'uid');
  if (headerIdx === -1) return null;
  const header = sheetRows[headerIdx].map(h => String(h || '').trim().toLowerCase());
  const matches = BYBIT_EXPECTED_HEADERS.every((h, idx) => header[idx] === h);
  if (!matches) return null;

  const num = (v) => parseFloat(String(v === undefined || v === null ? '' : v).replace(',', '.')) || 0;

  const raw = sheetRows.slice(headerIdx + 1)
    .filter(r => r.length && String(r[0] || '').trim())
    .map(r => ({
      contract: String(r[2] || '').trim(),
      type: String(r[3] || '').trim().toUpperCase(),
      direction: String(r[4] || '').trim().toUpperCase(),
      quantity: Math.abs(num(r[5])),
      positionAfter: num(r[6]), // "Position": size netta REALE del contratto dopo questo fill (riportata da Bybit)
      filledPrice: num(r[7]),
      change: num(r[11]),
      action: String(r[13] || '').trim().toUpperCase(),
      time: String(r[14] || '').trim(),
    }))
    .filter(row => row.type === 'TRADE' && row.contract && row.time && (row.action === 'OPEN' || row.action === 'CLOSE'));

  if (!raw.length) return null;

  // Capitale iniziale: usiamo il saldo del conto (Wallet Balance) subito PRIMA
  // della riga più vecchia di tutto l'export (non solo i trade: anche
  // settlement, funding, trasferimenti), così il diario può poi sommare i
  // profitti/perdite importati e ritrovare da solo il saldo attuale, invece
  // di dover inserire il capitale a mano.
  let initialCapital = null;
  {
    const allRows = sheetRows.slice(headerIdx + 1).filter(r => r.length && String(r[0] || '').trim());
    let oldest = null;
    for (const r of allRows) {
      const time = String(r[14] || '').trim();
      if (!time) continue;
      if (!oldest || time < oldest.time) oldest = { time, walletBalance: num(r[12]), change: num(r[11]) };
    }
    if (oldest && !isNaN(oldest.walletBalance)) {
      initialCapital = oldest.walletBalance - oldest.change;
    }
  }

  // Il file è esportato dal più recente al più vecchio: lo invertiamo per
  // ricostruire le posizioni in ordine cronologico.
  raw.reverse();

  const POS_EPS = 1e-6;

  const fresh = () => ({
    dir: null, valid: false,
    openTime: null, closeTime: null,
    openQty: 0, openNotional: 0,
    closeQty: 0, closeNotional: 0,
    change: 0,
  });

  const positions = {}; // contratto -> accumulatore della posizione in corso
  const outRows = [];

  raw.forEach(r => {
    if (!positions[r.contract]) positions[r.contract] = fresh();
    let pos = positions[r.contract];
    const signedQty = r.direction === 'BUY' ? r.quantity : -r.quantity;
    // Usiamo la colonna "Position" (riportata da Bybit) per sapere qual era la
    // size netta REALE subito PRIMA di questo fill, invece di fidarci di un
    // accumulatore interno che parte sempre da zero: se il file esportato
    // inizia a metà di una posizione già aperta prima della finestra
    // (es. l'utente aveva già una posizione XAU aperta prima della data di
    // inizio export), un accumulatore che parte da zero non torna MAI più
    // esattamente a zero per il resto del file, e tutti i cicli successivi
    // restano invisibili — era questo il bug che faceva sparire XAU.
    const positionBefore = r.positionAfter - signedQty;

    if (Math.abs(positionBefore) < POS_EPS) {
      // La posizione era piatta subito prima di questo fill: qui inizia un
      // nuovo ciclo. Se c'era un ciclo precedente rimasto "appeso" (mai
      // tornato a zero, es. per un errore di dati), lo scartiamo e ripartiamo.
      positions[r.contract] = fresh();
      pos = positions[r.contract];
      pos.dir = r.positionAfter > 0 ? 'long' : 'short';
      pos.openTime = r.time;
      pos.valid = true;
    }

    if (r.action === 'OPEN') {
      pos.openQty += r.quantity;
      pos.openNotional += r.quantity * r.filledPrice;
    } else { // CLOSE
      pos.closeQty += r.quantity;
      pos.closeNotional += r.quantity * r.filledPrice;
    }
    pos.change += r.change;
    pos.closeTime = r.time;

    if (Math.abs(r.positionAfter) < POS_EPS) {
      // La posizione (reale, da Bybit) è tornata a zero: ciclo completo.
      if (pos.valid && pos.openQty > 0 && pos.closeQty > 0) {
        const entryPrice = pos.openNotional / pos.openQty;
        const exitPrice = pos.closeNotional / pos.closeQty;
        outRows.push([
          pos.openTime,
          pos.closeTime,
          r.contract,
          pos.dir === 'long' ? 'LONG' : 'SHORT',
          String(pos.closeQty),
          String(entryPrice),
          String(exitPrice),
          String(pos.change),
          `Import Bybit (Asset Change Details) · size ${pos.closeQty}`,
          '', // colonna capitale iniziale: valorizzata solo sulla prima riga, sotto
        ]);
      }
      positions[r.contract] = fresh();
    }
  });

  if (!outRows.length) return null;
  if (initialCapital !== null) outRows[0][9] = String(initialCapital);
  return outRows;
}

// Colonne del report "Futures Trade History" esportato da MEXC (.xlsx). Come
// per Bybit, ogni riga è un singolo fill (esecuzione parziale), NON un trade
// già aggregato. A differenza di Bybit, però, MEXC non fornisce una colonna
// con la size netta della posizione dopo ogni fill, né un saldo conto: quindi
// la ricostruzione dei cicli apertura/chiusura la facciamo con un accumulatore
// nostro per ogni coppia simbolo+lato (long/short), che si considera "chiuso"
// quando la quantità aperta e quella chiusa (sommate progressivamente) si
// eguagliano. Limite noto: se l'export inizia a metà di una posizione già
// aperta prima della finestra esportata, il primo ciclo su quel simbolo/lato
// avrà un prezzo di entrata calcolato solo sui fill presenti nel file.
//
// Per distinguere fill di apertura da fill di chiusura NON ci basiamo sul
// testo di "Direction" (es. "sell short"/"buy short": la convenzione MEXC per
// il lato short non è quella intuitiva "vendi per aprire, compri per
// chiudere"), ma sulla colonna "Closing PNL": è sempre esattamente 0 su un
// fill che aumenta la posizione (matematicamente non si può realizzare PnL
// aumentando un'esposizione) ed è diversa da zero su un fill che la riduce.
// Verificato numericamente sul file di esempio: Closing PNL coincide con il
// solo PnL da movimento prezzo, le fee NON sono incluse e vanno sottratte a
// parte (colonna "Trading Fee").
const MEXC_EXPECTED_HEADERS_FIXED = {
  0: 'uid', 2: 'futures trading pair', 3: 'direction', 4: 'order type',
  5: 'filled qty (cont.)', 6: 'filled qty (crypto)', 7: 'filled qty (amount)',
  8: 'filled price', 9: 'trading fee', 10: 'fee-payment crypto', 11: 'role', 12: 'closing pnl',
};
const MEXC_COLUMN_MAP = ['openDate', 'closeDate', 'instrument', 'direction', 'lots', 'entryPrice', 'exitPrice', 'profit', 'notes', 'initialCapital'];
const MEXC_HEADER_LABELS = [
  'Apertura', 'Chiusura', 'Simbolo', 'Direzione', 'Quantità',
  'Prezzo entrata (medio)', 'Prezzo uscita (medio)', 'Profitto netto (USDT)', 'Note',
  'Saldo conto (dal file)',
];

function extractMexcFuturesFills(sheetRows) {
  if (!sheetRows.length) return null;
  const header = sheetRows[0].map(h => String(h || '').trim().toLowerCase());
  const matches = Object.entries(MEXC_EXPECTED_HEADERS_FIXED).every(([idx, val]) => header[idx] === val);
  // la colonna 1 è "Time(UTC+XX:00)": il fuso varia col fuso orario
  // dell'account MEXC dell'utente, quindi controlliamo solo il prefisso.
  if (!matches || !header[1] || !header[1].startsWith('time(')) return null;

  const num = (v) => parseFloat(String(v === undefined || v === null ? '' : v).replace(',', '.')) || 0;

  const raw = sheetRows.slice(1)
    .filter(r => r.length && String(r[1] || '').trim())
    .map(r => ({
      time: String(r[1] || '').trim(),
      pair: String(r[2] || '').trim(),
      direction: String(r[3] || '').trim().toLowerCase(),
      qty: num(r[6]), // Filled Qty (Crypto)
      price: num(r[8]),
      fee: num(r[9]),
      pnl: num(r[12]), // Closing PNL
    }))
    .filter(r => r.pair && r.time && r.qty > 0);

  if (!raw.length) return null;

  // Il file è esportato dal più recente al più vecchio: lo ordiniamo in modo
  // crescente. Il formato data "YYYY-MM-DD HH:MM:SS" si ordina correttamente
  // anche come semplice confronto tra stringhe.
  raw.sort((a, b) => a.time.localeCompare(b.time));

  const fresh = () => ({
    openQty: 0, openNotional: 0, closeQty: 0, closeNotional: 0,
    realized: 0, fees: 0, openTime: null, closeTime: null, started: false,
  });

  const positions = {}; // "simbolo|lato" -> accumulatore del ciclo in corso
  const outRows = [];

  raw.forEach(r => {
    const side = r.direction.includes('long') ? 'long' : (r.direction.includes('short') ? 'short' : null);
    if (!side) return;
    const key = r.pair + '|' + side;
    if (!positions[key]) positions[key] = fresh();
    const pos = positions[key];

    if (!pos.started) { pos.started = true; pos.openTime = r.time; }
    pos.fees += r.fee;
    pos.closeTime = r.time;

    const isClose = Math.abs(r.pnl) > 1e-9;
    if (!isClose) {
      pos.openQty += r.qty;
      pos.openNotional += r.qty * r.price;
    } else {
      pos.closeQty += r.qty;
      pos.closeNotional += r.qty * r.price;
      pos.realized += r.pnl;
    }

    // Ciclo completo quando la quantità aperta e quella chiusa (accumulate da
    // noi) coincidono, con una tolleranza relativa alla size della posizione
    // (una tolleranza fissa assoluta romperebbe i simboli con quantità enormi,
    // es. VET con centinaia di migliaia di unità).
    const net = pos.openQty - pos.closeQty;
    const threshold = Math.max(1e-8, pos.openQty * 1e-6);
    if (pos.openQty > 0 && pos.closeQty > 0 && Math.abs(net) < threshold) {
      const entryPrice = pos.openNotional / pos.openQty;
      const exitPrice = pos.closeNotional / pos.closeQty;
      const netProfit = pos.realized - pos.fees;
      outRows.push([
        pos.openTime,
        pos.closeTime,
        r.pair,
        side === 'long' ? 'LONG' : 'SHORT',
        String(pos.closeQty),
        String(entryPrice),
        String(exitPrice),
        String(netProfit),
        `Import MEXC Futures · PnL lordo ${pos.realized.toFixed(4)} USDT · fee totali ${pos.fees.toFixed(4)} USDT`,
        '',
      ]);
      positions[key] = fresh();
    }
  });

  if (!outRows.length) return null;
  return outRows;
}

// Colonne del report "USD⨯M Perpetual Futures" esportato da BingX (.csv).
// Come MEXC, ogni riga è un singolo fill e non c'è una colonna con la size
// netta della posizione: usiamo lo stesso accumulatore per simbolo+lato visto
// sopra. A differenza di MEXC, però, qui la colonna "Type" indica già
// esplicitamente "Open Long/Short" o "Close Long/Short" senza ambiguità, quindi
// non serve dedurre apertura/chiusura dal PnL.
// Verificato numericamente sul file di esempio: il prezzo che fa tornare
// "Realized PNL" è "AvgPrice", NON "DealPrice" (che può differire leggermente
// per via di più fill sullo stesso ordine); le fee sono riportate già negative
// e NON sono incluse nel PnL realizzato, vanno sommate a parte.
const BINGX_EXPECTED_HEADERS_FIXED = {
  0: 'uid', 1: 'order no.', 3: 'pair', 4: 'type', 5: 'leverage',
  6: 'dealprice', 7: 'quantity', 8: 'amount', 9: 'fee', 10: 'fee coin',
  11: 'realized pnl', 12: 'quote asset', 13: 'order type', 14: 'avgprice',
};
const BINGX_COLUMN_MAP = ['openDate', 'closeDate', 'instrument', 'direction', 'lots', 'entryPrice', 'exitPrice', 'profit', 'notes', 'initialCapital'];
const BINGX_HEADER_LABELS = [
  'Apertura', 'Chiusura', 'Simbolo', 'Direzione', 'Quantità',
  'Prezzo entrata (medio)', 'Prezzo uscita (medio)', 'Profitto netto (USDT)', 'Note',
  'Saldo conto (dal file)',
];

function extractBingxFuturesFills(sheetRows) {
  if (!sheetRows.length) return null;
  const header = sheetRows[0].map((h, i) => {
    // BingX mette un BOM UTF-8 davanti alla prima intestazione ("UID"):
    // va rimosso, altrimenti il confronto con 'uid' fallisce sempre.
    let v = String(h || '').trim();
    if (i === 0) v = v.replace(/^\uFEFF/, '');
    return v.toLowerCase();
  });
  const matches = Object.entries(BINGX_EXPECTED_HEADERS_FIXED).every(([idx, val]) => header[idx] === val);
  // la colonna 2 è "Time(UTC+X)": il fuso varia col fuso orario dell'account
  // BingX dell'utente, quindi controlliamo solo il prefisso.
  if (!matches || !header[2] || !header[2].startsWith('time(')) return null;

  const num = (v) => parseFloat(String(v === undefined || v === null ? '' : v).replace(',', '.')) || 0;

  const raw = sheetRows.slice(1)
    .filter(r => r.length && String(r[2] || '').trim())
    .map(r => ({
      time: String(r[2] || '').trim(),
      pair: String(r[3] || '').trim().replace(/-/g, ''), // "BTC-USDT" -> "BTCUSDT", coerente con gli altri import
      type: String(r[4] || '').trim().toLowerCase(),
      qty: num(r[7]),
      avgPrice: num(r[14]),
      fee: num(r[9]),
      pnl: num(r[11]),
    }))
    .filter(r => r.pair && r.time && r.qty > 0 && (r.type.startsWith('open') || r.type.startsWith('close')));
  // Righe con "Type" diverso da Open/Close (es. liquidazioni con dicitura
  // particolare, eventi di funding) vengono ignorate invece di rompere
  // l'import: restano fuori dal diario, meglio che generare trade sbagliati.

  if (!raw.length) return null;

  // Il file BingX è esportato dal più recente al più vecchio: lo ordiniamo in
  // modo crescente. Formato data "YYYY-MM-DD HH:MM:SS": si ordina bene anche
  // come confronto tra stringhe.
  raw.sort((a, b) => a.time.localeCompare(b.time));

  const fresh = () => ({
    openQty: 0, openNotional: 0, closeQty: 0, closeNotional: 0,
    realized: 0, fees: 0, openTime: null, closeTime: null, started: false,
  });

  const positions = {}; // "simbolo|lato" -> accumulatore del ciclo in corso
  const outRows = [];

  raw.forEach(r => {
    const side = r.type.includes('long') ? 'long' : (r.type.includes('short') ? 'short' : null);
    if (!side) return;
    const key = r.pair + '|' + side;
    if (!positions[key]) positions[key] = fresh();
    const pos = positions[key];

    if (!pos.started) { pos.started = true; pos.openTime = r.time; }
    pos.fees += r.fee; // già negative nel file BingX
    pos.closeTime = r.time;

    if (r.type.startsWith('open')) {
      pos.openQty += r.qty;
      pos.openNotional += r.qty * r.avgPrice;
    } else {
      pos.closeQty += r.qty;
      pos.closeNotional += r.qty * r.avgPrice;
      pos.realized += r.pnl;
    }

    const net = pos.openQty - pos.closeQty;
    const threshold = Math.max(1e-8, pos.openQty * 1e-6);
    if (pos.openQty > 0 && pos.closeQty > 0 && Math.abs(net) < threshold) {
      const entryPrice = pos.openNotional / pos.openQty;
      const exitPrice = pos.closeNotional / pos.closeQty;
      const netProfit = pos.realized + pos.fees; // fee già negative: si sommano
      outRows.push([
        pos.openTime,
        pos.closeTime,
        r.pair,
        side === 'long' ? 'LONG' : 'SHORT',
        String(pos.closeQty),
        String(entryPrice),
        String(exitPrice),
        String(netProfit),
        `Import BingX Futures · PnL lordo ${pos.realized.toFixed(4)} USDT · fee totali ${Math.abs(pos.fees).toFixed(4)} USDT`,
        '',
      ]);
      positions[key] = fresh();
    }
  });

  // Chiusure "orfane": l'export BingX può coprire solo una finestra di date
  // limitata, quindi alcune Close possono non avere nessuna Open corrispondente
  // nel file (la posizione era stata aperta prima dell'inizio dell'export).
  // Le riconosciamo perché openQty è rimasto a 0: scartarle del tutto
  // butterebbe via un PnL realmente realizzato, quindi le recuperiamo comunque,
  // usando la data di chiusura anche come data di apertura (stima, dichiarata
  // in nota) e il prezzo di uscita come prezzo di entrata segnaposto — il
  // profitto netto resta quello reale letto dal file, solo il prezzo di
  // ingresso è una stima. Le posizioni con openQty>0 ma non ancora bilanciate
  // (net ≠ 0) restano invece escluse: sono probabilmente ancora aperte oggi.
  Object.entries(positions).forEach(([key, pos]) => {
    if (pos.openQty === 0 && pos.closeQty > 0) {
      const side = key.split('|')[1];
      const pair = key.slice(0, key.length - side.length - 1);
      const exitPrice = pos.closeNotional / pos.closeQty;
      const netProfit = pos.realized + pos.fees;
      outRows.push([
        pos.closeTime,
        pos.closeTime,
        pair,
        side === 'long' ? 'LONG' : 'SHORT',
        String(pos.closeQty),
        String(exitPrice),
        String(exitPrice),
        String(netProfit),
        `Import BingX Futures · ⚠️ apertura non presente nel file (fuori dall'intervallo esportato): prezzo di entrata stimato = prezzo di uscita, PnL reale · PnL lordo ${pos.realized.toFixed(4)} USDT · fee totali ${Math.abs(pos.fees).toFixed(4)} USDT`,
        '',
      ]);
    }
  });

  if (!outRows.length) return null;
  return outRows;
}

// Converte il testo grezzo di un CSV in una matrice di righe grezze, senza
// assumere che la prima riga sia l'intestazione (serve ai riconoscitori sopra,
// che cercano da soli la riga di intestazione corretta, es. per i file Bybit
// che hanno una riga extra prima delle vere colonne).
function csvTextToRows(text) {
  const delim = text.split('\n')[0].includes(';') ? ';' : ',';
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  return lines.map(l => l.split(delim).map(c => c.trim()));
}

function handleXlsxFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    let workbook;
    try {
      workbook = XLSX.read(e.target.result, { type: 'array' });
    } catch (err) {
      toast('Impossibile leggere il file xlsx', true);
      return;
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    // raw:true evita che SheetJS formatti i numeri con separatori delle
    // migliaia / spazio dopo il segno meno (es. "-1 098.52"), che romperebbe
    // il parseFloat più avanti nella pipeline di import.
    const sheetRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

    const mtRows = extractMetaTraderPositions(sheetRows);
    if (mtRows) {
      csvHeaders = MT_POSITIONS_HEADER_LABELS;
      csvRows = mtRows;
      csvAutoDetected = true;
      renderCsvMap(MT_POSITIONS_COLUMN_MAP);
      toast(`Report MetaTrader riconosciuto: ${mtRows.length} posizioni trovate`);
      return;
    }

    const bybitRows = extractBybitAssetChanges(sheetRows);
    if (bybitRows) {
      csvHeaders = BYBIT_HEADER_LABELS;
      csvRows = bybitRows;
      csvAutoDetected = true;
      renderCsvMap(BYBIT_COLUMN_MAP);
      toast(`Export Bybit riconosciuto: ${bybitRows.length} posizioni chiuse trovate`);
      return;
    }

    const bitgetRows = extractBitgetFuturesPositions(sheetRows);
    if (bitgetRows) {
      csvHeaders = BITGET_HEADER_LABELS;
      csvRows = bitgetRows;
      csvAutoDetected = true;
      renderCsvMap(BITGET_COLUMN_MAP);
      toast(`Export Bitget/Bybit riconosciuto: ${bitgetRows.length} chiusure trovate`);
      return;
    }

    const mexcRows = extractMexcFuturesFills(sheetRows);
    if (mexcRows) {
      csvHeaders = MEXC_HEADER_LABELS;
      csvRows = mexcRows;
      csvAutoDetected = true;
      renderCsvMap(MEXC_COLUMN_MAP);
      toast(`Export MEXC riconosciuto: ${mexcRows.length} posizioni chiuse trovate`);
      return;
    }

    const bingxRows = extractBingxFuturesFills(sheetRows);
    if (bingxRows) {
      csvHeaders = BINGX_HEADER_LABELS;
      csvRows = bingxRows;
      csvAutoDetected = true;
      renderCsvMap(BINGX_COLUMN_MAP);
      toast(`Export BingX riconosciuto: ${bingxRows.length} posizioni chiuse trovate`);
      return;
    }

    // Fallback: nessun formato MetaTrader riconosciuto, trattiamo il primo
    // foglio come una tabella generica (prima riga = intestazioni).
    if (!sheetRows.length) {
      toast('Il file xlsx sembra vuoto', true);
      return;
    }
    csvHeaders = sheetRows[0].map(h => String(h || '').trim());
    csvRows = sheetRows.slice(1)
      .filter(r => r.some(c => String(c || '').trim().length))
      .map(r => csvHeaders.map((_, idx) => String(r[idx] === null || r[idx] === undefined ? '' : r[idx]).trim()));
    csvAutoDetected = false;
    const saved = STATE.csvMappings[csvHeaderSignature(csvHeaders)];
    renderCsvMap(saved);
    if (saved) toast('Mappatura colonne di un import precedente applicata automaticamente');
  };
  reader.readAsArrayBuffer(file);
}

function handleCsvFile(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || file.type.includes('spreadsheet')) {
    handleXlsxFile(file);
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const sheetRows = csvTextToRows(text);

    const bybitRows = extractBybitAssetChanges(sheetRows);
    if (bybitRows) {
      csvHeaders = BYBIT_HEADER_LABELS;
      csvRows = bybitRows;
      csvAutoDetected = true;
      renderCsvMap(BYBIT_COLUMN_MAP);
      toast(`Export Bybit riconosciuto: ${bybitRows.length} posizioni chiuse trovate`);
      return;
    }

    const bitgetRows = extractBitgetFuturesPositions(sheetRows);
    if (bitgetRows) {
      csvHeaders = BITGET_HEADER_LABELS;
      csvRows = bitgetRows;
      csvAutoDetected = true;
      renderCsvMap(BITGET_COLUMN_MAP);
      toast(`Export Bitget/Bybit riconosciuto: ${bitgetRows.length} chiusure trovate`);
      return;
    }

    const mexcRows = extractMexcFuturesFills(sheetRows);
    if (mexcRows) {
      csvHeaders = MEXC_HEADER_LABELS;
      csvRows = mexcRows;
      csvAutoDetected = true;
      renderCsvMap(MEXC_COLUMN_MAP);
      toast(`Export MEXC riconosciuto: ${mexcRows.length} posizioni chiuse trovate`);
      return;
    }

    const bingxRows = extractBingxFuturesFills(sheetRows);
    if (bingxRows) {
      csvHeaders = BINGX_HEADER_LABELS;
      csvRows = bingxRows;
      csvAutoDetected = true;
      renderCsvMap(BINGX_COLUMN_MAP);
      toast(`Export BingX riconosciuto: ${bingxRows.length} posizioni chiuse trovate`);
      return;
    }

    const { headers, rows } = parseCsv(text);
    csvHeaders = headers;
    csvRows = rows;
    csvAutoDetected = false;
    const saved = STATE.csvMappings[csvHeaderSignature(csvHeaders)];
    renderCsvMap(saved);
    if (saved) toast('Mappatura colonne di un import precedente applicata automaticamente');
  };
  reader.readAsText(file, 'UTF-8');
}

function brokenTrades() {
  // trades that are marked CLOSED but have no usable closeDate: invisible to every dashboard stat
  return STATE.trades.filter(t => t.status === 'CLOSED' && !t.closeDate);
}

function fixableProfitTrades() {
  // CLOSED trades with a valid closeDate but no profit saved, even though it's calculable
  // from instrument/entry/exit/lots — these also don't count in win rate / P&L / equity.
  return STATE.trades.filter(t => t.status === 'CLOSED' && t.closeDate && (t.profit === null || t.profit === undefined) && calcTradeProfit(t) !== null);
}

function renderCsvRepairBox() {
  const broken = brokenTrades();
  const fixable = fixableProfitTrades();
  const box = document.getElementById('csv-repair-box');
  const box2 = document.getElementById('csv-repair-box-profit');
  if (box) {
    if (broken.length) {
      box.style.display = 'block';
      document.getElementById('csv-repair-count').textContent = String(broken.length);
    } else {
      box.style.display = 'none';
    }
  }
  if (box2) {
    if (fixable.length) {
      box2.style.display = 'block';
      document.getElementById('csv-repair-profit-count').textContent = String(fixable.length);
    } else {
      box2.style.display = 'none';
    }
  }
}

document.getElementById('btn-repair-broken-trades')?.addEventListener('click', () => {
  const broken = brokenTrades();
  openModal(`
    <h3>Eliminare ${broken.length} operazioni corrotte?</h3>
    <p>Sono operazioni senza data di chiusura valida: non vengono contate in nessuna statistica. Verranno rimosse definitivamente. Dopo puoi reimportare il CSV: il parser delle date ora riconosce anche il formato gg/mm/aaaa e quello di MetaTrader (aaaa.mm.gg).</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Annulla</button>
      <button class="btn btn-danger" id="confirm-repair-broken">Elimina</button>
    </div>
  `);
  document.getElementById('confirm-repair-broken').onclick = async () => {
    const ids = new Set(broken.map(t => t.id));
    STATE.trades = STATE.trades.filter(t => !ids.has(t.id));
    await Storage.save(STATE);
    closeModal();
    renderCsvRepairBox();
    renderDashboard();
    toast(`${ids.size} operazioni eliminate`);
  };
});

document.getElementById('btn-repair-profit-trades')?.addEventListener('click', async () => {
  const fixable = fixableProfitTrades();
  let fixed = 0;
  fixable.forEach(t => {
    const computed = calcTradeProfit(t);
    if (computed !== null) { t.profit = computed; fixed++; }
  });
  await Storage.save(STATE);
  renderCsvRepairBox();
  renderDashboard();
  toast(`${fixed} operazioni ricalcolate`);
});

document.getElementById('csv-dropzone').addEventListener('click', () => document.getElementById('csv-file').click());
document.getElementById('csv-file').addEventListener('change', (e) => {
  if (e.target.files[0]) handleCsvFile(e.target.files[0]);
});
['dragover', 'dragenter'].forEach(evt => {
  document.getElementById('csv-dropzone').addEventListener(evt, (e) => { e.preventDefault(); document.getElementById('csv-dropzone').classList.add('drag'); });
});
['dragleave', 'drop'].forEach(evt => {
  document.getElementById('csv-dropzone').addEventListener(evt, (e) => { e.preventDefault(); document.getElementById('csv-dropzone').classList.remove('drag'); });
});
document.getElementById('csv-dropzone').addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleCsvFile(file);
});

function renderCsvMap(forcedMapping) {
  document.getElementById('csv-map-area').style.display = 'block';
  const grid = document.getElementById('csv-map-grid');
  grid.innerHTML = csvHeaders.map((h, idx) => {
    const guessed = forcedMapping ? (forcedMapping[idx] || '') : guessMapping(h);
    return `
    <div class="csv-map-row">
      <label>${h}</label>
      <select class="csv-map-select" data-col="${idx}">
        ${CSV_TARGET_FIELDS.map(f => `<option value="${f.key}" ${guessed === f.key ? 'selected' : ''}>${f.label}</option>`).join('')}
      </select>
    </div>
  `;
  }).join('');
  document.getElementById('csv-preview-info').textContent = `${csvRows.length} righe trovate. Verifica la mappatura prima di importare.`;
  document.getElementById('csv-preview-head').innerHTML = csvHeaders.map(h => `<th class="txt">${h}</th>`).join('');
  document.getElementById('csv-preview-body').innerHTML = csvRows.slice(0, 5).map(r => `<tr>${r.map(c => `<td class="txt">${c}</td>`).join('')}</tr>`).join('');
}

document.getElementById('btn-cancel-import').addEventListener('click', () => {
  csvRows = []; csvHeaders = [];
  document.getElementById('csv-map-area').style.display = 'none';
  document.getElementById('csv-file').value = '';
});

document.getElementById('btn-confirm-import').addEventListener('click', () => {
  // Se ci sono già operazioni o movimenti importati in precedenza, chiediamo come
  // procedere: molti export (MetaTrader/FTMO) contengono SEMPRE lo storico
  // completo del conto, quindi ri-importarli in "aggiunta" creerebbe duplicati.
  const hasPreviousImport = STATE.trades.some(t => t.source === 'import') || STATE.movements.some(m => m.source === 'import');
  if (!hasPreviousImport) { runCsvImport('append'); return; }

  openModal(`
    <h3>Come vuoi importare questo file?</h3>
    <p>Risultano già operazioni e/o movimenti importati in precedenza.</p>
    <p>Se questo file è un export <b>completo</b> dello storico del conto (es. report MetaTrader/FTMO aggiornato), scegli <b>Sostituisci</b>: evita di duplicare operazioni e depositi/prelievi già presenti. Se invece contiene <b>solo</b> dati nuovi mai importati prima, scegli <b>Aggiungi</b>.</p>
    <div class="modal-actions" style="flex-direction:column; gap:8px; margin-top:16px;">
      <button class="btn btn-primary" id="import-mode-replace" style="width:100%;">Sostituisci import precedenti</button>
      <button class="btn btn-ghost" id="import-mode-append" style="width:100%;">Aggiungi ai dati esistenti</button>
      <button class="btn btn-ghost" id="import-mode-cancel" style="width:100%;">Annulla</button>
    </div>
    <p style="font-size:12px; color:var(--text-dim); margin-top:12px;">"Sostituisci" rimuove solo le operazioni e i movimenti importati da file in precedenza: i trade e i movimenti inseriti a mano non vengono toccati.</p>
  `);
  document.getElementById('import-mode-replace').onclick = () => { closeModal(); runCsvImport('replace'); };
  document.getElementById('import-mode-append').onclick = () => { closeModal(); runCsvImport('append'); };
  document.getElementById('import-mode-cancel').onclick = () => { closeModal(); };
});

async function runCsvImport(mode) {
  const mapping = Array.from(document.querySelectorAll('.csv-map-select')).map(s => s.value);

  // Ricorda la mappatura scelta a mano per file con la stessa identica
  // intestazione (es. lo stesso export di un exchange non ancora riconosciuto
  // automaticamente), così i prossimi import non richiedono di rimappare tutto.
  if (!csvAutoDetected && csvHeaders.length) {
    STATE.csvMappings[csvHeaderSignature(csvHeaders)] = mapping;
  }

  // Capitale iniziale: non è un campo per-trade, va preso una sola volta dalla
  // prima riga del CSV che ha un valore valido nella colonna mappata.
  const capitalColIdx = mapping.indexOf('initialCapital');
  let importedCapital = null;
  if (capitalColIdx !== -1) {
    for (const row of csvRows) {
      const raw = row[capitalColIdx];
      if (!raw) continue;
      const parsed = parseFloat(String(raw).replace(',', '.'));
      if (!isNaN(parsed)) { importedCapital = parsed; break; }
    }
  }

  // Righe di tipo "balance" (depositi/prelievi, come li scrive MetaTrader nello
  // storico insieme ai trade) vanno riconosciute dalla colonna mappata su "direzione"
  // e smistate come movimenti di conto, non come trade.
  const directionColIdx = mapping.indexOf('direction');
  const profitColIdx = mapping.indexOf('profit');
  const openDateColIdx = mapping.indexOf('openDate');
  const closeDateColIdx = mapping.indexOf('closeDate');
  const notesColIdx = mapping.indexOf('notes');
  const isBalanceRow = (row) => directionColIdx !== -1 && /^(balance|saldo|deposit|prelievo|withdraw)/i.test((row[directionColIdx] || '').trim());

  if (mode === 'replace') {
    STATE.trades = STATE.trades.filter(t => t.source !== 'import');
    STATE.movements = STATE.movements.filter(m => m.source !== 'import');
  }

  let imported = 0;
  let importedMovements = 0;
  csvRows.forEach(row => {
    if (isBalanceRow(row)) {
      const rawAmount = profitColIdx !== -1 ? row[profitColIdx] : '';
      const amount = parseFloat(String(rawAmount).replace(',', '.'));
      if (isNaN(amount) || amount === 0) return; // niente importo utilizzabile, riga saltata
      const rawDate = (closeDateColIdx !== -1 && row[closeDateColIdx]) ? row[closeDateColIdx] : (openDateColIdx !== -1 ? row[openDateColIdx] : '');
      const d = parseFlexibleDate(rawDate);
      STATE.movements.push({
        id: uid(),
        type: amount >= 0 ? 'DEPOSIT' : 'WITHDRAW',
        amount: Math.abs(amount),
        date: (d ? d : new Date()).toISOString(),
        note: notesColIdx !== -1 ? (row[notesColIdx] || '') : '',
        source: 'import',
      });
      importedMovements++;
      return;
    }
    const t = { id: uid(), status: 'CLOSED', direction: 'BUY', flag: '', link1: '', link2: '', checklist: {}, source: 'import' };
    mapping.forEach((key, idx) => {
      if (!key || key === 'initialCapital') return;
      const val = row[idx];
      if (!val) return;
      if (['lots', 'entryPrice', 'exitPrice', 'slPrice', 'tpPrice', 'profit'].includes(key)) {
        t[key] = parseFloat(val.replace(',', '.')) || null;
      } else if (key === 'openDate' || key === 'closeDate') {
        const d = parseFlexibleDate(val);
        t[key] = d ? d.toISOString() : null;
      } else if (key === 'direction') {
        t.direction = /sell|short|vend/i.test(val) ? 'SELL' : 'BUY';
      } else {
        t[key] = val;
      }
    });
    if (!t.instrument) return;
    if (t.profit === undefined || t.profit === null) {
      const computed = calcTradeProfit(t);
      if (computed !== null) t.profit = computed;
    }
    STATE.trades.push(t);
    imported++;
  });

  if (importedCapital !== null) {
    STATE.settings.initialCapital = importedCapital;
    const cf = document.getElementById('f-initial-capital');
    if (cf) cf.value = importedCapital;
  }

  await Storage.save(STATE);
  csvRows = []; csvHeaders = [];
  document.getElementById('csv-map-area').style.display = 'none';
  document.getElementById('csv-file').value = '';
  const parts = [`${imported} operazioni importate`];
  if (importedMovements) parts.push(`${importedMovements} movimenti (depositi/prelievi) importati`);
  if (importedCapital !== null) parts.push(`capitale iniziale aggiornato a ${fmtMoney(importedCapital)}`);
  if (mode === 'replace') parts.push('import precedenti sostituiti');
  toast(parts.join(' · '));
  showView('registro');
}

/* ---------------- rendering: changelog ---------------- */

function renderChangelog() {
  document.getElementById('changelog-list').innerHTML = CHANGELOG.slice().reverse().map(c => `
    <div>
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
        <span class="tag mono">v${c.version}</span>
        <span style="font-size:11.5px; color:var(--text-faint);">${fmtDate(c.date)}</span>
      </div>
      <ul style="margin:0; padding-left:18px; display:flex; flex-direction:column; gap:4px;">
        ${c.notes.map(n => `<li style="font-size:12.5px; color:var(--text-dim);">${n}</li>`).join('')}
      </ul>
    </div>
  `).join('');
}

/* ---------------- rendering: strumenti ---------------- */

function renderStrumenti() {
  const cats = Array.from(new Set(STATE.instruments.map(i => i.category))).sort();
  const catSelect = document.getElementById('filter-instr-category');
  const prevCat = catSelect.value;
  catSelect.innerHTML = `<option value="">Tutte le categorie</option>` + cats.map(c => `<option value="${c}" ${c===prevCat?'selected':''}>${c}</option>`).join('');

  const search = document.getElementById('filter-instr-search').value.trim().toLowerCase();
  const cat = catSelect.value;
  const rows = STATE.instruments
    .filter(i => (!cat || i.category === cat) && (!search || i.name.toLowerCase().includes(search)))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  document.querySelector('#view-strumenti .page-sub').textContent =
    `${STATE.instruments.length} strumenti in anagrafica · pip/tick, valore e dimensione lotto per il calcolo automatico del profitto`;

  const tbody = document.getElementById('tbl-instruments');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="txt" style="text-align:center; color:var(--text-faint); padding:24px;">Nessuno strumento trovato</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(i => `
    <tr>
      <td class="txt" style="font-weight:600;">${i.name}</td>
      <td class="txt"><span class="tag">${i.category}</span></td>
      <td class="txt">${i.currency}</td>
      <td>${i.pipSize}</td>
      <td>${fmtMoney(i.pipValue)}</td>
      <td>${fmtNum(i.contractSize, 0)}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" title="Modifica" onclick="editInstrument('${i.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="icon-btn" title="Elimina" onclick="confirmDeleteInstrument('${i.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

document.getElementById('filter-instr-search').addEventListener('input', renderStrumenti);
document.getElementById('filter-instr-category').addEventListener('change', renderStrumenti);

/* ---------------- navigation ---------------- */

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'dashboard') renderDashboard();
  if (name === 'registro') renderRegistro();
  if (name === 'conto') renderConto();
  if (name === 'strumenti') renderStrumenti();
  if (name === 'aperte') renderAperte();
  if (name === 'strategie') renderStrategie();
  if (name === 'calcolatore') renderCalcolatore();
  if (name === 'import') renderCsvRepairBox();
  if (name === 'changelog') renderChangelog();
  window.scrollTo(0, 0);
}

document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});
document.querySelectorAll('[data-goto]').forEach(btn => {
  btn.addEventListener('click', () => { resetTradeForm(); showView(btn.dataset.goto); });
});

/* ---------------- trade form ---------------- */

let editingTradeId = null;
let currentChecklistState = {};

function resetTradeForm() {
  editingTradeId = null;
  currentChecklistState = {};
  document.getElementById('trade-form-title').textContent = 'Nuovo trade';
  document.getElementById('trade-form').reset();
  setSeg('seg-direction', 'BUY');
  setSeg('seg-status', 'CLOSED');
  document.getElementById('f-open-date').value = toDatetimeLocal(new Date());
  document.getElementById('f-close-date').value = toDatetimeLocal(new Date());
  document.getElementById('f-r-display').value = '';
  setFlagSwatch('');
  toggleCurrentPriceField();
  updateChecklistBox();
}

function setSeg(segId, val) {
  const seg = document.getElementById(segId);
  seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.val === val));
  seg.dataset.value = val;
}
document.querySelectorAll('.seg').forEach(seg => {
  seg.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    setSeg(seg.id, btn.dataset.val);
    if (seg.id === 'seg-status') toggleCurrentPriceField();
  });
});

function toggleCurrentPriceField() {
  const status = document.getElementById('seg-status').dataset.value;
  document.getElementById('f-current-price-wrap').style.display = status === 'OPEN' ? 'flex' : 'none';
}

function setFlagSwatch(val) {
  const wrap = document.getElementById('f-flag-swatches');
  wrap.dataset.value = val;
  wrap.querySelectorAll('.flag-swatch').forEach(el => el.classList.toggle('on', el.dataset.val === val));
}
document.getElementById('f-flag-swatches').addEventListener('click', e => {
  const el = e.target.closest('.flag-swatch');
  if (!el) return;
  setFlagSwatch(el.dataset.val);
});

document.getElementById('btn-calc-profit').addEventListener('click', () => {
  const t = readTradeForm();
  const profit = calcTradeProfit(t);
  if (profit === null) { toast('Servono strumento, prezzi e lotti per calcolare', true); return; }
  document.getElementById('f-profit').value = profit.toFixed(2);
  updateRDisplay();
  toast('Profitto calcolato');
});

['f-entry', 'f-exit', 'f-sl', 'f-lots', 'f-profit', 'f-instrument'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateRDisplay);
  document.getElementById(id).addEventListener('change', updateRDisplay);
});

document.getElementById('f-strategy').addEventListener('input', updateChecklistBox);
document.getElementById('f-strategy').addEventListener('change', updateChecklistBox);

function updateChecklistBox() {
  const name = document.getElementById('f-strategy').value.trim();
  const strat = STATE.strategies.find(s => s.name.toLowerCase() === name.toLowerCase());
  const box = document.getElementById('f-checklist-box');
  if (!strat || !strat.checklist || !strat.checklist.length) {
    box.innerHTML = `<div class="checklist-empty">Nessuna checklist per questa strategia. Selezionane una definita in "Strategie" per vederla qui.</div>`;
    return;
  }
  box.innerHTML = strat.checklist.map((c, idx) => `
    <label class="checklist-item">
      <input type="checkbox" class="f-checklist-cb" data-idx="${idx}" ${currentChecklistState[idx] ? 'checked' : ''}>
      ${c}
    </label>
  `).join('');
  box.querySelectorAll('.f-checklist-cb').forEach(cb => {
    cb.addEventListener('change', () => { currentChecklistState[cb.dataset.idx] = cb.checked; });
  });
}

function updateRDisplay() {
  const t = readTradeForm();
  const r = calcTradeR(t);
  document.getElementById('f-r-display').value = r !== null && isFinite(r) ? fmtNum(r, 2) + 'R' : '';
}

function readTradeForm() {
  return {
    direction: document.getElementById('seg-direction').dataset.value || 'BUY',
    status: document.getElementById('seg-status').dataset.value || 'CLOSED',
    instrument: document.getElementById('f-instrument').value,
    openDate: document.getElementById('f-open-date').value ? new Date(document.getElementById('f-open-date').value).toISOString() : null,
    closeDate: document.getElementById('f-close-date').value ? new Date(document.getElementById('f-close-date').value).toISOString() : null,
    lots: parseFloat(document.getElementById('f-lots').value) || null,
    entryPrice: parseFloat(document.getElementById('f-entry').value) || null,
    exitPrice: parseFloat(document.getElementById('f-exit').value) || null,
    slPrice: parseFloat(document.getElementById('f-sl').value) || null,
    tpPrice: parseFloat(document.getElementById('f-tp').value) || null,
    currentPrice: parseFloat(document.getElementById('f-current-price').value) || null,
    strategy: document.getElementById('f-strategy').value.trim(),
    riskPct: parseFloat(document.getElementById('f-risk-pct').value) || null,
    profit: document.getElementById('f-profit').value !== '' ? parseFloat(document.getElementById('f-profit').value) : null,
    flag: document.getElementById('f-flag-swatches').dataset.value || '',
    link1: document.getElementById('f-link1').value.trim(),
    link2: document.getElementById('f-link2').value.trim(),
    checklist: { ...currentChecklistState },
    notes: document.getElementById('f-notes').value.trim(),
  };
}

function fillTradeForm(t) {
  setSeg('seg-direction', t.direction);
  setSeg('seg-status', t.status);
  toggleCurrentPriceField();
  document.getElementById('f-instrument').value = t.instrument;
  document.getElementById('f-open-date').value = toDatetimeLocal(t.openDate);
  document.getElementById('f-close-date').value = toDatetimeLocal(t.closeDate);
  document.getElementById('f-lots').value = t.lots ?? '';
  document.getElementById('f-entry').value = t.entryPrice ?? '';
  document.getElementById('f-exit').value = t.exitPrice ?? '';
  document.getElementById('f-sl').value = t.slPrice ?? '';
  document.getElementById('f-tp').value = t.tpPrice ?? '';
  document.getElementById('f-current-price').value = t.currentPrice ?? '';
  document.getElementById('f-strategy').value = t.strategy || '';
  document.getElementById('f-risk-pct').value = t.riskPct ?? '';
  document.getElementById('f-profit').value = (t.profit ?? '') === null ? '' : t.profit;
  document.getElementById('f-link1').value = t.link1 || '';
  document.getElementById('f-link2').value = t.link2 || '';
  document.getElementById('f-notes').value = t.notes || '';
  setFlagSwatch(t.flag || '');
  currentChecklistState = { ...(t.checklist || {}) };
  updateChecklistBox();
  updateRDisplay();
}

document.getElementById('trade-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = readTradeForm();
  if (!data.instrument) { toast('Seleziona uno strumento', true); return; }
  // auto-calc profit if the user filled prices/lots but never hit "Calcola profitto"
  // or typed a value by hand — otherwise a CLOSED trade with no profit is invisible
  // to every dashboard stat (win rate, P&L, equity, drawdown).
  if (data.status === 'CLOSED' && (data.profit === null || data.profit === undefined)) {
    const computed = calcTradeProfit(data);
    if (computed !== null) data.profit = computed;
  }
  if (editingTradeId) {
    const idx = STATE.trades.findIndex(t => t.id === editingTradeId);
    STATE.trades[idx] = { ...STATE.trades[idx], ...data };
    toast('Trade aggiornato');
  } else {
    STATE.trades.push({ id: uid(), ...data });
    toast('Trade salvato');
  }
  await Storage.save(STATE);
  resetTradeForm();
  showView('registro');
});

document.getElementById('btn-cancel-trade').addEventListener('click', () => {
  resetTradeForm();
  showView('registro');
});

window.editTrade = function (id) {
  const t = STATE.trades.find(x => x.id === id);
  if (!t) return;
  editingTradeId = id;
  document.getElementById('trade-form-title').textContent = 'Modifica trade';
  fillTradeForm(t);
  showView('trade-form');
};

/* ---------------- delete confirmations ---------------- */

function openModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-backdrop').classList.add('active');
}
function closeModal() {
  document.getElementById('modal-backdrop').classList.remove('active');
}
document.getElementById('modal-backdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modal-backdrop') closeModal();
});

window.confirmDeleteTrade = function (id) {
  openModal(`
    <h3>Eliminare il trade?</h3>
    <p>L'operazione verrà rimossa definitivamente dal registro. Questa azione non può essere annullata.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Annulla</button>
      <button class="btn btn-danger" id="confirm-del-trade">Elimina</button>
    </div>
  `);
  document.getElementById('confirm-del-trade').onclick = async () => {
    STATE.trades = STATE.trades.filter(t => t.id !== id);
    await Storage.save(STATE);
    closeModal();
    renderRegistro();
    toast('Trade eliminato');
  };
};

window.confirmDeleteMovement = function (id) {
  openModal(`
    <h3>Eliminare il movimento?</h3>
    <p>Il movimento verrà rimosso e il capitale ricalcolato di conseguenza.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Annulla</button>
      <button class="btn btn-danger" id="confirm-del-mov">Elimina</button>
    </div>
  `);
  document.getElementById('confirm-del-mov').onclick = async () => {
    STATE.movements = STATE.movements.filter(m => m.id !== id);
    await Storage.save(STATE);
    closeModal();
    renderConto();
    toast('Movimento eliminato');
  };
};

window.confirmDeleteInstrument = function (id) {
  openModal(`
    <h3>Eliminare lo strumento?</h3>
    <p>I trade esistenti che lo referenziano manterranno i dati ma non potranno più ricalcolare automaticamente il profitto.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Annulla</button>
      <button class="btn btn-danger" id="confirm-del-instr">Elimina</button>
    </div>
  `);
  document.getElementById('confirm-del-instr').onclick = async () => {
    STATE.instruments = STATE.instruments.filter(i => i.id !== id);
    await Storage.save(STATE);
    closeModal();
    renderStrumenti();
    populateInstrumentSelects();
    toast('Strumento eliminato');
  };
};

/* ---------------- conto: capital + movements ---------------- */

document.getElementById('btn-save-capital').addEventListener('click', async () => {
  STATE.settings.initialCapital = parseFloat(document.getElementById('f-initial-capital').value) || 0;
  STATE.settings.currency = document.getElementById('f-currency').value;
  await Storage.save(STATE);
  updateCurrencySymbols();
  renderConto();
  toast('Capitale aggiornato');
});

document.getElementById('btn-add-movement').addEventListener('click', () => {
  openModal(`
    <h3>Nuovo movimento</h3>
    <p>Registra un deposito o un prelievo dal conto.</p>
    <div style="display:flex; flex-direction:column; gap:12px;">
      <div class="field">
        <label>Tipo</label>
        <div class="seg" id="modal-seg-type">
          <button type="button" class="on buy" data-val="DEPOSIT">Deposito</button>
          <button type="button" class="sell" data-val="WITHDRAW">Prelievo</button>
        </div>
      </div>
      <div class="field">
        <label>Importo</label>
        <input type="number" step="any" id="modal-mov-amount" placeholder="0.00">
      </div>
      <div class="field">
        <label>Data</label>
        <input type="date" id="modal-mov-date" value="${new Date().toISOString().slice(0,10)}">
      </div>
      <div class="field">
        <label>Note</label>
        <input type="text" id="modal-mov-note" placeholder="opzionale">
      </div>
    </div>
    <div class="modal-actions" style="margin-top:18px;">
      <button class="btn btn-ghost" onclick="closeModal()">Annulla</button>
      <button class="btn btn-primary" id="confirm-add-mov">Salva movimento</button>
    </div>
  `);
  document.getElementById('modal-seg-type').addEventListener('click', e => {
    const btn = e.target.closest('button'); if (!btn) return;
    setSeg('modal-seg-type', btn.dataset.val);
  });
  setSeg('modal-seg-type', 'DEPOSIT');
  document.getElementById('confirm-add-mov').onclick = async () => {
    const amount = parseFloat(document.getElementById('modal-mov-amount').value);
    if (!amount || amount <= 0) { toast('Inserisci un importo valido', true); return; }
    STATE.movements.push({
      id: uid(),
      type: document.getElementById('modal-seg-type').dataset.value,
      amount,
      date: document.getElementById('modal-mov-date').value || new Date().toISOString(),
      note: document.getElementById('modal-mov-note').value.trim(),
    });
    await Storage.save(STATE);
    closeModal();
    renderConto();
    toast('Movimento registrato');
  };
});

/* ---------------- strumenti CRUD ---------------- */

function instrumentModalHtml(existing) {
  const i = existing || { name: '', category: 'Forex', currency: 'EUR', pipSize: 0.0001, pipValue: 10, contractSize: 100000 };
  return `
    <h3>${existing ? 'Modifica strumento' : 'Nuovo strumento'}</h3>
    <p>Definisci i parametri per il calcolo automatico del profitto.</p>
    <div style="display:flex; flex-direction:column; gap:12px;">
      <div class="field"><label>Nome (es. EURUSD)</label><input type="text" id="modal-i-name" value="${i.name}"></div>
      <div class="field"><label>Categoria</label>
        <select id="modal-i-category">
          <option ${i.category==='Forex'?'selected':''}>Forex</option>
          <option ${i.category==='Metalli'?'selected':''}>Metalli</option>
          <option ${i.category==='Indici'?'selected':''}>Indici</option>
          <option ${i.category==='Materie prime'?'selected':''}>Materie prime</option>
          <option ${i.category==='Crypto'?'selected':''}>Crypto</option>
          <option ${i.category==='Future'?'selected':''}>Future</option>
          <option ${i.category==='CFD'?'selected':''}>CFD</option>
          <option ${i.category==='Azioni'?'selected':''}>Azioni</option>
        </select>
      </div>
      <div class="field"><label>Valuta</label><input type="text" id="modal-i-currency" value="${i.currency}"></div>
      <div class="field"><label>Dimensione 1 pip/tick (in prezzo)</label><input type="number" step="any" id="modal-i-pipsize" value="${i.pipSize}"></div>
      <div class="field"><label>Valore per 1 lotto per pip/tick</label><input type="number" step="any" id="modal-i-pipvalue" value="${i.pipValue}"></div>
      <div class="field"><label>Dimensione contratto (1 lotto = )</label><input type="number" step="any" id="modal-i-contract" value="${i.contractSize}"></div>
    </div>
    <div class="modal-actions" style="margin-top:18px;">
      <button class="btn btn-ghost" onclick="closeModal()">Annulla</button>
      <button class="btn btn-primary" id="confirm-save-instr">Salva</button>
    </div>
  `;
}

document.getElementById('btn-add-instrument').addEventListener('click', () => {
  openModal(instrumentModalHtml(null));
  document.getElementById('confirm-save-instr').onclick = async () => {
    const name = document.getElementById('modal-i-name').value.trim().toUpperCase();
    if (!name) { toast('Inserisci un nome', true); return; }
    STATE.instruments.push({
      id: uid(), name,
      category: document.getElementById('modal-i-category').value,
      currency: document.getElementById('modal-i-currency').value.trim().toUpperCase() || 'EUR',
      pipSize: parseFloat(document.getElementById('modal-i-pipsize').value) || 0.0001,
      pipValue: parseFloat(document.getElementById('modal-i-pipvalue').value) || 10,
      contractSize: parseFloat(document.getElementById('modal-i-contract').value) || 100000,
    });
    await Storage.save(STATE);
    closeModal();
    renderStrumenti();
    populateInstrumentSelects();
    toast('Strumento aggiunto');
  };
});

window.editInstrument = function (id) {
  const i = STATE.instruments.find(x => x.id === id);
  if (!i) return;
  openModal(instrumentModalHtml(i));
  document.getElementById('confirm-save-instr').onclick = async () => {
    i.name = document.getElementById('modal-i-name').value.trim().toUpperCase() || i.name;
    i.category = document.getElementById('modal-i-category').value;
    i.currency = document.getElementById('modal-i-currency').value.trim().toUpperCase() || i.currency;
    i.pipSize = parseFloat(document.getElementById('modal-i-pipsize').value) || i.pipSize;
    i.pipValue = parseFloat(document.getElementById('modal-i-pipvalue').value) || i.pipValue;
    i.contractSize = parseFloat(document.getElementById('modal-i-contract').value) || i.contractSize;
    await Storage.save(STATE);
    closeModal();
    renderStrumenti();
    populateInstrumentSelects();
    toast('Strumento aggiornato');
  };
};

/* ---------------- registro filters ---------------- */

['filter-search', 'filter-instrument', 'filter-status', 'filter-outcome', 'filter-strategy'].forEach(id => {
  document.getElementById(id).addEventListener('input', renderRegistro);
  document.getElementById(id).addEventListener('change', renderRegistro);
});

/* ---------------- PDF export (via browser print) ---------------- */

function printHeaderHtml(title, subtitle) {
  const now = new Date();
  return `
    <div class="pr-header">
      <div class="pr-brand">
        <img src="data:image/png;base64,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" alt="TradeJournalist" style="height:20px;width:auto;">
        TRADEJOURNALIST
      </div>
      <div class="pr-meta">
        Generato il ${now.toLocaleDateString('it-IT')} alle ${now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}<br>
        Capitale attuale: ${fmtMoney(currentCapital())}
      </div>
    </div>
    <div class="pr-title">${title}</div>
    ${subtitle ? `<div class="pr-subtitle">${subtitle}</div>` : ''}
  `;
}

function printFooterHtml() {
  return `<div class="pr-foot">JOURNAL — Trading Journal · Report generato automaticamente · Dati salvati localmente</div>`;
}

function doPrint(html) {
  document.getElementById('print-area').innerHTML = html;
  setTimeout(() => window.print(), 60);
}

function exportDashboardPdf() {
  const cap = currentCapital();
  const pl = totalPL();
  const stats = winRateStats(closedTrades());
  const rr = avgR(closedTrades());
  const ddDay = maxDrawdown('day');

  let chartImg = '';
  try {
    if (CHARTS.equity && CHARTS.equity.toBase64Image) {
      chartImg = `<img class="pr-chart-img" src="${CHARTS.equity.toBase64Image('image/png', 1)}">`;
    }
  } catch (e) { /* chart not ready, skip image */ }

  const kpis = [
    { label: 'Capitale attuale', value: fmtLevelOrPercent(cap) },
    { label: 'P&L totale', value: fmtMoneyOrPercent(pl, { signed: true }), cls: pl > 0 ? 'pos' : (pl < 0 ? 'neg' : '') },
    { label: 'Win rate', value: stats.total ? fmtPct(stats.rate) : '—' },
    { label: 'R:R medio', value: rr !== null ? fmtNum(rr, 2) + 'R' : '—' },
    { label: 'Drawdown max (gg)', value: fmtPct(ddDay), cls: ddDay > 0 ? 'neg' : '' },
    { label: 'Trade totali', value: String(STATE.trades.length) },
  ];

  const instrRows = perInstrumentStats();
  const stratRows = perStrategyStats();

  const html = `
    ${printHeaderHtml('Report performance', 'Sintesi generale del conto e delle operazioni')}
    <div class="pr-kpi-row">
      ${kpis.map(k => `<div class="pr-kpi"><div class="pr-kpi-label">${k.label}</div><div class="pr-kpi-value ${k.cls || ''}">${k.value}</div></div>`).join('')}
    </div>
    ${chartImg ? `<div class="pr-section-title">Equity line</div>${chartImg}` : ''}
    <div class="pr-section-title">Performance per strumento</div>
    <table class="pr-table">
      <thead><tr><th>Strumento</th><th>N° op.</th><th>Win rate</th><th>Stop</th><th>Profit</th><th>BE</th><th>Rendimento</th><th>R:R medio</th></tr></thead>
      <tbody>
        ${instrRows.length ? instrRows.map(r => `
          <tr>
            <td class="txt">${r.name}</td><td>${r.n}</td><td>${r.winRate !== null ? fmtPct(r.winRate) : '—'}</td>
            <td>${r.stop}</td><td>${r.profit}</td><td>${r.be}</td>
            <td class="${r.rendimento > 0 ? 'pr-pos' : (r.rendimento < 0 ? 'pr-neg' : '')}">${fmtMoneyOrPercent(r.rendimento, { signed: true })}</td>
            <td>${r.rr !== null ? fmtNum(r.rr, 2) + 'R' : '—'}</td>
          </tr>`).join('') : `<tr><td colspan="8" class="txt" style="text-align:center; color:#999;">Nessuna operazione chiusa</td></tr>`}
      </tbody>
    </table>
    ${stratRows.length ? `
    <div class="pr-section-title">Performance per strategia</div>
    <table class="pr-table">
      <thead><tr><th>Strategia</th><th>N° op.</th><th>Win rate</th><th>Rendimento</th><th>R:R medio</th></tr></thead>
      <tbody>
        ${stratRows.map(r => `
          <tr>
            <td class="txt">${r.name}</td><td>${r.n}</td><td>${r.winRate !== null ? fmtPct(r.winRate) : '—'}</td>
            <td class="${r.rendimento > 0 ? 'pr-pos' : (r.rendimento < 0 ? 'pr-neg' : '')}">${fmtMoneyOrPercent(r.rendimento, { signed: true })}</td>
            <td>${r.rr !== null ? fmtNum(r.rr, 2) + 'R' : '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : ''}
    ${printFooterHtml()}
  `;
  doPrint(html);
}

function exportRegistroPdf() {
  const trades = getFilteredTrades();
  const html = `
    ${printHeaderHtml('Registro operazioni', `${trades.length} operazion${trades.length === 1 ? 'e' : 'i'} · filtri correnti applicati`)}
    <table class="pr-table">
      <thead><tr>
        <th>Data</th><th>Strumento</th><th>Dir.</th><th>Lotti</th><th>Entry</th><th>Exit</th><th>SL</th><th>TP</th><th>R</th><th>Profitto</th><th>Stato</th><th>Strategia</th>
      </tr></thead>
      <tbody>
        ${trades.length ? trades.map(t => {
          const r = calcTradeR(t);
          const plCls = t.profit > 0 ? 'pr-pos' : (t.profit < 0 ? 'pr-neg' : '');
          return `
          <tr>
            <td>${fmtDate(t.openDate)}</td>
            <td class="txt">${t.instrument}</td>
            <td class="txt">${t.direction}</td>
            <td>${fmtNum(t.lots, 2)}</td>
            <td>${t.entryPrice ?? '—'}</td>
            <td>${t.exitPrice ?? '—'}</td>
            <td>${t.slPrice ?? '—'}</td>
            <td>${t.tpPrice ?? '—'}</td>
            <td>${r !== null ? fmtNum(r, 2) + 'R' : '—'}</td>
            <td class="${plCls}">${t.profit !== null && t.profit !== undefined ? fmtMoneyOrPercent(t.profit, { signed: true }) : '—'}</td>
            <td class="txt">${t.status === 'OPEN' ? 'Aperta' : 'Chiusa'}</td>
            <td class="txt">${t.strategy || '—'}</td>
          </tr>`;
        }).join('') : `<tr><td colspan="12" class="txt" style="text-align:center; color:#999;">Nessuna operazione</td></tr>`}
      </tbody>
    </table>
    ${printFooterHtml()}
  `;
  doPrint(html);
}

function exportApertePdf() {
  const open = STATE.trades.filter(t => t.status === 'OPEN');
  const totalUnrealized = open.reduce((s, t) => s + (calcUnrealized(t) || 0), 0);
  const html = `
    ${printHeaderHtml('Posizioni aperte', `${open.length} posizioni · P&L non realizzato: ${fmtMoneyOrPercent(totalUnrealized, { signed: true })}`)}
    <table class="pr-table">
      <thead><tr>
        <th>Apertura</th><th>Strumento</th><th>Dir.</th><th>Lotti</th><th>Entry</th><th>Attuale</th><th>SL</th><th>TP</th><th>Giorni</th><th>P&amp;L non real.</th>
      </tr></thead>
      <tbody>
        ${open.length ? open.map(t => {
          const unreal = calcUnrealized(t);
          const cls = unreal > 0 ? 'pr-pos' : (unreal < 0 ? 'pr-neg' : '');
          return `
          <tr>
            <td>${fmtDate(t.openDate)}</td>
            <td class="txt">${t.instrument}</td>
            <td class="txt">${t.direction}</td>
            <td>${fmtNum(t.lots, 2)}</td>
            <td>${t.entryPrice ?? '—'}</td>
            <td>${t.currentPrice ?? '—'}</td>
            <td>${t.slPrice ?? '—'}</td>
            <td>${t.tpPrice ?? '—'}</td>
            <td>${daysOpen(t)}</td>
            <td class="${cls}">${unreal !== null ? fmtMoneyOrPercent(unreal, { signed: true }) : '—'}</td>
          </tr>`;
        }).join('') : `<tr><td colspan="10" class="txt" style="text-align:center; color:#999;">Nessuna posizione aperta</td></tr>`}
      </tbody>
    </table>
    ${printFooterHtml()}
  `;
  doPrint(html);
}

document.getElementById('btn-export-dashboard-pdf').addEventListener('click', exportDashboardPdf);
document.getElementById('btn-export-registro-pdf').addEventListener('click', exportRegistroPdf);

document.getElementById('btn-delete-all-trades').addEventListener('click', () => {
  const n = STATE.trades.length;
  if (!n) { toast('Non ci sono operazioni da eliminare'); return; }
  openModal(`
    <h3>Eliminare TUTTE le ${n} operazioni?</h3>
    <p>Verrà svuotato l'intero registro (trade chiusi e aperti). Il capitale, i movimenti e le impostazioni non vengono toccati. Questa azione non può essere annullata.</p>
    <p style="font-size:12.5px; color:var(--text-dim); margin-top:10px;">Per confermare, scrivi <b>${n}</b> nel campo qui sotto (il numero di operazioni attuali).</p>
    <input type="text" id="confirm-delete-all-input" placeholder="Scrivi ${n}" style="width:100%; margin-top:8px;">
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Annulla</button>
      <button class="btn btn-danger" id="confirm-delete-all-trades" disabled>Elimina tutte</button>
    </div>
  `);
  const input = document.getElementById('confirm-delete-all-input');
  const confirmBtn = document.getElementById('confirm-delete-all-trades');
  input.addEventListener('input', () => {
    confirmBtn.disabled = input.value.trim() !== String(n);
  });
  input.focus();
  confirmBtn.onclick = async () => {
    if (input.value.trim() !== String(n)) return;
    STATE.trades = [];
    await Storage.save(STATE);
    closeModal();
    renderRegistro();
    renderCsvRepairBox();
    document.getElementById('badge-open').textContent = '0';
    toast(`${n} operazioni eliminate`);
  };
});
document.getElementById('btn-export-aperte-pdf').addEventListener('click', exportApertePdf);

/* ---------------- multi-conto ---------------- */

// Backfill/normalizzazione dei campi dello STATE corrente (forward-compat
// con versioni precedenti dei dati salvati). Riusata sia in init() sia
// ogni volta che si cambia conto o se ne crea uno nuovo.
function normalizeState() {
  STATE.settings = { ...defaultState().settings, ...STATE.settings };
  if (!STATE.instruments || !STATE.instruments.length) STATE.instruments = defaultInstruments();
  if (!STATE.strategies) STATE.strategies = [];
  if (!STATE.trades) STATE.trades = [];
  if (!STATE.movements) STATE.movements = [];
  if (!STATE.csvMappings) STATE.csvMappings = {};

  // migrate: add newly-introduced default instruments that aren't already present,
  // without touching user edits to existing ones
  const existingNames = new Set(STATE.instruments.map(i => i.name.toUpperCase()));
  const missing = defaultInstruments().filter(i => !existingNames.has(i.name.toUpperCase()));
  if (missing.length) {
    STATE.instruments = STATE.instruments.concat(missing);
  }
  return missing.length > 0;
}

function renderAccountSwitcher() {
  const sel = document.getElementById('account-switcher');
  if (!sel) return;
  sel.innerHTML = ACCOUNTS.map(a => `<option value="${a.id}">${a.name.replace(/</g, '&lt;')}</option>`).join('');
  sel.value = CURRENT_ACCOUNT_ID;
}

async function switchAccount(id) {
  if (!id || id === CURRENT_ACCOUNT_ID || !Storage._wrapperCache) return;
  // salva il conto corrente prima di passare al successivo
  await Storage.save(STATE);

  CURRENT_ACCOUNT_ID = id;
  const acc = Storage._wrapperCache.accounts[id];
  STATE = (acc && acc.state) || defaultState();
  normalizeState();

  populateInstrumentSelects();
  populateStrategyDatalist();
  resetTradeForm();
  renderDashboard();
  renderCsvRepairBox();
  document.getElementById('badge-open').textContent = String(openTrades().length);
  renderAccountSwitcher();
  showView('dashboard');
  await Storage.save(STATE);
}

async function createAccount() {
  const name = window.prompt('Nome del nuovo conto (es. "Bybit futures", "MT5 demo"):', '');
  if (name === null) return; // annullato
  const finalName = name.trim() || `Conto ${ACCOUNTS.length + 1}`;

  const id = newAccountId();
  if (!Storage._wrapperCache) Storage._wrapperCache = { currentAccountId: CURRENT_ACCOUNT_ID, accounts: {} };
  Storage._wrapperCache.accounts[id] = { name: finalName, state: defaultState() };
  ACCOUNTS.push({ id, name: finalName });

  CURRENT_ACCOUNT_ID = id;
  STATE = defaultState();
  normalizeState();

  populateInstrumentSelects();
  populateStrategyDatalist();
  resetTradeForm();
  renderDashboard();
  renderCsvRepairBox();
  document.getElementById('badge-open').textContent = String(openTrades().length);
  renderAccountSwitcher();
  showView('dashboard');
  await Storage.save(STATE);
  toast('Conto "' + finalName + '" creato.');
}

async function renameCurrentAccount() {
  const acc = ACCOUNTS.find(a => a.id === CURRENT_ACCOUNT_ID);
  if (!acc) return;
  const name = window.prompt('Nuovo nome per questo conto:', acc.name);
  if (name === null) return;
  const finalName = name.trim();
  if (!finalName) return;

  acc.name = finalName;
  if (Storage._wrapperCache && Storage._wrapperCache.accounts[CURRENT_ACCOUNT_ID]) {
    Storage._wrapperCache.accounts[CURRENT_ACCOUNT_ID].name = finalName;
  }
  await Storage._saveWrapper(Storage._wrapperCache);
  renderAccountSwitcher();
  toast('Conto rinominato.');
}

async function deleteCurrentAccount() {
  if (ACCOUNTS.length <= 1) {
    toast('Non puoi eliminare l\'unico conto rimasto.', true);
    return;
  }
  const acc = ACCOUNTS.find(a => a.id === CURRENT_ACCOUNT_ID);
  if (!acc) return;
  const first = window.confirm('Eliminare definitivamente il conto "' + acc.name + '" e tutti i suoi dati (trade, strategie, ecc.)? Questa azione non è reversibile.');
  if (!first) return;

  const idToDelete = CURRENT_ACCOUNT_ID;
  ACCOUNTS = ACCOUNTS.filter(a => a.id !== idToDelete);
  if (Storage._wrapperCache) delete Storage._wrapperCache.accounts[idToDelete];

  const nextId = ACCOUNTS[0].id;
  CURRENT_ACCOUNT_ID = nextId;
  const acc2 = Storage._wrapperCache && Storage._wrapperCache.accounts[nextId];
  STATE = (acc2 && acc2.state) || defaultState();
  normalizeState();

  if (Storage._wrapperCache) Storage._wrapperCache.currentAccountId = nextId;
  await Storage._saveWrapper(Storage._wrapperCache);

  populateInstrumentSelects();
  populateStrategyDatalist();
  resetTradeForm();
  renderDashboard();
  renderCsvRepairBox();
  document.getElementById('badge-open').textContent = String(openTrades().length);
  renderAccountSwitcher();
  showView('dashboard');
  toast('Conto eliminato.');
}

const accountSwitcherEl = document.getElementById('account-switcher');
if (accountSwitcherEl) accountSwitcherEl.addEventListener('change', (e) => switchAccount(e.target.value));
const accountNewLink = document.getElementById('account-new-link');
if (accountNewLink) accountNewLink.addEventListener('click', (e) => { e.preventDefault(); createAccount(); });
const accountRenameLink = document.getElementById('account-rename-link');
if (accountRenameLink) accountRenameLink.addEventListener('click', (e) => { e.preventDefault(); renameCurrentAccount(); });
const accountDeleteLink = document.getElementById('account-delete-link');
if (accountDeleteLink) accountDeleteLink.addEventListener('click', (e) => { e.preventDefault(); deleteCurrentAccount(); });

/* ---------------- dashboard: personalizzazione layout (righe esplicite + colonne) ----------------
   Il layout è un array di RIGHE, ognuna con la lista dei widget e la loro
   larghezza in "colonne" su una griglia di DASH_COLS colonne. Avere righe
   esplicite (invece di dedurle dal wrap del flexbox) rende affidabili sia il
   ridimensionamento — si sa sempre con certezza chi è il vicino nella riga —
   sia il riordino con auto-adattamento: quando un widget entra o esce da una
   riga, le colonne dei membri di quella riga vengono ridistribuite in automatico
   perché si adattino sempre esattamente allo spazio disponibile. ---------------- */

const DASH_LAYOUT_KEY = 'tj_dashboard_layout_v2';
const DASH_COLS = 12;
const DASH_MIN_SPAN = 3; // ~25% minimo, evita widget illeggibili
const DASH_MIN_HEIGHT = 160;
const DASH_MAX_HEIGHT = 900;

function dashboardWidgetEls() {
  return Array.from(document.querySelectorAll('#dashboard-grid .dash-widget'));
}

function widthPctToSpan(pct) {
  return Math.max(DASH_MIN_SPAN, Math.min(DASH_COLS, Math.round((pct / 100) * DASH_COLS)));
}

function dashboardDefaultLayout() {
  // raggruppa i widget nell'ordine dell'HTML in righe, sommando gli span finché
  // stanno in DASH_COLS: replica il comportamento "a capo" originale ma in modo esplicito
  const rows = [];
  let current = [];
  let currentSum = 0;
  dashboardWidgetEls().forEach(el => {
    const span = widthPctToSpan(parseInt(el.dataset.defaultWidth, 10) || 50);
    if (current.length && currentSum + span > DASH_COLS) {
      rows.push(current);
      current = [];
      currentSum = 0;
    }
    current.push({ id: el.dataset.widgetId, span, height: parseInt(el.dataset.defaultHeight, 10) || 260 });
    currentSum += span;
  });
  if (current.length) rows.push(current);
  return rows;
}

function loadDashboardLayout() {
  try {
    const raw = localStorage.getItem(DASH_LAYOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) { return null; }
}

function saveDashboardLayout() {
  const grid = document.getElementById('dashboard-grid');
  if (!grid) return;
  const rows = Array.from(grid.querySelectorAll('.dash-row')).map(rowEl =>
    Array.from(rowEl.querySelectorAll('.dash-widget')).map(el => ({
      id: el.dataset.widgetId,
      span: parseInt(el.dataset.span, 10) || DASH_COLS,
      height: Math.round(el.getBoundingClientRect().height) || 260,
    }))
  ).filter(r => r.length);
  try { localStorage.setItem(DASH_LAYOUT_KEY, JSON.stringify(rows)); } catch (e) { /* storage pieno/non disponibile: ignora */ }
}

function setWidgetSpan(el, span) {
  const s = Math.max(DASH_MIN_SPAN, Math.min(DASH_COLS, Math.round(span)));
  el.dataset.span = s;
  el.style.gridColumn = 'span ' + s;
  return s;
}

// (Ri)costruisce il DOM della dashboard a partire dal modello a righe.
// Sposta i widget esistenti (non li ricrea), quindi i listener già collegati
// alle maniglie di drag/resize restano validi dopo ogni ri-render.
function renderDashboardRows(rows) {
  const grid = document.getElementById('dashboard-grid');
  if (!grid) return;
  const byId = {};
  dashboardWidgetEls().forEach(el => { byId[el.dataset.widgetId] = el; });

  const known = new Set();
  rows.forEach(r => r.forEach(item => known.add(item.id)));
  const extraRows = [];
  Object.keys(byId).forEach(id => {
    if (!known.has(id)) {
      const el = byId[id];
      extraRows.push([{ id, span: widthPctToSpan(parseInt(el.dataset.defaultWidth, 10) || 100), height: parseInt(el.dataset.defaultHeight, 10) || 260 }]);
    }
  });
  const finalRows = rows.concat(extraRows).filter(r => r.length);

  grid.innerHTML = '';
  finalRows.forEach(row => {
    const rowEl = document.createElement('div');
    rowEl.className = 'dash-row';
    row.forEach(item => {
      const el = byId[item.id];
      if (!el) return;
      setWidgetSpan(el, item.span);
      el.style.height = (item.height || 260) + 'px';
      rowEl.appendChild(el);
    });
    if (rowEl.children.length) grid.appendChild(rowEl);
  });
}

function dashboardRowOf(widget) {
  return widget.closest('.dash-row');
}

// ridistribuisce in modo uniforme gli span dei widget di una riga, così che
// riempiano sempre le DASH_COLS colonne (usato quando un widget entra/esce dalla riga)
function redistributeRow(rowEl) {
  if (!rowEl || !rowEl.parentNode) return;
  const widgets = Array.from(rowEl.querySelectorAll('.dash-widget'));
  if (!widgets.length) { rowEl.remove(); return; }
  const base = Math.floor(DASH_COLS / widgets.length);
  const remainder = DASH_COLS - base * widgets.length;
  widgets.forEach((el, i) => setWidgetSpan(el, base + (i < remainder ? 1 : 0)));
}

function resizeChartIfNeeded(widgetId) {
  if (widgetId === 'bubbles') {
    try { renderBubbleChart(); } catch (e) { /* ignore */ }
    return;
  }
  const map = { equity: 'equity', outcome: 'outcome', monthly: 'monthly', drawdown: 'drawdown', weekday: 'weekday', r50: 'r50' };
  const key = map[widgetId];
  if (key && CHARTS[key]) {
    try { CHARTS[key].resize(); } catch (e) { /* ignore */ }
  }
}

function toggleDashboardEditMode() {
  const grid = document.getElementById('dashboard-grid');
  if (!grid) return;
  const editing = grid.classList.toggle('editing');
  const label = document.getElementById('dashboard-edit-btn-label');
  const btn = document.getElementById('btn-toggle-dashboard-edit');
  const hint = document.getElementById('dashboard-edit-hint');
  const resetBtn = document.getElementById('btn-reset-dashboard-layout');
  if (label) label.textContent = editing ? 'Fine personalizzazione' : 'Personalizza dashboard';
  if (btn) {
    btn.classList.toggle('btn-ghost', !editing);
    btn.classList.toggle('btn-primary', editing);
  }
  if (hint) hint.style.display = editing ? 'block' : 'none';
  if (resetBtn) resetBtn.style.display = editing ? 'inline-flex' : 'none';
}

function resetDashboardLayout() {
  if (!window.confirm('Ripristinare la disposizione predefinita della dashboard?')) return;
  try { localStorage.removeItem(DASH_LAYOUT_KEY); } catch (e) { /* ignore */ }
  renderDashboardRows(dashboardDefaultLayout());
  Object.keys(CHARTS).forEach(k => { try { CHARTS[k] && CHARTS[k].resize(); } catch (e) { /* ignore */ } });
  try { renderBubbleChart(); } catch (e) { /* ignore */ }
  toast('Layout ripristinato.');
}

function initDashboardCustomization() {
  const grid = document.getElementById('dashboard-grid');
  if (!grid) return;

  renderDashboardRows(loadDashboardLayout() || dashboardDefaultLayout());

  const editBtn = document.getElementById('btn-toggle-dashboard-edit');
  if (editBtn) editBtn.addEventListener('click', toggleDashboardEditMode);
  const resetBtn = document.getElementById('btn-reset-dashboard-layout');
  if (resetBtn) resetBtn.addEventListener('click', resetDashboardLayout);

  // i listener vengono collegati una sola volta: i re-render successivi spostano
  // gli stessi nodi DOM (non li ricreano), quindi restano validi
  dashboardWidgetEls().forEach(el => {
    enableWidgetDrag(el);
    enableWidgetResize(el);
  });
}

/* ---- trascinamento per riordinare i widget, con auto-adattamento delle colonne ---- */
function enableWidgetDrag(widget) {
  const handle = widget.querySelector('.dash-drag-handle');
  if (!handle) return;
  let placeholder = null;
  let originRow = null;

  handle.addEventListener('pointerdown', (e) => {
    const grid = document.getElementById('dashboard-grid');
    if (!grid || !grid.classList.contains('editing')) return;
    e.preventDefault();

    const rect = widget.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;

    originRow = dashboardRowOf(widget);

    placeholder = document.createElement('div');
    placeholder.className = 'dash-widget dw-placeholder';
    placeholder.style.gridColumn = getComputedStyle(widget).gridColumn;
    placeholder.style.height = rect.height + 'px';
    widget.parentNode.insertBefore(placeholder, widget);

    widget.classList.add('dw-dragging');
    widget.style.position = 'fixed';
    widget.style.zIndex = '999';
    widget.style.width = rect.width + 'px';
    widget.style.height = rect.height + 'px';
    widget.style.left = rect.left + 'px';
    widget.style.top = rect.top + 'px';
    widget.style.pointerEvents = 'none';

    try { handle.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }

    const onMove = (ev) => {
      widget.style.left = (ev.clientX - offX) + 'px';
      widget.style.top = (ev.clientY - offY) + 'px';

      const rows = Array.from(grid.querySelectorAll('.dash-row'));
      // riga sotto il puntatore (con un piccolo margine di tolleranza)
      let hoverRow = rows.find(r => {
        const rr = r.getBoundingClientRect();
        return ev.clientY >= rr.top - 10 && ev.clientY <= rr.bottom + 10;
      });

      let targetRow;
      if (hoverRow) {
        targetRow = hoverRow;
        if (targetRow !== placeholder.parentNode) {
          // se la vecchia riga del placeholder resta vuota, verrà ripulita sotto
        }
      } else {
        // il puntatore è nello spazio tra due righe (o sopra/sotto tutte quante):
        // creiamo (o riusiamo) una riga vuota nella posizione giusta, per poter
        // sganciare un widget e farlo diventare autonomo su una riga tutta sua
        const insertBeforeRow = rows.find(r => r !== placeholder.parentNode && r.getBoundingClientRect().top > ev.clientY) || null;
        if (placeholder.parentNode && placeholder.parentNode.classList.contains('dash-row') &&
            placeholder.parentNode.children.length === 1) {
          targetRow = placeholder.parentNode;
          if (insertBeforeRow) grid.insertBefore(targetRow, insertBeforeRow);
          else grid.appendChild(targetRow);
        } else {
          targetRow = document.createElement('div');
          targetRow.className = 'dash-row';
          if (insertBeforeRow) grid.insertBefore(targetRow, insertBeforeRow);
          else grid.appendChild(targetRow);
        }
      }

      const widgetsInRow = Array.from(targetRow.querySelectorAll('.dash-widget')).filter(w => w !== widget && w !== placeholder);
      let before = null;
      if (widgetsInRow.length) {
        let closestW = null, closestWDist = Infinity;
        widgetsInRow.forEach(w => {
          const wr = w.getBoundingClientRect();
          const cx = wr.left + wr.width / 2;
          const dist = Math.abs(ev.clientX - cx);
          if (dist < closestWDist) { closestWDist = dist; closestW = w; }
        });
        const wr = closestW.getBoundingClientRect();
        before = ev.clientX < wr.left + wr.width / 2 ? closestW : closestW.nextSibling;
      }
      if (before) targetRow.insertBefore(placeholder, before);
      else targetRow.appendChild(placeholder);

      // ripulisce righe rimaste vuote diverse da quella che ospita il placeholder
      rows.forEach(r => { if (r !== targetRow && r.parentNode && !r.querySelector('.dash-widget')) r.remove(); });
    };

    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      try { handle.releasePointerCapture(ev.pointerId); } catch (_) { /* ignore */ }

      widget.classList.remove('dw-dragging');
      widget.style.position = '';
      widget.style.zIndex = '';
      widget.style.width = '';
      widget.style.left = '';
      widget.style.top = '';
      widget.style.pointerEvents = '';

      const destRow = placeholder ? placeholder.parentNode : null;
      if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.insertBefore(widget, placeholder);
        placeholder.remove();
      }
      placeholder = null;

      // auto-adattamento: la riga di destinazione e quella di origine (se diversa
      // e ancora popolata) vengono ridistribuite per riempire sempre le 12 colonne —
      // è quello che fa "entrare" un widget accanto a un altro senza lasciare vuoti
      if (destRow) redistributeRow(destRow);
      if (originRow && originRow !== destRow) redistributeRow(originRow);

      document.querySelectorAll('#dashboard-grid .dash-row').forEach(r => { if (!r.children.length) r.remove(); });

      Object.keys(CHARTS).forEach(k => { try { CHARTS[k] && CHARTS[k].resize(); } catch (_) { /* ignore */ } });
      try { renderBubbleChart(); } catch (_) { /* ignore */ }

      saveDashboardLayout();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

/* ---- trascinamento per ridimensionare: larghezza a colonne "a splitter" col vicino
   di riga — sempre noto con certezza, perché la riga è esplicita — altezza libera. ---- */
function enableWidgetResize(widget) {
  const handle = widget.querySelector('.dash-resize-handle');
  if (!handle) return;

  handle.addEventListener('pointerdown', (e) => {
    const grid = document.getElementById('dashboard-grid');
    if (!grid || !grid.classList.contains('editing')) return;
    e.preventDefault();
    e.stopPropagation();

    const rowEl = dashboardRowOf(widget);
    const rowWidgets = rowEl ? Array.from(rowEl.querySelectorAll('.dash-widget')) : [widget];
    const idx = rowWidgets.indexOf(widget);
    const partner = idx >= 0 && idx + 1 < rowWidgets.length ? rowWidgets[idx + 1] : null;

    const rowRect = (rowEl || widget).getBoundingClientRect();
    const colPitch = rowRect.width / DASH_COLS; // px per colonna, usato per convertire il drag del mouse

    const startX = e.clientX, startY = e.clientY;
    const startRect = widget.getBoundingClientRect();
    const startHeight = startRect.height;
    const startSpan = parseInt(widget.dataset.span, 10) || DASH_COLS;
    const partnerStartSpan = partner ? (parseInt(partner.dataset.span, 10) || DASH_COLS) : null;

    widget.classList.add('dw-resizing');
    if (partner) partner.classList.add('dw-resizing');
    try { handle.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const spanDelta = Math.round(dx / colPitch);

      let newSpan = startSpan + spanDelta;

      if (partner) {
        let newPartnerSpan = partnerStartSpan - spanDelta;
        if (newPartnerSpan < DASH_MIN_SPAN) { newPartnerSpan = DASH_MIN_SPAN; newSpan = startSpan + (partnerStartSpan - DASH_MIN_SPAN); }
        if (newSpan < DASH_MIN_SPAN) { newSpan = DASH_MIN_SPAN; newPartnerSpan = partnerStartSpan + (startSpan - DASH_MIN_SPAN); }
        setWidgetSpan(partner, newPartnerSpan);
      } else {
        newSpan = Math.max(DASH_MIN_SPAN, Math.min(DASH_COLS, newSpan));
      }
      setWidgetSpan(widget, newSpan);

      const newHeight = Math.min(DASH_MAX_HEIGHT, Math.max(DASH_MIN_HEIGHT, startHeight + dy));
      widget.style.height = newHeight + 'px';
    };

    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      try { handle.releasePointerCapture(ev.pointerId); } catch (_) { /* ignore */ }
      widget.classList.remove('dw-resizing');
      if (partner) partner.classList.remove('dw-resizing');
      resizeChartIfNeeded(widget.dataset.widgetId);
      if (partner) resizeChartIfNeeded(partner.dataset.widgetId);
      saveDashboardLayout();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

initDashboardCustomization();

/* ---------------- init ---------------- */

async function init() {
  const loaded = await Storage.load();
  STATE = loaded || defaultState();
  if (!ACCOUNTS.length) {
    // nessun conto trovato (nuovo utente): ne creiamo uno di default
    CURRENT_ACCOUNT_ID = newAccountId();
    ACCOUNTS = [{ id: CURRENT_ACCOUNT_ID, name: 'Conto principale' }];
    Storage._wrapperCache = { currentAccountId: CURRENT_ACCOUNT_ID, accounts: { [CURRENT_ACCOUNT_ID]: { name: 'Conto principale', state: STATE } } };
  }
  const missing = normalizeState();

  populateInstrumentSelects();
  populateStrategyDatalist();
  resetTradeForm();
  renderDashboard();
  renderCsvRepairBox();
  document.getElementById('badge-open').textContent = String(openTrades().length);
  renderAccountSwitcher();

  if (!loaded || missing) {
    await Storage.save(STATE);
  }
}

// avviata da auth.js dopo il login (e ad ogni cambio di utente)
window.initJournal = init;
