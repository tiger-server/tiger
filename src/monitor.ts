import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import { Level } from "level";

import type { ExtendedModule } from "./tiger.ts";
import { getLogger } from "./logger.ts";
import {
  resolveMonitorConfig,
  type ResolvedMonitorConfig,
} from "./config.ts";
import {
  getDistributedCoordinator,
  getDistributedHeartbeatTimeout,
} from "./distributed/index.ts";
import type { PersistenceProvider } from "./persistence/index.ts";

const logger = getLogger("monitor");
let managementProvider: PersistenceProvider | undefined;

export function configureManagementProvider(provider: PersistenceProvider) {
  managementProvider = provider;
}

const DEFAULT_HISTORY_LIMIT = 10;
const MAX_HISTORY_LIMIT = 100;
export const MANAGEMENT_BASE_PATH = "/tiger/manage";
const MANAGEMENT_API_ROUTE = `${MANAGEMENT_BASE_PATH}/api/nodes`;

let monitorOptions: ResolvedMonitorConfig = resolveMonitorConfig();
let monitorApiRoute = resolveMonitorPath(
  monitorOptions.basePath,
  "/api/modules"
);
let monitorUiRoute = resolveMonitorPath(monitorOptions.basePath, "/");
let monitorStorePath = monitorOptions.dbPath;

type SerializableValue =
  | null
  | boolean
  | number
  | string
  | SerializableValue[]
  | { [key: string]: SerializableValue };

export interface ModuleSnapshot {
  id: string;
  target: string;
  state: SerializableValue;
  lastParam?: SerializableValue;
  updatedAt: string;
  runCount: number;
  lastDurationMs?: number;
  lastError?: string;
  lastStartedAt?: string;
}

export interface ModuleHistoryEntry {
  id: string;
  target: string;
  timestamp: string;
  startedAt: string;
  durationMs: number;
  param: SerializableValue;
  state: SerializableValue;
  error?: string;
}

export type ModuleMonitorInfo = ModuleSnapshot & {
  history: ModuleHistoryEntry[];
};

function sanitizeValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): SerializableValue {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : value.toString();
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "symbol" || typeof value === "function") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return value.message;
  }

  if (Buffer.isBuffer(value)) {
    return `[Buffer byteLength=${value.byteLength}]`;
  }

  if (depth > 4) {
    return "[Truncated]";
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    const result = value.slice(0, 50).map((entry) =>
      sanitizeValue(entry, depth + 1, seen)
    );
    seen.delete(value);
    return result;
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) {
      return "[Circular]";
    }
    seen.add(value as object);
    const result: Record<string, SerializableValue> = {};
    let count = 0;
    for (const [key, entry] of Object.entries(value as object)) {
      if (typeof entry === "function") {
        continue;
      }
      result[key] = sanitizeValue(entry, depth + 1, seen);
      count++;
      if (count >= 50) {
        result.__truncated__ = "[MaxKeysExceeded]";
        break;
      }
    }
    seen.delete(value as object);
    return result;
  }

  return String(value);
}

function sanitizeParam(param: unknown): SerializableValue {
  if (
    param &&
    typeof param === "object" &&
    "req" in (param as Record<string, unknown>) &&
    (param as Record<string, any>).req &&
    typeof (param as Record<string, any>).req === "object"
  ) {
    const req = (param as Record<string, any>).req;
    return {
      type: "http_request",
      method: req.method,
      url: req.originalUrl ?? req.url,
      path: req.path,
      query: sanitizeValue(req.query),
      params: sanitizeValue(req.params),
      body: sanitizeValue(req.body),
      headers: sanitizeValue(req.headers),
      ip: req.ip,
    };
  }

  return sanitizeValue(param);
}

function sanitizeState(state: unknown): SerializableValue {
  return sanitizeValue(state ?? {});
}

