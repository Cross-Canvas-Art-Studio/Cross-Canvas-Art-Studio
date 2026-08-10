/**
 * LLM API Manager - client-side API-key storage and request-header helpers for
 * the multi-provider LLM helper. Keys live only in the browser (localStorage);
 * they are sent per-request via the X-API-Key / X-API-Key-Source headers that
 * the backend's get_api_key() understands. Vanilla JS, no build step.
 */
(function () {
  "use strict";
  if (window.LLMAPIManager) {
    return;
  }

  var STORAGE_KEY = "cca_api_keys";

  class LLMAPIManager {
    constructor() {
      this.providers = {
        ollama: { name: "Ollama", type: "local", requiresKey: false },
        lmstudio: { name: "LM Studio", type: "local", requiresKey: false },
        openai: { name: "OpenAI", type: "openai", requiresKey: true },
        anthropic: { name: "Anthropic", type: "anthropic", requiresKey: true },
        gemini: { name: "Google Gemini", type: "gemini", requiresKey: true },
        deepseek: { name: "DeepSeek", type: "openai", requiresKey: true },
        cohere: { name: "Cohere", type: "openai", requiresKey: true },
        grok: { name: "Grok (X.AI)", type: "openai", requiresKey: true },
        mistral: { name: "Mistral AI", type: "openai", requiresKey: true },
        perplexity: { name: "Perplexity", type: "openai", requiresKey: true },
      };
      this.serverKeys = {}; // provider -> {available, masked}, filled from /api/config
    }

    setServerKeys(info) {
      this.serverKeys = info || {};
    }

    isLocal(provider) {
      var p = this.providers[provider];
      return !!p && p.type === "local";
    }

    requiresKey(provider) {
      var p = this.providers[provider];
      return !!p && p.requiresKey;
    }

    hasServerKey(provider) {
      return !!(
        this.serverKeys[provider] && this.serverKeys[provider].available
      );
    }

    _all() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      } catch (e) {
        return {};
      }
    }

    getKey(provider) {
      return this._all()[provider] || "";
    }

    setKey(provider, key) {
      var all = this._all();
      if (key) {
        all[provider] = key;
      } else {
        delete all[provider];
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      } catch (e) {
        /* ignore */
      }
    }

    /**
     * Build request headers for a provider. Prefers a server-side key when
     * available (keySource=server); otherwise sends the stored client key.
     */
    getHeaders(provider) {
      var headers = { "Content-Type": "application/json" };
      if (this.isLocal(provider)) {
        return headers;
      }
      if (this.hasServerKey(provider)) {
        headers["X-API-Key-Source"] = "server";
        return headers;
      }
      var key = this.getKey(provider);
      if (key) {
        headers["X-API-Key"] = key;
        headers["X-API-Key-Source"] = "client";
      }
      return headers;
    }

    categorizeError(message) {
      var m = (message || "").toLowerCase();
      if (
        m.indexOf("connection") !== -1 ||
        m.indexOf("unreachable") !== -1 ||
        m.indexOf("refused") !== -1
      ) {
        return "Cannot reach the LLM server. Is it running?";
      }
      if (
        m.indexOf("api key") !== -1 ||
        m.indexOf("authentication") !== -1 ||
        m.indexOf("401") !== -1
      ) {
        return "Authentication failed — check your API key.";
      }
      if (m.indexOf("rate limit") !== -1 || m.indexOf("429") !== -1) {
        return "Rate limit reached — wait a moment and retry.";
      }
      if (m.indexOf("timed out") !== -1 || m.indexOf("timeout") !== -1) {
        return "The request timed out. Try a smaller design or a faster model.";
      }
      return message || "Something went wrong.";
    }
  }

  window.LLMAPIManager = LLMAPIManager;
  document.addEventListener("DOMContentLoaded", function () {
    if (!window.llmAPIManager) {
      window.llmAPIManager = new LLMAPIManager();
    }
  });
  if (!window.llmAPIManager) {
    window.llmAPIManager = new LLMAPIManager();
  }
})();
