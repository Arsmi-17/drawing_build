(function () {
  "use strict";

  var BRIDGE_INIT = "gamehub:bridge:init";
  var BRIDGE_READY = "gamehub:bridge:ready";
  var BRIDGE_EVENT = "gamehub:bridge:event";
  var BRIDGE_LOG = "gamehub:bridge:log";

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function GameHubSDK(options) {
    options = options || {};
    this.sessionId = null;
    this.targetOrigin = options.targetOrigin || "*";
    this.debug = !!options.debug;
    this.capabilities = {
      challenge: !!(options.capabilities && options.capabilities.challenge),
      pocketConsole: !!(options.capabilities && options.capabilities.pocketConsole),
      fullscreen: !options.capabilities || options.capabilities.fullscreen !== false,
      mute: !options.capabilities || options.capabilities.mute !== false,
      achievements: !options.capabilities || options.capabilities.achievements !== false,
      leaderboard: !options.capabilities || options.capabilities.leaderboard !== false,
    };
    this.handlers = {};
    this.destroyed = false;
    this.context = { preview: false };
    this._onMessage = this._onMessage.bind(this);
    window.addEventListener("message", this._onMessage);

    var self = this;
    this.challenge = {
      ready: function (payload) { self.emit("gamehub:challenge:ready", payload || {}); },
      updateState: function (payload) { self.emit("gamehub:challenge:state", payload || {}); },
      submitResult: function (payload) { self.emit("gamehub:challenge:result", payload || {}); },
      onStart: function (handler) { return self.on("gamehub:challenge:start", handler); },
      onLeaderboard: function (handler) { return self.on("gamehub:challenge:leaderboard", handler); },
      onEnd: function (handler) { return self.on("gamehub:challenge:end", handler); },
    };
    this.pocket = {
      ready: function (payload) { self.emit("gamehub:pocket:ready", payload || {}); },
      setControllerSchema: function (payload) { self.emit("gamehub:pocket:schema", payload || {}); },
      onInput: function (handler) { return self.on("gamehub:pocket:input", handler); },
      onPlayerJoined: function (handler) { return self.on("gamehub:pocket:player_joined", handler); },
      onPlayerReconnected: function (handler) { return self.on("gamehub:pocket:player_reconnected", handler); },
      onPlayerLeft: function (handler) { return self.on("gamehub:pocket:player_left", handler); },
    };
    this.achievements = {
      define: function (payload) { self.emit("gamehub:achievements:manifest", payload || {}); },
      progress: function (payload) { self.emit("gamehub:achievement:progress", payload || {}); },
      onSharing: function (handler) { return self.on("gamehub:achievements:sharing", handler); },
    };
    this.leaderboard = {
      define: function (payload) { self.emit("gamehub:leaderboard:define", payload || {}); },
      submitScore: function (payload) { self.emit("gamehub:leaderboard:score", payload || {}); },
      onSharing: function (handler) { return self.on("gamehub:leaderboard:sharing", handler); },
    };
  }

  GameHubSDK.create = function (options) {
    return new GameHubSDK(options);
  };

  GameHubSDK.prototype.destroy = function () {
    this.destroyed = true;
    this.handlers = {};
    window.removeEventListener("message", this._onMessage);
  };

  GameHubSDK.prototype.on = function (type, handler) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(handler);
    var list = this.handlers[type];
    return function () {
      var index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    };
  };

  GameHubSDK.prototype.emit = function (event, payload) {
    this._send(BRIDGE_EVENT, { event: event, name: event, payload: payload || {} });
  };

  GameHubSDK.prototype.log = function (level, message, data) {
    this._send(BRIDGE_LOG, { level: level, message: message, data: data || null });
  };

  GameHubSDK.prototype.requestPlatformFullscreen = function (orientation) {
    this.emit("fullscreen_request", { orientation: orientation || "auto" });
  };

  GameHubSDK.prototype.setMuted = function (muted) {
    this.emit("audio_muted", { muted: !!muted });
  };

  GameHubSDK.prototype.getSessionId = function () {
    return this.sessionId;
  };

  GameHubSDK.prototype.getContext = function () {
    return Object.assign({}, this.context);
  };

  GameHubSDK.prototype.isPreview = function () {
    return !!(this.context && this.context.preview);
  };

  GameHubSDK.prototype.onContext = function (handler) {
    var unsubscribe = this.on("gamehub:context", handler);
    handler(this.getContext());
    return unsubscribe;
  };

  GameHubSDK.prototype._onMessage = function (event) {
    var data = event.data;
    if (this.destroyed || !isObject(data) || typeof data.type !== "string") return;
    if (data.type === BRIDGE_INIT) {
      if (typeof data.sessionId === "string") this.sessionId = data.sessionId;
      this.context = {
        role: typeof data.role === "string" ? data.role : this.context.role,
        preview: data.preview === true || data.role === "dashboard-preview",
        sessionId: this.sessionId || undefined,
        gameId: typeof data.gameId === "string" ? data.gameId : undefined,
        slug: typeof data.slug === "string" ? data.slug : undefined,
        embedType: typeof data.embedType === "string" ? data.embedType : undefined,
        orientation: typeof data.orientation === "string" ? data.orientation : undefined,
        testUser: isObject(data.testUser)
          ? {
              id: String(data.testUser.id || "preview-user"),
              username: typeof data.testUser.username === "string" ? data.testUser.username : undefined,
              displayName: typeof data.testUser.displayName === "string" ? data.testUser.displayName : undefined,
              email: typeof data.testUser.email === "string" ? data.testUser.email : null,
              test: data.testUser.test === true,
              local: data.testUser.local === true,
            }
          : undefined,
      };
      this._send(BRIDGE_READY, {
        sdk: "@gamehub/sdk",
        version: "0.1.0",
        capabilities: this.capabilities,
        preview: this.context.preview,
      });
      this._dispatch("gamehub:context", this.getContext());
      this.log("info", "GameHub SDK ready");
      return;
    }
    var eventType = data.type === BRIDGE_EVENT && typeof data.event === "string" ? data.event : data.type;
    var payload = data.type === BRIDGE_EVENT && isObject(data.payload) ? data.payload : data;
    this._dispatch(eventType, payload);
  };

  GameHubSDK.prototype._dispatch = function (type, payload) {
    if (this.debug && console && console.debug) console.debug("[GameHubSDK] recv", type, payload);
    var list = this.handlers[type] || [];
    list.slice().forEach(function (handler) { handler(payload); });
  };

  GameHubSDK.prototype._send = function (type, payload) {
    if (!window.parent) return;
    var message = Object.assign({ type: type, sessionId: this.sessionId || undefined }, payload || {});
    if (this.debug && console && console.debug) console.debug("[GameHubSDK] send", message);
    window.parent.postMessage(message, this.targetOrigin);
  };

  window.GameHubSDK = GameHubSDK;
  window.GameHubBridge = window.GameHubBridge || GameHubSDK.create({
    debug: false,
      capabilities: { challenge: false, pocketConsole: false, fullscreen: true, mute: true, achievements: false, leaderboard: false },
    });
})();
