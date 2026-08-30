/* =========================================================
   MOBILE NAV — hamburger menu + spostamento footer in fondo
   Attivo solo sotto i 760px (stesso breakpoint del CSS).
   Non tocca la struttura desktop: sotto i 760px sposta il
   blocco "sidebar-foot-rest" (capitale, logout, link legali,
   logo) dopo il contenuto principale; sopra i 760px lo
   riporta al suo posto originale dentro la sidebar.
   ========================================================= */

(function () {
  function init() {
    var mq = window.matchMedia('(max-width:760px)');

    var toggleBtn = document.getElementById('mobile-nav-toggle');
    var nav = document.querySelector('.nav');
    var backdrop = document.getElementById('mobile-nav-backdrop');
    var footRest = document.querySelector('.sidebar-foot-rest');
    var appShell = document.getElementById('app-shell');

    if (!toggleBtn || !nav) return;

    // Segnaposto per poter ripristinare la posizione originale del footer
    var footRestPlaceholder = null;
    if (footRest) {
      footRestPlaceholder = document.createComment('sidebar-foot-rest-placeholder');
      footRest.parentNode.insertBefore(footRestPlaceholder, footRest);
    }

    function openDrawer() {
      nav.classList.add('mobile-open');
      if (backdrop) backdrop.classList.add('active');
      toggleBtn.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    }
    function closeDrawer() {
      nav.classList.remove('mobile-open');
      if (backdrop) backdrop.classList.remove('active');
      toggleBtn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }
    function toggleDrawer() {
      if (nav.classList.contains('mobile-open')) closeDrawer();
      else openDrawer();
    }

    toggleBtn.addEventListener('click', toggleDrawer);
    if (backdrop) backdrop.addEventListener('click', closeDrawer);

    // Chiudi il drawer quando si sceglie una voce di menu
    nav.addEventListener('click', function (e) {
      if (e.target.closest('.nav-item')) closeDrawer();
    });

    function applyMobile() {
      if (footRest && footRest.parentNode !== appShell) {
        footRest.classList.add('mobile-bottom');
        appShell.appendChild(footRest);
      }
    }
    function applyDesktop() {
      closeDrawer();
      if (footRest) {
        footRest.classList.remove('mobile-bottom');
        if (footRestPlaceholder && footRestPlaceholder.parentNode) {
          footRestPlaceholder.parentNode.insertBefore(footRest, footRestPlaceholder.nextSibling);
        }
      }
    }

    function handleChange(e) {
      if (e.matches) applyMobile();
      else applyDesktop();
    }

    if (mq.addEventListener) mq.addEventListener('change', handleChange);
    else mq.addListener(handleChange); // fallback vecchi browser

    if (mq.matches) applyMobile();
    else applyDesktop();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
