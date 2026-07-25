const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("releaseOperator", {
  getSnapshot: () => ipcRenderer.invoke("release:get-snapshot"),
  switchRegion: (regionId) => ipcRenderer.invoke("release:switch-region", { regionId }),
  setOperator: (operatorId) => ipcRenderer.invoke("release:set-operator", { operatorId }),
  addRegion: (input) => ipcRenderer.invoke("release:add-region", { input }),
  updateRegion: (regionId, input) => ipcRenderer.invoke("release:update-region", { regionId, input }),
  saveTask: (regionId, input) => ipcRenderer.invoke("release:save-task", { regionId, input }),
  importPlan: (regionId, taskId) => ipcRenderer.invoke("release:import-plan", { regionId, taskId }),
  generateDirective: (regionId, taskId, input) => ipcRenderer.invoke("release:generate-directive", { regionId, taskId, input }),
  setDirectivePathPaused: (regionId, directiveId, pathId, paused) =>
    ipcRenderer.invoke("release:set-directive-path-paused", { regionId, directiveId, pathId, paused }),
  reviewDirective: (regionId, directiveId, decision, note) =>
    ipcRenderer.invoke("release:review-directive", { regionId, directiveId, decision, note }),
  saveExperiment: (regionId, input) => ipcRenderer.invoke("release:save-experiment", { regionId, input }),
  publishToAgents: (regionId, directiveId, experimentId) =>
    ipcRenderer.invoke("release:publish-to-agents", { regionId, directiveId, experimentId }),
  publishPlanToAgents: (regionId, taskId, rolloutPercent) =>
    ipcRenderer.invoke("release:publish-plan-to-agents", { regionId, taskId, rolloutPercent }),
  publishExamplePlan: (regionId, taskId) =>
    ipcRenderer.invoke("release:publish-example-plan", { regionId, taskId }),
  importMetrics: (regionId, experimentId, text) =>
    ipcRenderer.invoke("release:import-metrics", { regionId, experimentId, text }),
  importMetricsFile: (regionId, experimentId) =>
    ipcRenderer.invoke("release:import-metrics-file", { regionId, experimentId }),
  setExperimentStage: (regionId, experimentId, action) =>
    ipcRenderer.invoke("release:set-experiment-stage", { regionId, experimentId, action }),
  setExperimentGroupPaused: (regionId, experimentId, groupId, paused) =>
    ipcRenderer.invoke("release:set-experiment-group-paused", { regionId, experimentId, groupId, paused }),
  setEmergencyStop: (regionId, enabled, reason) =>
    ipcRenderer.invoke("release:set-emergency-stop", { regionId, enabled, reason }),
  createOptimization: (regionId, experimentId, reason) =>
    ipcRenderer.invoke("release:create-optimization", { regionId, experimentId, reason }),
  exportBundle: (regionId, directiveId) =>
    ipcRenderer.invoke("release:export-bundle", { regionId, directiveId }),
  deliverTest: (regionId, directiveId, pathId) =>
    ipcRenderer.invoke("release:deliver-test", { regionId, directiveId, pathId }),
  close: () => ipcRenderer.send("window:close"),
});
