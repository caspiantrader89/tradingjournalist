/* =========================================================
   SHARE CARD — genera un'immagine PNG con le prestazioni
   del diario (winrate, P&L totale, drawdown max), in
   formato quadrato o verticale, pronta da condividere.
   Usa STATE e le funzioni di calcolo già definite in app.js.
   ========================================================= */

(function () {
  const COLORS = {
    bg: '#0A0D12',
    surface: '#141922',
    surface2: '#191F2A',
    border: '#232B37',
    borderSoft: '#1A212B',
    text: '#E9EDF3',
    textDim: '#8592A3',
    textFaint: '#4C5768',
    green: '#33C48B',
    red: '#F14D68',
    amber: '#E0A23C',
    blue: '#5B8CFF',
  };

  const FORMATS = {
    square: { w: 1080, h: 1080 },
    vertical: { w: 1080, h: 1350 },
  };

  let currentFormat = 'square';
  let customBgImage = null;
  let canvas, ctx;

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function bestWorstTrade(closed) {
    let best = null, worst = null;
    closed.forEach(t => {
      const p = t.profit;
      if (p === null || p === undefined || isNaN(p)) return;
      if (best === null || p > best) best = p;
      if (worst === null || p < worst) worst = p;
    });
    return { best, worst };
  }

  function computePeriod(closed) {
    let minOpen = null, maxClose = null;
    closed.forEach(t => {
      const od = t.openDate ? new Date(t.openDate) : null;
      const cd = t.closeDate ? new Date(t.closeDate) : null;
      if (od && !isNaN(od) && (!minOpen || od < minOpen)) minOpen = od;
      if (cd && !isNaN(cd) && (!maxClose || cd > maxClose)) maxClose = cd;
    });
    if (!minOpen || !maxClose) return null;
    return { from: minOpen, to: maxClose };
  }

  function computeShareData() {
    const closed = (typeof closedTrades === 'function') ? closedTrades() : [];
    const stats = (typeof winRateStats === 'function') ? winRateStats(closed) : { rate: null };
    const pnl = (typeof totalPL === 'function') ? totalPL() : 0;
    const dd = (typeof maxDrawdown === 'function') ? maxDrawdown('day') : 0;
    const equity = (typeof buildEquityCurve === 'function') ? buildEquityCurve().map(p => p.equity) : [];
    const { best, worst } = bestWorstTrade(closed);
    const period = computePeriod(closed);
    return { winRate: stats.rate, pnl, dd, equity, best, worst, period };
  }

  function drawImageCover(c, img, W, H) {
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const canvasRatio = W / H;
    let sx, sy, sw, sh;
    if (imgRatio > canvasRatio) {
      sh = img.naturalHeight;
      sw = sh * canvasRatio;
      sx = (img.naturalWidth - sw) / 2;
      sy = 0;
    } else {
      sw = img.naturalWidth;
      sh = sw / canvasRatio;
      sx = 0;
      sy = (img.naturalHeight - sh) / 2;
    }
    c.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  }

  function drawBackground(c, W, H, pnl, bgImage) {
    if (bgImage && bgImage.complete && bgImage.naturalWidth) {
      drawImageCover(c, bgImage, W, H);

      // scrim scuro uniforme: garantisce leggibilità del testo qualunque
      // sia la luminosità/contrasto della foto caricata dall'utente
      c.fillStyle = 'rgba(6,9,13,0.7)';
      c.fillRect(0, 0, W, H);

      // vignette extra ai bordi per far risaltare ulteriormente i contenuti
      const vign = c.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75);
      vign.addColorStop(0, 'rgba(6,9,13,0)');
      vign.addColorStop(1, 'rgba(6,9,13,0.6)');
      c.fillStyle = vign;
      c.fillRect(0, 0, W, H);
      return;
    }

    const grad = c.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, COLORS.bg);
    grad.addColorStop(1, '#0D1119');
    c.fillStyle = grad;
    c.fillRect(0, 0, W, H);

    // subtle accent glow, colore in base all'esito
    const glowColor = pnl > 0 ? COLORS.green : (pnl < 0 ? COLORS.red : COLORS.blue);
    const glow = c.createRadialGradient(W * 0.85, H * 0.06, 0, W * 0.85, H * 0.06, W * 0.55);
    glow.addColorStop(0, glowColor + '26');
    glow.addColorStop(1, glowColor + '00');
    c.fillStyle = glow;
    c.fillRect(0, 0, W, H);

    // texture puntinata leggerissima
    c.fillStyle = 'rgba(255,255,255,0.025)';
    const step = W / 27;
    for (let x = step; x < W; x += step) {
      for (let y = step; y < H; y += step) {
        c.beginPath();
        c.arc(x, y, 1.4, 0, Math.PI * 2);
        c.fill();
      }
    }
  }

  function fitSize(naturalW, naturalH, maxW, maxH) {
    const scale = Math.min(maxW / naturalW, maxH / naturalH);
    return { w: naturalW * scale, h: naturalH * scale };
  }

  function drawHeader(c, W, H, padX, data) {
    const y = H * 0.085;
    const markMaxH = W * 0.052;

    const markImg = document.querySelector('.sidebar .brand-mark');
    const wordImg = document.querySelector('.sidebar .brand-word-img');

    if (markImg && markImg.complete && markImg.naturalWidth) {
      const markSize = fitSize(markImg.naturalWidth, markImg.naturalHeight, markMaxH, markMaxH);
      c.drawImage(markImg, padX, y - markSize.h / 2, markSize.w, markSize.h);

      if (wordImg && wordImg.complete && wordImg.naturalWidth) {
        // il wordmark reale è molto largo e basso (~20:1): vincoliamo SIA
        // la larghezza massima (per non invadere la data a destra) SIA
        // l'altezza massima (per restare in armonia col mark), prendendo
        // lo scale minore tra i due, come un vero object-fit:contain.
        const wordBudgetW = W * 0.40;
        const wordMaxH = markSize.h * 0.62;
        const wordSize = fitSize(wordImg.naturalWidth, wordImg.naturalHeight, wordBudgetW, wordMaxH);
        c.drawImage(wordImg, padX + markSize.w + W * 0.018, y - wordSize.h / 2, wordSize.w, wordSize.h);
      }
    } else {
      // fallback testuale, nel caso le immagini non siano ancora caricate
      c.fillStyle = COLORS.text;
      c.font = `600 ${W * 0.032}px 'Space Grotesk', sans-serif`;
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText('TradeJournalist', padX, y);
    }

    // periodo coperto: dal primo trade aperto all'ultimo chiuso
    if (data && data.period) {
      const opts = { day: '2-digit', month: 'short', year: 'numeric' };
      const fromStr = data.period.from.toLocaleDateString('it-IT', opts);
      const toStr = data.period.to.toLocaleDateString('it-IT', opts);
      c.fillStyle = COLORS.textFaint;
      c.font = `500 ${W * 0.017}px 'Inter', sans-serif`;
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText(`Periodo: ${fromStr} – ${toStr}`, padX, H * 0.145);
    }
  }

  function drawPnl(c, W, H, padX, data) {
    const centerX = W / 2;
    const labelY = H * 0.225;
    const valueY = H * 0.29;

    c.fillStyle = COLORS.textDim;
    c.font = `600 ${W * 0.022}px 'Inter', sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.fillText('P&L TOTALE', centerX, labelY);

    const pnlColor = data.pnl > 0 ? COLORS.green : (data.pnl < 0 ? COLORS.red : COLORS.text);
    const pnlText = fmtMoney(data.pnl, { signed: true });
    c.fillStyle = pnlColor;
    c.font = `700 ${W * 0.11}px 'Space Grotesk', sans-serif`;
    c.fillText(pnlText, centerX, valueY + W * 0.09);
  }

  function drawSparkline(c, W, H, padX, data) {
    const top = H * 0.40;
    const height = H * 0.155;
    const left = padX;
    const width = W - padX * 2;

    const pts = data.equity && data.equity.length ? data.equity : [0, 0];
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const range = (max - min) || 1;

    const color = data.pnl > 0 ? COLORS.green : (data.pnl < 0 ? COLORS.red : COLORS.blue);
    const xy = pts.map((v, i) => {
      const x = pts.length > 1 ? left + (i / (pts.length - 1)) * width : left + width / 2;
      const y = top + height - ((v - min) / range) * height;
      return [x, y];
    });

    // area sotto la linea
    const areaGrad = c.createLinearGradient(0, top, 0, top + height);
    areaGrad.addColorStop(0, color + '3D');
    areaGrad.addColorStop(1, color + '00');
    c.beginPath();
    c.moveTo(xy[0][0], top + height);
    xy.forEach(([x, y]) => c.lineTo(x, y));
    c.lineTo(xy[xy.length - 1][0], top + height);
    c.closePath();
    c.fillStyle = areaGrad;
    c.fill();

    // linea
    c.beginPath();
    xy.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
    c.strokeStyle = color;
    c.lineWidth = W * 0.005;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.stroke();

    // puntino finale
    const last = xy[xy.length - 1];
    c.beginPath();
    c.arc(last[0], last[1], W * 0.009, 0, Math.PI * 2);
    c.fillStyle = color;
    c.fill();
    c.beginPath();
    c.arc(last[0], last[1], W * 0.016, 0, Math.PI * 2);
    c.strokeStyle = color + '55';
    c.lineWidth = W * 0.004;
    c.stroke();
  }

  function drawStatBox(c, x, y, w, h, label, value, valueColor) {
    roundRect(c, x, y, w, h, w * 0.055);
    c.fillStyle = COLORS.surface;
    c.fill();
    c.strokeStyle = COLORS.borderSoft;
    c.lineWidth = 1.5;
    c.stroke();

    c.fillStyle = COLORS.textDim;
    c.font = `600 ${h * 0.115}px 'Inter', sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.fillText(label.toUpperCase(), x + w / 2, y + h * 0.28);

    let fontSize = h * 0.26;
    c.font = `700 ${fontSize}px 'Space Grotesk', sans-serif`;
    const maxTextW = w * 0.82;
    while (c.measureText(value).width > maxTextW && fontSize > h * 0.13) {
      fontSize -= h * 0.015;
      c.font = `700 ${fontSize}px 'Space Grotesk', sans-serif`;
    }
    c.fillStyle = valueColor;
    c.fillText(value, x + w / 2, y + h * 0.72);
  }

  function drawStatsRow(c, W, y, boxH, padX, items) {
    const gap = W * 0.035;
    const n = items.length;
    const boxW = (W - padX * 2 - gap * (n - 1)) / n;
    items.forEach((item, i) => {
      const x = padX + i * (boxW + gap);
      drawStatBox(c, x, y, boxW, boxH, item.label, item.value, item.color);
    });
  }

  function drawStats(c, W, H, padX, data) {
    const rowH = H * 0.115;
    const row1Y = H * 0.60;
    const row2Y = H * 0.735;

    const winRateColor = data.winRate === null ? COLORS.textDim : (data.winRate >= 50 ? COLORS.green : COLORS.amber);
    const winRateText = data.winRate === null ? '—' : fmtPct(data.winRate, 0);
    const ddColor = data.dd === 0 ? COLORS.textDim : (data.dd < 15 ? COLORS.amber : COLORS.red);
    const ddText = fmtPct(data.dd, 1);

    drawStatsRow(c, W, row1Y, rowH, padX, [
      { label: 'Winrate', value: winRateText, color: winRateColor },
      { label: 'Drawdown max', value: ddText, color: ddColor },
    ]);

    const bestColor = data.best === null ? COLORS.textDim : (data.best >= 0 ? COLORS.green : COLORS.red);
    const bestText = data.best === null ? '—' : fmtMoney(data.best, { signed: true });
    const worstColor = data.worst === null ? COLORS.textDim : (data.worst >= 0 ? COLORS.green : COLORS.red);
    const worstText = data.worst === null ? '—' : fmtMoney(data.worst, { signed: true });

    drawStatsRow(c, W, row2Y, rowH, padX, [
      { label: 'Miglior trade', value: bestText, color: bestColor },
      { label: 'Peggior trade', value: worstText, color: worstColor },
    ]);
  }

  function drawFooter(c, W, H) {
    const padX = W * 0.08;
    const y = H * 0.955;
    c.font = `500 ${W * 0.019}px 'Inter', sans-serif`;
    c.textBaseline = 'middle';
    c.fillStyle = COLORS.textFaint;

    c.textAlign = 'left';
    c.fillText('tradejournalist.it', padX, y);

    const dateStr = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
    c.textAlign = 'right';
    c.fillText(dateStr, W - padX, y);
  }

  function drawCard(W, H) {
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d');
    const padX = W * 0.08;
    const data = computeShareData();

    drawBackground(ctx, W, H, data.pnl, customBgImage);
    drawHeader(ctx, W, H, padX, data);
    drawPnl(ctx, W, H, padX, data);
    drawSparkline(ctx, W, H, padX, data);
    drawStats(ctx, W, H, padX, data);
    drawFooter(ctx, W, H);
  }

  function render() {
    const { w, h } = FORMATS[currentFormat];
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => drawCard(w, h));
    } else {
      drawCard(w, h);
    }
  }

  function setFormat(fmt) {
    currentFormat = fmt;
    document.getElementById('share-format-square').classList.toggle('btn-primary', fmt === 'square');
    document.getElementById('share-format-square').classList.toggle('btn-ghost', fmt !== 'square');
    document.getElementById('share-format-vertical').classList.toggle('btn-primary', fmt === 'vertical');
    document.getElementById('share-format-vertical').classList.toggle('btn-ghost', fmt !== 'vertical');
    render();
  }

  document.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('share-card-canvas');

    const shareBtn = document.getElementById('btn-share-card');
    if (shareBtn) shareBtn.addEventListener('click', () => {
      document.getElementById('share-card-backdrop').classList.add('active');
      document.getElementById('share-card-msg').textContent = '';
      const bgResetBtn = document.getElementById('share-bg-reset-btn');
      if (bgResetBtn) bgResetBtn.style.display = customBgImage ? '' : 'none';
      setFormat('square');
    });

    const closeBtn = document.getElementById('close-share-card-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => {
      document.getElementById('share-card-backdrop').classList.remove('active');
    });

    const backdrop = document.getElementById('share-card-backdrop');
    if (backdrop) backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.classList.remove('active');
    });

    const sqBtn = document.getElementById('share-format-square');
    if (sqBtn) sqBtn.addEventListener('click', () => setFormat('square'));

    const vertBtn = document.getElementById('share-format-vertical');
    if (vertBtn) vertBtn.addEventListener('click', () => setFormat('vertical'));

    const bgUploadBtn = document.getElementById('share-bg-upload-btn');
    const bgResetBtn = document.getElementById('share-bg-reset-btn');
    const bgInput = document.getElementById('share-bg-input');

    if (bgUploadBtn && bgInput) bgUploadBtn.addEventListener('click', () => bgInput.click());

    if (bgInput) bgInput.addEventListener('change', () => {
      const file = bgInput.files && bgInput.files[0];
      const msg = document.getElementById('share-card-msg');
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        msg.style.color = 'var(--red, #F14D68)';
        msg.textContent = 'Seleziona un file immagine valido.';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          customBgImage = img;
          if (bgResetBtn) bgResetBtn.style.display = '';
          msg.style.color = 'var(--green, #33C48B)';
          msg.textContent = 'Sfondo caricato.';
          render();
        };
        img.onerror = () => {
          msg.style.color = 'var(--red, #F14D68)';
          msg.textContent = 'Impossibile leggere l\'immagine. Riprova.';
        };
        img.src = reader.result;
      };
      reader.onerror = () => {
        msg.style.color = 'var(--red, #F14D68)';
        msg.textContent = 'Errore nella lettura del file. Riprova.';
      };
      reader.readAsDataURL(file);
      bgInput.value = '';
    });

    if (bgResetBtn) bgResetBtn.addEventListener('click', () => {
      customBgImage = null;
      bgResetBtn.style.display = 'none';
      const msg = document.getElementById('share-card-msg');
      msg.style.color = 'var(--text-dim, #8592A3)';
      msg.textContent = 'Sfondo predefinito ripristinato.';
      render();
    });

    const downloadBtn = document.getElementById('download-share-card-btn');
    if (downloadBtn) downloadBtn.addEventListener('click', () => {
      const msg = document.getElementById('share-card-msg');
      canvas.toBlob((blob) => {
        if (!blob) { msg.style.color = 'var(--red, #F14D68)'; msg.textContent = 'Errore nella generazione. Riprova.'; return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `tradejournalist-recap-${stamp}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        msg.style.color = 'var(--green, #33C48B)';
        msg.textContent = 'Immagine scaricata.';
      }, 'image/png');
    });
  });
})();
