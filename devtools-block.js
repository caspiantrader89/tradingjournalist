/* =========================================================
   DEVTOOLS BLOCK — deterrente anti-ispezione
   NB: è un deterrente estetico, non una vera protezione.
   Un utente esperto può sempre aggirarlo (disabilitando JS,
   usando curl, un altro browser, ecc). Serve solo a scoraggiare
   i curiosi meno esperti.
   ========================================================= */

(function () {
  // 1) Blocca il tasto destro (menu contestuale)
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });

  // 2) Blocca le scorciatoie da tastiera per aprire i devtools
  document.addEventListener('keydown', function (e) {
    var key = e.key;
    var blocked =
      key === 'F12' ||
      (e.ctrlKey && e.shiftKey && (key === 'I' || key === 'i')) ||
      (e.ctrlKey && e.shiftKey && (key === 'J' || key === 'j')) ||
      (e.ctrlKey && e.shiftKey && (key === 'C' || key === 'c')) ||
      (e.ctrlKey && (key === 'U' || key === 'u')) ||
      // Mac: Cmd+Option+I / Cmd+Option+J / Cmd+Option+C
      (e.metaKey && e.altKey && (key === 'I' || key === 'i')) ||
      (e.metaKey && e.altKey && (key === 'J' || key === 'j')) ||
      (e.metaKey && e.altKey && (key === 'C' || key === 'c'));

    if (blocked) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  // 3) Rilevamento apertura DevTools via trucco di timing sul debugger
  //    Se i devtools sono aperti, l'esecuzione di "debugger" viene
  //    rallentata in modo misurabile: sfruttiamo questo per rilevarli.
  function redirectAway() {
    window.location.replace('https://www.google.com');
  }

  var devtoolsOpen = false;

  function checkDevTools() {
    var threshold = 160; // ms di soglia
    var start = performance.now();
    // eslint-disable-next-line no-debugger
    debugger;
    var end = performance.now();

    if (end - start > threshold) {
      if (!devtoolsOpen) {
        devtoolsOpen = true;
        redirectAway();
      }
    }
  }

  // 4) Rilevamento alternativo: differenza tra outerWidth/Height e
  //    innerWidth/Height (utile quando i devtools sono ancorati)
  function checkWindowSize() {
    var widthThreshold = window.outerWidth - window.innerWidth > 160;
    var heightThreshold = window.outerHeight - window.innerHeight > 160;
    if (widthThreshold || heightThreshold) {
      if (!devtoolsOpen) {
        devtoolsOpen = true;
        redirectAway();
      }
    }
  }

  setInterval(function () {
    checkDevTools();
    checkWindowSize();
  }, 1000);
})();