function parseHistoryLimit(value: unknown): number {
  if (Array.isArray(value)) {
    return parseHistoryLimit(value[0]);
  }
  const parsed =
    typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (Number.isNaN(parsed)) {
    return DEFAULT_HISTORY_LIMIT;
  }
  return Math.min(Math.max(parsed, 1), MAX_HISTORY_LIMIT);
}

async function safeGetValue<T>(
  db: Level<string, T>,
  key: string
): Promise<T | undefined> {
  try {
    return await db.get(key);
  } catch (error) {
    if ((error as { code?: string })?.code === "LEVEL_NOT_FOUND") {
      return undefined;
    }
    throw error;
  }
}

class MonitorStore {
  private readonly stateDb: Level<string, ModuleSnapshot>;
  private readonly historyDb: Level<string, ModuleHistoryEntry>;

  constructor(basePath: string) {
    this.stateDb = new Level(path.join(basePath, "state"), {
      valueEncoding: "json",
    });
    this.historyDb = new Level(path.join(basePath, "history"), {
      valueEncoding: "json",
    });
  }

  async registerModule(_module: { id?: string; target: string }) {
    if (!_module.id) {
      return;
    }
    const snapshot = await safeGetValue(this.stateDb, _module.id);
    if (snapshot) {
      if (snapshot.target !== _module.target) {
        const updated = {
          ...snapshot,
          target: _module.target,
          updatedAt: new Date().toISOString(),
        };
        await this.stateDb.put(_module.id, updated);
      }
      return;
    }
    const now = new Date().toISOString();
    await this.stateDb.put(_module.id, {
      id: _module.id,
      target: _module.target,
      runCount: 0,
      updatedAt: now,
      state: {},
    });
  }

  async recordRun(
    _module: ExtendedModule<any, any>,
    param: unknown,
    state: unknown,
    startedAt: number,
    durationMs: number,
    error?: string
  ) {
    if (!_module.id) {
      return;
    }
    try {
      await this.registerModule(_module);
      const now = new Date();
      const snapshot =
        (await safeGetValue(this.stateDb, _module.id)) ??
        ({
          id: _module.id,
          target: _module.target,
          state: {},
          runCount: 0,
          updatedAt: now.toISOString(),
        } satisfies ModuleSnapshot);
      const sanitizedState = sanitizeState(state);
      const sanitizedParam = sanitizeParam(param);
      const runTimestamp = now.toISOString();
      const startedAtIso = new Date(startedAt).toISOString();
      const updatedSnapshot: ModuleSnapshot = {
        ...snapshot,
        target: _module.target,
        state: sanitizedState,
        lastParam: sanitizedParam,
        updatedAt: runTimestamp,
        runCount: snapshot.runCount + 1,
        lastDurationMs: durationMs,
        lastError: error,
        lastStartedAt: startedAtIso,
      };
      await this.stateDb.put(_module.id, updatedSnapshot);

      const historyEntry: ModuleHistoryEntry = {
        id: _module.id,
        target: _module.target,
        timestamp: runTimestamp,
        startedAt: startedAtIso,
        durationMs,
        param: sanitizedParam,
        state: sanitizedState,
        error,
      };
      const key = `${_module.id}!${runTimestamp}!${randomUUID()}`;
      await this.historyDb.put(key, historyEntry);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error(`failed to record run for module ${_module.id}: ${reason}`);
    }
  }

  private async listSnapshots(): Promise<ModuleSnapshot[]> {
    const snapshots: ModuleSnapshot[] = [];
    for await (const [, value] of this.stateDb.iterator()) {
      snapshots.push(value);
    }
    return snapshots;
  }

  private async listHistory(
    moduleId: string,
    limit: number
  ): Promise<ModuleHistoryEntry[]> {
    const prefix = `${moduleId}!`;
    const upperBound = `${moduleId}~`;
    const entries: ModuleHistoryEntry[] = [];
    const iterator = this.historyDb.iterator({
      gte: prefix,
      lt: upperBound,
      reverse: true,
      limit,
    });
    for await (const [, value] of iterator) {
      entries.push(value);
    }
    return entries;
  }

