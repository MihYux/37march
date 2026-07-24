const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("releaseOperator", {
  getData: () => ipcRenderer.invoke("operator:get-data"),
  createCampaign: (input) =>
    ipcRenderer.invoke("companion:create-campaign", input),
  updateCampaign: (campaignId, input) =>
    ipcRenderer.invoke("companion:update-campaign", {
      campaignId,
      input,
    }),
  submitCampaignReview: (campaignId) =>
    ipcRenderer.invoke("companion:submit-campaign-review", campaignId),
  reviewCampaign: (campaignId, input) =>
    ipcRenderer.invoke("companion:review-campaign", {
      campaignId,
      input,
    }),
  setCampaignLifecycle: (campaignId, action) =>
    ipcRenderer.invoke("companion:set-campaign-lifecycle", {
      campaignId,
      action,
    }),
  generateCampaignMessage: (campaignId, phase) =>
    ipcRenderer.invoke("companion:generate-campaign-message", {
      campaignId,
      phase,
    }),
  runMessageAutomaticReview: (messageId) =>
    ipcRenderer.invoke(
      "companion:run-message-automatic-review",
      messageId,
    ),
  reviewCampaignMessage: (messageId, input) =>
    ipcRenderer.invoke("companion:review-campaign-message", {
      messageId,
      input,
    }),
  deliverCampaignMessage: (messageId) =>
    ipcRenderer.invoke("companion:deliver-campaign-message", messageId),
  importDocument: (campaignId) =>
    ipcRenderer.invoke("operator:import-document", campaignId),
  importText: (campaignId, title, text) =>
    ipcRenderer.invoke("operator:import-text", {
      campaignId,
      title,
      text,
    }),
  reviewKnowledge: (campaignId, chunkId, input) =>
    ipcRenderer.invoke("operator:review-knowledge", {
      campaignId,
      chunkId,
      input,
    }),
  publishBundle: (campaignId, publisher, rolloutPercent) =>
    ipcRenderer.invoke("operator:publish-bundle", {
      campaignId,
      publisher,
      rolloutPercent,
    }),
  setKillSwitch: (enabled, reviewer) =>
    ipcRenderer.invoke("operator:set-kill-switch", {
      enabled,
      reviewer,
    }),
  close: () => ipcRenderer.send("window:close"),
});
