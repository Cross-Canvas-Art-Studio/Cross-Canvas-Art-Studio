/**
 * image-store.js — a tiny dependency-free IndexedDB store for imported chart
 * source imagery.
 *
 * WHY IndexedDB: an imported chart is a photo/scan/screenshot that can easily be
 * several megabytes. localStorage has a ~5 MB ceiling for the WHOLE origin and a
 * single 500x500 draft already costs ~650 KB, so source imagery would blow the
 * quota almost immediately. IndexedDB stores Blobs natively and has no such cap.
 *
 * The store holds ONLY the image bytes, keyed by id. Everything else about a
 * chart (its grid size, the alignment transform, progress) stays in the normal
 * project/draft documents, which reference the image by id. That keeps the
 * server documents small and means the same code works on the Flask app and the
 * static GitHub Pages build.
 */
(function () {
  "use strict";

  var DB_NAME = "stitchee-images";
  var STORE = "images";
  var VERSION = 1;
  var _dbPromise = null;

  function supported() {
    return typeof indexedDB !== "undefined" && !!indexedDB;
  }

  function open() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      if (!supported()) {
        reject(new Error("IndexedDB is not available"));
        return;
      }
      var req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error("Could not open the image store"));
      };
    });
    return _dbPromise;
  }

  /** Run a readwrite/readonly op and settle when the transaction completes. */
  function withStore(mode, run) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t;
        try {
          t = db.transaction(STORE, mode);
        } catch (e) {
          reject(e);
          return;
        }
        t.oncomplete = function () {
          resolve();
        };
        t.onerror = function () {
          reject(t.error);
        };
        t.onabort = function () {
          reject(t.error || new Error("Image store transaction aborted"));
        };
        run(t.objectStore(STORE));
      });
    });
  }

  /** Store a Blob. Returns the id it was stored under. */
  function put(blob, id) {
    id =
      id ||
      "img_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    return withStore("readwrite", function (store) {
      store.put(blob, id);
    }).then(function () {
      return id;
    });
  }

  /** Fetch a Blob by id, or null when it is not there. */
  function get(id) {
    if (!id) return Promise.resolve(null);
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, "readonly");
        var r = t.objectStore(STORE).get(id);
        r.onsuccess = function () {
          resolve(r.result || null);
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  }

  function remove(id) {
    if (!id) return Promise.resolve();
    return withStore("readwrite", function (store) {
      store.delete(id);
    });
  }

  function has(id) {
    if (!id) return Promise.resolve(false);
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, "readonly");
        var r = t.objectStore(STORE).getKey(id);
        r.onsuccess = function () {
          resolve(r.result !== undefined);
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  }

  window.StitchImageStore = {
    supported: supported,
    put: put,
    get: get,
    remove: remove,
    has: has,
    DB_NAME: DB_NAME,
    STORE: STORE,
  };
})();