  async getModule(
    moduleId: string,
    limit: number
  ): Promise<ModuleMonitorInfo | undefined> {
    const snapshot = await safeGetValue(this.stateDb, moduleId);
    if (!snapshot) {
      return undefined;
    }
    const history = await this.listHistory(moduleId, limit);
    return { ...snapshot, history };
  }

  async listModules(limit: number): Promise<ModuleMonitorInfo[]> {
    const snapshots = await this.listSnapshots();
    const modules: ModuleMonitorInfo[] = [];
    for (const snapshot of snapshots) {
      modules.push({
        ...snapshot,
        history: await this.listHistory(snapshot.id, limit),
      });
    }
    return modules;
  }
}

type MonitorApi = {
  registerModule: MonitorStore["registerModule"];
  recordRun: MonitorStore["recordRun"];
  listModules: MonitorStore["listModules"];
  getModule: MonitorStore["getModule"];
};

let monitorStore: MonitorStore | undefined;
let monitorServerStarted = false;

const ensureMonitorStore = (): MonitorStore => {
  if (!monitorStore) {
    monitorStore = new MonitorStore(monitorStorePath);
  }
  return monitorStore;
};

const monitor: MonitorApi = {
  registerModule: (...args) => ensureMonitorStore().registerModule(...args),
  recordRun: (...args) => ensureMonitorStore().recordRun(...args),
  listModules: (...args) => ensureMonitorStore().listModules(...args),
  getModule: (...args) => ensureMonitorStore().getModule(...args),
};

export function configureMonitorServer(
  options: ResolvedMonitorConfig = resolveMonitorConfig()
) {
  const previous = monitorOptions;
  monitorOptions = options;

  const previousStorePath = monitorStorePath;
  monitorStorePath = monitorOptions.dbPath;
  if (monitorStore && monitorStorePath !== previousStorePath) {
    logger.warn(
      "monitor store already initialized; ignoring new db path configuration"
    );
    monitorStorePath = previousStorePath;
  }

  monitorApiRoute = resolveMonitorPath(
    monitorOptions.basePath,
    "/api/modules"
  );
  monitorUiRoute = resolveMonitorPath(monitorOptions.basePath, "/");

  if (monitorServerStarted) {
    if (
      previous.port !== monitorOptions.port ||
      previous.host !== monitorOptions.host ||
      previous.basePath !== monitorOptions.basePath
    ) {
      logger.warn(
        "monitor server already running; ignoring new network configuration"
      );
    }
    return;
  }

  if (!monitorOptions.disabled) {
    startMonitorServer();
  } else {
    logger.info("monitor server disabled via configuration");
  }
}

function startMonitorServer() {
  if (monitorServerStarted || monitorOptions.disabled) {
    return;
  }
  monitorServerStarted = true;

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get(monitorApiRoute, async (req, res) => {
    const limit = parseHistoryLimit((req.query as Record<string, unknown>)?.n);
    try {
      const modules = await ensureMonitorStore().listModules(limit);
      res.json({ limit, modules });
    } catch (error) {
      logger.error(
        `monitor api failed: ${error instanceof Error ? error.message : error}`
      );
      res.status(500).json({ error: "Failed to load monitor data" });
    }
  });

  app.get(monitorUiRoute, (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      renderMonitorPage({
        apiPath: monitorApiRoute,
        defaultLimit: DEFAULT_HISTORY_LIMIT,
        maxLimit: MAX_HISTORY_LIMIT,
      })
    );
  });

  if (monitorOptions.basePath !== "/" && monitorUiRoute !== "/") {
    app.get("/", (_req, res) => {
      res.redirect(monitorUiRoute);
    });
  }

  registerManagementRoutes(app);

  const server = app.listen(monitorOptions.port, monitorOptions.host, () => {
    logger.info(
      `monitor server listening on http://${monitorOptions.host}:${monitorOptions.port}${monitorUiRoute}`
    );
  });

  server.on("error", (error) => {
    logger.error(
      `monitor server failed: ${error instanceof Error ? error.message : error}`
    );
  });
}

