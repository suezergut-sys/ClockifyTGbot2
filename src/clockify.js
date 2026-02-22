const axios = require("axios");

function createClockifyClient(cfg, apiKeyOverride) {
  return axios.create({
    baseURL: cfg.clockifyBaseUrl,
    timeout: 20000,
    headers: {
      "X-Api-Key": apiKeyOverride || cfg.clockifyApiKey,
      "Content-Type": "application/json"
    }
  });
}

async function listProjects(cfg) {
  const client = createClockifyClient(cfg);
  const res = await client.get(`/workspaces/${cfg.workspaceId}/projects`, {
    params: { page: 1, "page-size": 500 }
  });
  return Array.isArray(res.data) ? res.data : [];
}

async function listTasks(cfg, projectId) {
  const client = createClockifyClient(cfg);
  const res = await client.get(`/workspaces/${cfg.workspaceId}/projects/${projectId}/tasks`, {
    params: { page: 1, "page-size": 500 }
  });
  return Array.isArray(res.data) ? res.data : [];
}

async function createTask(cfg, projectId, taskName) {
  const client = createClockifyClient(cfg);
  const res = await client.post(`/workspaces/${cfg.workspaceId}/projects/${projectId}/tasks`, {
    name: String(taskName || "").trim()
  });
  return res.data;
}

async function listWorkspaceUsers(cfg) {
  const client = createClockifyClient(cfg);
  const res = await client.get(`/workspaces/${cfg.workspaceId}/users`, {
    params: { page: 1, "page-size": 500 }
  });
  return Array.isArray(res.data) ? res.data : [];
}

async function resolveClockifyUserId(cfg, userBinding) {
  if (userBinding.clockifyUserId) {
    return userBinding.clockifyUserId;
  }

  if (!userBinding.clockifyEmail) {
    return null;
  }

  const users = await listWorkspaceUsers(cfg);
  const target = userBinding.clockifyEmail.toLowerCase();
  const hit = users.find((u) => String(u.email || "").toLowerCase() === target);
  return hit ? hit.id : null;
}

async function createTimeEntry(cfg, payload) {
  const client = createClockifyClient(cfg, payload.apiKey);
  const body = {
    start: payload.startIso,
    end: payload.endIso,
    projectId: payload.projectId,
    description: payload.description || "",
    billable: false
  };
  if (payload.taskId) {
    body.taskId = payload.taskId;
  }

  const res = await client.post(`/workspaces/${cfg.workspaceId}/time-entries`, body);
  return res.data;
}

async function getCurrentUser(cfg, apiKeyOverride) {
  const client = createClockifyClient(cfg, apiKeyOverride);
  const res = await client.get("/user");
  return res.data;
}

module.exports = {
  listProjects,
  listTasks,
  createTask,
  resolveClockifyUserId,
  getCurrentUser,
  createTimeEntry
};
