/**
 * pwa.js — service-worker registration + "Install app" + "new version" prompt.
 *
 * Loaded by every page (designer + the four tool pages). Deliberately
 * dependency-free and side-effect-light so it can run before app.js.
 *
 * The SW is registered with a RELATIVE url so the same file works whether the
 * site is served by Flask at "/" or by GitHub Pages as flat *.html pages.
 *
 * UPDATING — why this file does more than register a worker:
 * Installing the app and then just using it is the normal case, and a resumed
 * PWA reads no page from the network at all - it comes back out of memory. So
 * neither the worker's network-first fetch nor the browser's own update check
 * ever runs, and an installed app can sit on an old build indefinitely. Two
 * independent signals are watched here, and either one puts a Reload prompt on
 * screen:
 *
 *   1. The new worker itself. sw.js carries a per-deploy build stamp, so its
 *      bytes change on every release and the browser reports an update.
 *   2. The page's own build stamp. The static build appends ?v=<git sha> to
 *      every script URL; re-fetching the page and comparing is a direct answer
 *      to "is the copy I am running older than what the server serves now?".
 *      This one also works where a worker cannot.
 */
(function () {
  'use strict';

  var installBtn = document.getElementById('installBtn');
  var deferredPrompt = null;
  var banner = null;
  var dismissed = false;
  var reloading = false;

  function stampOf(url) {
    var m = url && url.match(/[?&]v=([^&"']+)/);
    return m ? m[1] : null;
  }

  // document.currentScript is only valid while this script is executing, so the
  // stamp this page was loaded with has to be captured here, not on demand.
  var script = document.currentScript;
  var loadedStamp = stampOf(script && script.src);

  function showInstall(show) {
    if (installBtn) installBtn.hidden = !show;
  }

  // --- "a new version is ready" prompt -------------------------------------
  function showUpdatePrompt() {
    if (dismissed || banner) return;
    banner = document.createElement('div');
    banner.className = 'update-banner';
    banner.setAttribute('role', 'status');

    var text = document.createElement('span');
    text.className = 'update-banner-text';
    text.textContent = 'A new version of Stitchee is ready.';

    var reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.className = 'btn-primary update-banner-btn';
    reloadBtn.textContent = 'Reload';
    reloadBtn.addEventListener('click', function () {
      if (reloading) return;
      reloading = true;
      // The designer's own beforeunload guard still gets its say, so unsaved
      // work is never dropped silently by this button.
      window.location.reload();
    });

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'icon-btn update-banner-close';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', function () {
      dismissed = true;
      if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
      banner = null;
    });

    banner.appendChild(text);
    banner.appendChild(reloadBtn);
    banner.appendChild(closeBtn);
    document.body.appendChild(banner);
  }

  // --- signal 1: the worker -------------------------------------------------
  // A worker that reaches "installed" WHILE this page is already controlled is
  // an update. On a first install there is no controller yet, and that is not
  // something to interrupt the user about.
  function watchWorker(registration) {
    function report() {
      if (navigator.serviceWorker.controller) showUpdatePrompt();
    }
    if (registration.waiting) report();

    registration.addEventListener('updatefound', function () {
      var worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', function () {
        if (worker.state === 'installed') report();
      });
    });
  }

  // --- signal 2: the page ---------------------------------------------------
  function checkPageIsCurrent() {
    if (!loadedStamp) return; // nothing to compare against (e.g. the Flask build)
    fetch(window.location.pathname, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) {
        return r.ok ? r.text() : '';
      })
      .then(function (html) {
        var m = html.match(/pwa\.js\?v=([^"&']+)/);
        if (m && m[1] !== loadedStamp) showUpdatePrompt();
      })
      .catch(function () {
        /* offline, or the page is not fetchable: try again later */
      });
  }

  function recheck(registration) {
    checkPageIsCurrent();
    if (!registration) return;
    var updating = registration.update();
    if (updating && updating.catch) updating.catch(function () {});
  }

  // --- service worker ------------------------------------------------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      // updateViaCache:'none' — the update check must NOT be answered from the
      // HTTP cache. GitHub Pages serves sw.js with a multi-hour max-age, so with
      // the default a deploy can go unnoticed long after it shipped.
      navigator.serviceWorker
        .register('sw.js', { updateViaCache: 'none' })
        .then(function (registration) {
          watchWorker(registration);
          // Back to the foreground: the moment a resumed app would otherwise
          // never look at the network again.
          document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') recheck(registration);
          });
        })
        .catch(function () {
          /* offline support is a bonus: never break the page over it */
        });
    });
  }

  // The page may itself have been served from the HTTP cache (the static build's
  // HTML is cached for minutes), and regaining connectivity is the other moment
  // a stale copy becomes fixable.
  window.addEventListener('load', checkPageIsCurrent);
  window.addEventListener('online', checkPageIsCurrent);

  // --- install prompt ------------------------------------------------------
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    showInstall(true);
  });

  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () {
        deferredPrompt = null;
        showInstall(false);
      });
    });
  }

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    showInstall(false);
  });
})();