export default monitor;

interface MonitorPageOptions {
  apiPath: string;
  defaultLimit: number;
  maxLimit: number;
}

function renderMonitorPage({
  apiPath,
  defaultLimit,
  maxLimit,
}: MonitorPageOptions): string {
  const safeApiPath = apiPath || "/api/modules";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tiger Monitor</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      body {
        font-family: "SF Pro Display", "Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        margin: 0;
        padding: 24px;
        background-color: #f4f6fb;
        color: #1f1f1f;
      }
      h1 {
        margin: 0 0 16px;
        font-size: 24px;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
        margin-bottom: 18px;
      }
      label {
        font-weight: 600;
      }
      input[type="number"] {
        width: 80px;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid #ced4da;
        font-size: 14px;
      }
      button {
        background-color: #2563eb;
        color: #fff;
        border: none;
        border-radius: 6px;
        padding: 8px 14px;
        font-size: 14px;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }
      .status {
        font-size: 14px;
        margin-left: auto;
        color: #6b7280;
      }
      .error {
        background-color: #fee2e2;
        color: #991b1b;
        padding: 10px 14px;
        border-radius: 6px;
        margin-bottom: 18px;
        display: none;
      }
      .module-card {
        background-color: #fff;
        border-radius: 12px;
        border: 1px solid #e5e7eb;
        padding: 18px;
        margin-bottom: 16px;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
      }
      .module-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 8px;
      }
      .module-header h2 {
        margin: 0;
        font-size: 18px;
      }
      .module-meta {
        font-size: 13px;
        color: #6b7280;
      }
      .meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 8px;
        margin: 12px 0;
      }
      .meta-item {
        font-size: 13px;
        color: #374151;
      }
      pre {
        background-color: #f9fafb;
        border-radius: 8px;
        padding: 12px;
        overflow-x: auto;
        font-size: 12px;
      }
      .history {
        margin-top: 14px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      th, td {
        border: 1px solid #e5e7eb;
        padding: 6px 8px;
        text-align: left;
        vertical-align: top;
      }
      th {
        background-color: #f3f4f6;
        font-weight: 600;
      }
      .empty {
        text-align: center;
        padding: 32px;
        color: #6b7280;
      }
    </style>
  </head>
  <body>
    <h1>Tiger Module Monitor</h1>
    <div class="toolbar">
      <label for="history-limit">History length (max ${maxLimit})</label>
      <input id="history-limit" type="number" min="1" max="${maxLimit}" value="${defaultLimit}" />
      <button id="refresh-btn">Refresh</button>
      <div class="status" id="monitor-status">Ready</div>
    </div>
    <div class="error" id="monitor-error"></div>
    <div id="modules" class="modules"></div>
    <template id="empty-template">
      <div class="empty">No module runs recorded yet.</div>
    </template>
    <script>
      const API_ENDPOINT = "${safeApiPath}";
      const statusEl = document.getElementById("monitor-status");
      const errorEl = document.getElementById("monitor-error");
      const modulesEl = document.getElementById("modules");
      const limitInput = document.getElementById("history-limit");
      const refreshBtn = document.getElementById("refresh-btn");

      function escapeHtml(str) {
        return (str || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }

      function formatJson(value) {
        try {
          return JSON.stringify(value, null, 2);
        } catch (error) {
          return String(value);
        }
      }

      function getLimitFromQuery() {
        const params = new URLSearchParams(window.location.search);
        const limit = parseInt(params.get("n") || "${defaultLimit}", 10);
        if (Number.isNaN(limit)) {
          return ${defaultLimit};
        }
        return Math.min(Math.max(limit, 1), ${maxLimit});
      }

      function updateQuery(limit) {
        const url = new URL(window.location.href);
        url.searchParams.set("n", String(limit));
        window.history.replaceState({}, "", url);
      }

      function setError(message) {
        if (message) {
          errorEl.textContent = message;
          errorEl.style.display = "block";
        } else {
          errorEl.textContent = "";
          errorEl.style.display = "none";
        }
      }

      function renderModules(modules) {
        if (!modules || modules.length === 0) {
          modulesEl.innerHTML = document.getElementById("empty-template").innerHTML;
          return;
        }

        modulesEl.innerHTML = modules
          .map((module) => {
            const historyRows = (module.history || [])
              .map((item) => \`
                <tr>
                  <td>\${escapeHtml(item.startedAt || "-")}</td>
                  <td>\${escapeHtml(item.timestamp)}</td>
                  <td>\${item.durationMs ?? 0}ms</td>
                  <td><pre>\${escapeHtml(formatJson(item.param))}</pre></td>
                  <td><pre>\${escapeHtml(formatJson(item.state))}</pre></td>
                  <td>\${escapeHtml(item.error || "")}</td>
                </tr>
              \`)
              .join("");

            return \`
              <div class="module-card">
                <div class="module-header">
                  <h2>\${escapeHtml(module.id)}</h2>
                  <span class="module-meta">\${escapeHtml(module.updatedAt)}</span>
                </div>
                <div class="meta-grid">
                  <div class="meta-item"><strong>Target:</strong> \${escapeHtml(module.target)}</div>
                  <div class="meta-item"><strong>Runs:</strong> \${module.runCount}</div>
                  <div class="meta-item"><strong>Last duration:</strong> \${module.lastDurationMs ?? 0}ms</div>
                  <div class="meta-item"><strong>Last error:</strong> \${escapeHtml(module.lastError || "None")}</div>
                </div>
                <div>
                  <strong>Last param</strong>
                  <pre>\${escapeHtml(formatJson(module.lastParam))}</pre>
                </div>
                <div>
                  <strong>Current state</strong>
                  <pre>\${escapeHtml(formatJson(module.state))}</pre>
                </div>
                <div class="history">
                  <strong>Recent history</strong>
                  <table>
                    <thead>
                      <tr>
                        <th>Started</th>
                        <th>Finished</th>
                        <th>Duration</th>
                        <th>Param</th>
                        <th>State</th>
                        <th>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      \${historyRows || '<tr><td colspan="6" class="empty">No history</td></tr>'}
                    </tbody>
                  </table>
                </div>
              </div>
            \`;
          })
          .join("");
      }

      async function loadModules(limit) {
        statusEl.textContent = "Loading...";
        refreshBtn.disabled = true;
        try {
          const response = await fetch(\`\${API_ENDPOINT}?n=\${limit}\`);
          if (!response.ok) {
            throw new Error("Request failed with status " + response.status);
          }
          const payload = await response.json();
          renderModules(payload.modules || []);
          setError("");
          statusEl.textContent = \`Showing last \${payload.limit ?? limit} runs\`;
        } catch (error) {
          setError(error instanceof Error ? error.message : String(error));
          statusEl.textContent = "Failed to load data";
        } finally {
          refreshBtn.disabled = false;
        }
      }

      function refresh() {
        const limit = Math.min(Math.max(parseInt(limitInput.value, 10) || ${defaultLimit}, 1), ${maxLimit});
        limitInput.value = limit;
        updateQuery(limit);
        loadModules(limit);
      }

      refreshBtn.addEventListener("click", (event) => {
        event.preventDefault();
        refresh();
      });

      const initialLimit = getLimitFromQuery();
      limitInput.value = initialLimit;
      updateQuery(initialLimit);
      loadModules(initialLimit);
    </script>
  </body>
</html>`;
}

function registerManagementRoutes(app: express.Express) {
  app.get(MANAGEMENT_BASE_PATH, (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderManagementPage());
  });

  app.get(MANAGEMENT_API_ROUTE, async (_req, res) => {
    if (!managementProvider) {
      res
        .status(503)
        .json({ error: "Persistence provider unavailable", nodes: [] });
      return;
    }
    const nodes = await managementProvider.listNodes();
    const now = Date.now();
    const timeout = getDistributedHeartbeatTimeout() ?? 10000;
    res.json({
      nodes: nodes.map((node) => ({
        ...node,
        monitorUrl: node.metadata?.monitorUrl,
        managementUrl: node.metadata?.managementUrl,
        online: node.lastHeartbeat
          ? now - node.lastHeartbeat <= timeout
          : true,
      })),
      heartbeatTimeout: timeout,
    });
  });

  app.post(`${MANAGEMENT_API_ROUTE}/:id`, async (req, res) => {
    if (!managementProvider) {
      res.status(503).json({ error: "Persistence provider unavailable" });
      return;
    }
    const { enabled } = req.body ?? {};
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "Missing 'enabled' boolean" });
      return;
    }
    await managementProvider.setNodeDesiredState(req.params.id, enabled);
    res.json({ success: true });
  });

  app.get(`${MANAGEMENT_BASE_PATH}/api/jobs`, async (req, res) => {
    if (!managementProvider) {
      res.status(503).json({ error: "Persistence provider unavailable" });
      return;
    }
    const limit = Number.parseInt((req.query.limit as string) ?? "50", 10);
    const jobs = await managementProvider.listJobHistory(limit);
    res.json({ jobs });
  });
}

function renderManagementPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tiger Management</title>
    <style>
      body {
        font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
        margin: 0;
        padding: 24px;
        background-color: #f4f6fb;
        color: #1f2937;
      }
      h1 {
        margin-bottom: 16px;
      }
      .toolbar {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
      }
      button {
        padding: 8px 12px;
        border-radius: 6px;
        border: none;
        background-color: #2563eb;
        color: #fff;
        cursor: pointer;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        background: #fff;
        border-radius: 12px;
        overflow: hidden;
      }
      th, td {
        padding: 12px;
        border-bottom: 1px solid #e5e7eb;
        text-align: left;
        font-size: 14px;
      }
      tr:last-child td {
        border-bottom: none;
      }
      .status-online {
        color: #16a34a;
        font-weight: 600;
      }
      .status-offline {
        color: #dc2626;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <h1>Tiger Management</h1>
    <div class="toolbar">
      <button id="refresh-btn">Refresh</button>
      <a href="${monitorUiRoute}" style="margin-left:auto;">View Module Monitor</a>
    </div>
    <div id="manage-status"></div>
    <div id="nodes"></div>
    <h2>Recent Jobs</h2>
    <div id="jobs"></div>
    <script>
      const API_ENDPOINT = "${MANAGEMENT_API_ROUTE}";
      const statusEl = document.getElementById("manage-status");
      const nodesEl = document.getElementById("nodes");
      const jobsEl = document.getElementById("jobs");
      const refreshBtn = document.getElementById("refresh-btn");

      async function loadData() {
        statusEl.textContent = "Loading...";
        try {
          const [nodeRes, jobRes] = await Promise.all([
            fetch(API_ENDPOINT),
            fetch("${MANAGEMENT_BASE_PATH}/api/jobs")
          ]);
          if (!nodeRes.ok) {
            throw new Error(await nodeRes.text());
          }
          if (!jobRes.ok) {
            throw new Error(await jobRes.text());
          }
          const nodePayload = await nodeRes.json();
          const jobPayload = await jobRes.json();
          renderNodes(nodePayload.nodes || []);
          renderJobs(jobPayload.jobs || []);
          statusEl.textContent = "";
        } catch (error) {
          statusEl.textContent = error instanceof Error ? error.message : String(error);
          nodesEl.innerHTML = "";
          jobsEl.innerHTML = "";
        }
      }

      function renderNodes(nodes) {
        if (!nodes.length) {
          nodesEl.innerHTML = "<p>No registered nodes.</p>";
          return;
        }
        const rows = nodes
          .map((node) => {
            const online = node.online ? "status-online" : "status-offline";
            const nextState = node.desiredEnabled ? "Disable" : "Enable";
            const monitorLink = node.monitorUrl
              ? '<a href="' + node.monitorUrl + '" target="_blank" rel="noopener">Monitor</a>'
              : "-";
            const manageLink = node.managementUrl
              ? '<a href="' + node.managementUrl + '" target="_blank" rel="noopener">Manage</a>'
              : "-";
            return \`
              <tr>
                <td>\${node.id}</td>
                <td class="\${online}">\${node.online ? "Online" : "Offline"}</td>
                <td>\${node.enabled ? "Enabled" : "Disabled"}</td>
                <td>\${node.desiredEnabled ? "Enabled" : "Disabled"}</td>
                <td>\${monitorLink}</td>
                <td>\${manageLink}</td>
                <td>\${new Date(node.lastHeartbeat).toLocaleString()}</td>
                <td>
                  <button data-node="\${node.id}" data-enabled="\${!node.desiredEnabled}">
                    \${nextState}
                  </button>
                </td>
              </tr>
            \`;
          })
          .join("");
        nodesEl.innerHTML = \`
          <table>
            <thead>
              <tr>
                <th>Node</th>
                <th>Status</th>
                <th>Current</th>
                <th>Desired</th>
                <th>Monitor</th>
                <th>Manage</th>
                <th>Last heartbeat</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>\${rows}</tbody>
          </table>
        \`;
        nodesEl.querySelectorAll("button[data-node]").forEach((button) => {
          button.addEventListener("click", async () => {
            const nodeId = button.getAttribute("data-node");
            const enabled = button.getAttribute("data-enabled") === "true";
            await toggleNode(nodeId, enabled);
          });
        });
      }

      async function toggleNode(nodeId, enabled) {
        refreshBtn.disabled = true;
        try {
          await fetch(\`\${API_ENDPOINT}/\${nodeId}\`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled })
          });
          await loadNodes();
        } catch (error) {
          statusEl.textContent = error instanceof Error ? error.message : String(error);
        } finally {
          refreshBtn.disabled = false;
        }
      }

      function renderJobs(jobs) {
        if (!jobs.length) {
          jobsEl.innerHTML = "<p>No job history.</p>";
          return;
        }
        const rows = jobs
          .map((job) => \`
            <tr>
              <td>\${job.id}</td>
              <td>\${job.moduleId}</td>
              <td>\${job.status}</td>
              <td>\${job.workerId || "-"}</td>
              <td>\${job.finishedAt ? new Date(job.finishedAt).toLocaleString() : "-"}</td>
            </tr>
          \`)
          .join("");
        jobsEl.innerHTML = \`
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Module</th>
                <th>Status</th>
                <th>Worker</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody>\${rows}</tbody>
          </table>
        \`;
      }

      refreshBtn.addEventListener("click", (event) => {
        event.preventDefault();
        loadData();
      });

      loadData();
    </script>
  </body>
</html>`;
}

function resolveMonitorPath(basePath: string, suffix: string): string {
  const normalizedSuffix =
    !suffix || suffix === "/"
      ? ""
      : suffix.startsWith("/")
        ? suffix
        : `/${suffix}`;
  if (basePath === "/" || basePath === "") {
    return normalizedSuffix || "/";
  }
  if (!normalizedSuffix) {
    return basePath;
  }
  return `${basePath}${normalizedSuffix}`;
}
