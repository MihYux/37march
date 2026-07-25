const { contextBridge, ipcRenderer } = require("electron");

let ttsStreamListener;
let desktopNavigateListener;
let companionDataListener;

contextBridge.exposeInMainWorld("marchDesktop", {
  minimize: () => ipcRenderer.send("window:minimize"),
  close: () => ipcRenderer.send("window:close"),
  togglePin: () => ipcRenderer.invoke("window:toggle-pin"),
  getWindowPosition: () => ipcRenderer.invoke("window:get-position"),
  moveWindowTo: (position) =>
    ipcRenderer.send("window:move-to", position),
  endWindowMove: () => ipcRenderer.invoke("window:end-move"),
  getDesktopStatus: () =>
    ipcRenderer.invoke("window:get-desktop-status"),
  setSnapEnabled: (enabled) =>
    ipcRenderer.invoke("window:set-snap-enabled", enabled),
  setMode: (mode) => ipcRenderer.invoke("window:set-mode", mode),
  setPetScale: (scale) =>
    ipcRenderer.invoke("window:set-pet-scale", scale),
  setPetDefaultScale: (scale) =>
    ipcRenderer.invoke("window:set-pet-default-scale", scale),
  show: (route) => ipcRenderer.invoke("window:show", route),
  showContextMenu: () =>
    ipcRenderer.send("window:show-context-menu"),
  reportRendererHeartbeat: () =>
    ipcRenderer.send("window:renderer-heartbeat"),
  onNavigate: (callback) => {
    if (desktopNavigateListener) {
      ipcRenderer.removeListener(
        "desktop:navigate",
        desktopNavigateListener,
      );
    }
    desktopNavigateListener = (_event, route) => callback(route);
    ipcRenderer.on("desktop:navigate", desktopNavigateListener);
  },
  clearNavigateListener: () => {
    if (!desktopNavigateListener) return;
    ipcRenderer.removeListener(
      "desktop:navigate",
      desktopNavigateListener,
    );
    desktopNavigateListener = undefined;
  },
  onCompanionDataChange: (callback) => {
    if (companionDataListener) {
      ipcRenderer.removeListener(
        "companion:data-updated",
        companionDataListener,
      );
    }
    companionDataListener = (_event, data) => callback(data);
    ipcRenderer.on("companion:data-updated", companionDataListener);
  },
  clearCompanionDataChangeListener: () => {
    if (!companionDataListener) return;
    ipcRenderer.removeListener(
      "companion:data-updated",
      companionDataListener,
    );
    companionDataListener = undefined;
  },
  service: {
    getUsageStatus: () =>
      ipcRenderer.invoke("service:get-usage-status"),
  },
  companion: {
    getData: () => ipcRenderer.invoke("companion:get-data"),
    getSkillProfile: () =>
      ipcRenderer.invoke("companion:get-skill-profile"),
    completeOnboarding: (input) =>
      ipcRenderer.invoke("companion:complete-onboarding", input),
    savePreferences: (input) =>
      ipcRenderer.invoke("companion:save-preferences", input),
    setPaused: (paused) =>
      ipcRenderer.invoke("companion:set-paused", paused),
    exit: () => ipcRenderer.invoke("companion:exit"),
    deleteRelationshipData: () =>
      ipcRenderer.invoke("companion:delete-relationship-data"),
    resetDemo: () => ipcRenderer.invoke("companion:reset-demo"),
    setMemoryReusable: (memoryId, reusable) =>
      ipcRenderer.invoke("companion:set-memory-reusable", {
        memoryId,
        reusable,
      }),
    setMemoryEnabled: (enabled) =>
      ipcRenderer.invoke("companion:set-memory-enabled", enabled),
    recordConversationTurn: (input) =>
      ipcRenderer.invoke("companion:record-conversation-turn", input),
    proposeMemoryCandidate: (text, sourceId) =>
      ipcRenderer.invoke("companion:propose-memory-candidate", {
        text,
        sourceId,
      }),
    resolveMemoryCandidate: (memoryId, confirmed) =>
      ipcRenderer.invoke("companion:resolve-memory-candidate", {
        memoryId,
        confirmed,
      }),
    setMemoryCampaignReusable: (memoryId, reusable) =>
      ipcRenderer.invoke("companion:set-memory-campaign-reusable", {
        memoryId,
        reusable,
      }),
    deleteMemory: (memoryId) =>
      ipcRenderer.invoke("companion:delete-memory", memoryId),
    clearMemories: () =>
      ipcRenderer.invoke("companion:clear-memories"),
    createPhotoMemory: () =>
      ipcRenderer.invoke("companion:create-photo-memory"),
    exportMemories: () =>
      ipcRenderer.invoke("companion:export-memories"),
    exportData: () =>
      ipcRenderer.invoke("companion:export-data"),
    markMessageRead: (messageId) =>
      ipcRenderer.invoke("companion:mark-message-read", messageId),
    setMessageFavorite: (messageId, favorite) =>
      ipcRenderer.invoke("companion:set-message-favorite", {
        messageId,
        favorite,
      }),
    setMessageLiked: (messageId, liked) =>
      ipcRenderer.invoke("companion:set-message-liked", {
        messageId,
        liked,
      }),
    setMessageRemindLater: (messageId, remindLater) =>
      ipcRenderer.invoke("companion:set-message-remind-later", {
        messageId,
        remindLater,
      }),
    respondToMessage: (messageId, response) =>
      ipcRenderer.invoke("companion:respond-to-message", {
        messageId,
        response,
      }),
    getContactPolicyStatus: () =>
      ipcRenderer.invoke("companion:get-contact-policy-status"),
    queueEvent: (input) =>
      ipcRenderer.invoke("companion:queue-event", input),
    evaluateEvent: (eventId) =>
      ipcRenderer.invoke("companion:evaluate-event", eventId),
    registerIgnoredContact: () =>
      ipcRenderer.invoke("companion:register-ignored-contact"),
    registerPlayerInteraction: () =>
      ipcRenderer.invoke("companion:register-player-interaction"),
    getDemoScenarios: () =>
      ipcRenderer.invoke("companion:get-demo-scenarios"),
    loadDemoScenario: (scenarioId) =>
      ipcRenderer.invoke(
        "companion:load-demo-scenario",
        scenarioId,
      ),
    advanceDemoTime: (input) =>
      ipcRenderer.invoke("companion:advance-demo-time", input),
    triggerDemoAction: (action) =>
      ipcRenderer.invoke("companion:trigger-demo-action", action),
  },
  ai: {
    getSettings: () => ipcRenderer.invoke("ai:get-settings"),
    saveSettings: (settings) =>
      ipcRenderer.invoke("ai:save-settings", settings),
    clearApiKey: () => ipcRenderer.invoke("ai:clear-key"),
    testConnection: () => ipcRenderer.invoke("ai:test-connection"),
    chat: (request) => ipcRenderer.invoke("ai:chat", request),
  },
  tts: {
    getSettings: () => ipcRenderer.invoke("tts:get-settings"),
    saveSettings: (settings) =>
      ipcRenderer.invoke("tts:save-settings", settings),
    clearApiKey: () => ipcRenderer.invoke("tts:clear-key"),
    test: () => ipcRenderer.invoke("tts:test"),
    synthesize: (request) => ipcRenderer.invoke("tts:synthesize", request),
    startStream: (request) =>
      ipcRenderer.invoke("tts:start-stream", request),
    cancelStream: (requestId) =>
      ipcRenderer.invoke("tts:cancel-stream", requestId),
    onStreamEvent: (callback) => {
      if (ttsStreamListener) {
        ipcRenderer.removeListener("tts:stream-event", ttsStreamListener);
      }
      ttsStreamListener = (_event, payload) => callback(payload);
      ipcRenderer.on("tts:stream-event", ttsStreamListener);
    },
    clearStreamEventListener: () => {
      if (!ttsStreamListener) return;
      ipcRenderer.removeListener("tts:stream-event", ttsStreamListener);
      ttsStreamListener = undefined;
    },
  },
});
