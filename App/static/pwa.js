/**
 * pwa.js — service-worker registration + "Install app" affordance.
 *
 * Loaded by every page (designer + the four tool pages). Deliberately
 * dependency-free and side-effect-light so it can run before app.js.
 *
 * The SW is registered with a RELATIVE url so the same file works whether the
 * site is served by Flask at "/" or by GitHub Pages as flat *.html pages.
 */
(function () {
  'use strict';

  var installBtn = document.getElementById('installBtn');
  var deferredPrompt = null;

  function showInstall(show) {
    if (installBtn) installBtn.hidden = !show;
  }

  // --- service worker ------------------------------------------------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {
        /* offline support is a bonus: never break the page over it */
      });
    });
  }

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
