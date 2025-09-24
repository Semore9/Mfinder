import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  Card,
  Col,
  Collapse,
  Divider,
  Form,
  Input,
  InputNumber,
  Tabs,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  Radio,
} from "antd";
import TextArea from "antd/es/input/TextArea";
import type { ColumnsType } from "antd/es/table";
import type { TabsProps } from "antd";
import { useSelector } from "react-redux";
import { EventsOn } from "../../wailsjs/runtime";
import {
  GetDefaults,
  GetTask,
  ListTasks,
  SaveDefaults,
  StartTask,
  StopTask,
} from "../../wailsjs/go/gogo/Bridge";
import { config, gogoscan } from "../../wailsjs/go/models";
import { errorNotification, infoNotification } from "@/component/Notification";
import { RootState } from "@/store/store";
import dayjs from "dayjs";
import "@/pages/Gogo.css";

const { Text } = Typography;

interface FormState {
  targets: string;
  excludeTargets: string;
  ports: string;
  delay: number;
  httpsDelay: number;
  exploit: string;
  verbose: number;
  ping: boolean;
  noScan: boolean;
  portProbe: string;
  ipProbe: string;
  workflow: string;
  debug: boolean;
  opsec: boolean;
  resolveHosts: boolean;
  resolveIPv6: boolean;
  preflightEnabled: boolean;
  preflightPorts: string;
  preflightTimeout: number;
  allowLoopback: boolean;
  allowPrivate: boolean;
  worker: string;
  concurrencyMode: "auto" | "manual";
  manualThreads: number;
  maxThreads: number;
  maxPps: number;
  perIpMaxPps: number;
}

interface LogEntry {
  time: string;
  message: string;
  status?: string;
}

interface FrameworkView {
  name: string;
  version?: string;
  vendor?: string;
  product?: string;
  tags: string[];
  focus?: boolean;
}

interface VulnerabilityView {
  name: string;
  severity: string;
  tags: string[];
}

interface ResultView {
  key: string;
  sequence: number;
  ip: string;
  host?: string;
  hosts?: string[];
  hostBindings?: HostBindingView[];
  port: number;
  portLabel: string;
  protocol: string;
  title: string;
  midware: string;
  status: string;
  url: string;
  frameworks: FrameworkView[];
  vulnerabilities: VulnerabilityView[];
  extracts?: Record<string, string[]>;
  receivedAt: Date;
  worker?: string;
}

interface HostBindingView {
  host: string;
  ip: string;
  recordType: string;
}

interface TaskMetricsView {
  targetCount: number;
  portCount: number;
  resultCount: number;
  lastResult?: Date;
  planned: number;
  enqueued: number;
  started: number;
  succeeded: number;
  failed: number;
  timedOut: number;
  active: number;
  pps: number;
  uptimeMs: number;
}

interface TaskView {
  id: number;
  statusCode: number;
  statusText: string;
  createdAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  metrics?: TaskMetricsView;
  params?: gogoscan.ScanParams;
  error?: string;
  lastMessage?: string;
  worker?: string;
}

interface TaskEventPayload {
  taskId: number;
  status: number;
  metrics?: TaskMetricsView;
  message?: string;
  error?: string;
  result?: any;
  results?: any[];
}

const STATUS_TEXT_OVERRIDES: Record<string, string> = {
  pending: "等待",
  running: "进行中",
  paused: "已暂停",
  stopping: "停止中",
  stopped: "已停止",
  deleted: "已删除",
  error: "失败",
  ok: "完成",
  waiting: "等待",
  completed: "完成",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "default",
  running: "processing",
  paused: "warning",
  stopping: "warning",
  stopped: "warning",
  ok: "success",
  error: "error",
  completed: "success",
};

const PORT_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Top100 (端口扫描默认)", value: "top1" },
  { label: "Top1000", value: "top1000" },
  { label: "常见 Web", value: "80,443,8080,8443,8888,3000,5000" },
  { label: "数据库", value: "1433,1521,3306,5432,6379,9200" },
  { label: "办公/远程", value: "21,22,23,25,53,110,143,3389,5900,5985" },
  { label: "全端口", value: "1-65535" },
];

const DEFAULT_FORM: FormState = {
  targets: "",
  excludeTargets: "",
  ports: "top1",
  delay: 2,
  httpsDelay: 2,
  exploit: "none",
  verbose: 0,
  ping: false,
  noScan: false,
  portProbe: "default",
  ipProbe: "default",
  workflow: "",
  debug: false,
  opsec: false,
  resolveHosts: true,
  resolveIPv6: false,
  preflightEnabled: true,
  preflightPorts: "80,443,53,3389",
  preflightTimeout: 500,
  allowLoopback: false,
  allowPrivate: false,
  worker: "",
  concurrencyMode: "auto",
  manualThreads: 64,
  maxThreads: 256,
  maxPps: 800,
  perIpMaxPps: 80,
};

const toNumber = (value: any, fallback = 0): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toFloat = (value: any, fallback = 0): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toDate = (value: any): Date | undefined => {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed;
};

const toStringArray = (value: any): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,|,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "object") {
    return Object.values(value)
      .flatMap((item) => toStringArray(item))
      .filter(Boolean);
  }
  return [String(value).trim()].filter(Boolean);
};

const safeStringify = (value: any, space = 2) => {
  try {
    return JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === "bigint") {
          return val.toString();
        }
        if (val instanceof Error) {
          return { name: val.name, message: val.message, stack: val.stack };
        }
        return val;
      },
      space,
    );
  } catch (err) {
    return String(value);
  }
};

const normalizeField = (
  primary: string | undefined,
  fallback: string | undefined,
  defaultValue: string,
) => {
  const primaryValue = (primary ?? "").trim();
  if (primaryValue) {
    return primaryValue;
  }
  const fallbackValue = (fallback ?? "").trim();
  if (fallbackValue) {
    return fallbackValue;
  }
  return defaultValue;
};

const normalizeFramework = (raw: any): FrameworkView | null => {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw?.name ?? raw?.Name ?? "").trim();
  if (!name) return null;
  const version =
    String(raw?.version ?? raw?.Version ?? "").trim() || undefined;
  const vendor = String(raw?.vendor ?? raw?.Vendor ?? "").trim() || undefined;
  const product =
    String(raw?.product ?? raw?.Product ?? "").trim() || undefined;
  const tags = toStringArray(raw?.tags ?? raw?.Tags ?? []);
  const focus = Boolean(raw?.focus ?? raw?.Focus);
  return { name, version, vendor, product, tags, focus };
};

const normalizeVulnerability = (raw: any): VulnerabilityView | null => {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw?.name ?? raw?.Name ?? "").trim();
  if (!name) return null;
  const severity = String(raw?.severity ?? raw?.Severity ?? "").trim();
  const tags = toStringArray(raw?.tags ?? raw?.Tags ?? []);
  return { name, severity: severity || "unknown", tags };
};

const normalizeExtracts = (raw: any): Record<string, string[]> | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const result: Record<string, string[]> = {};
  Object.keys(raw).forEach((key) => {
    const values = toStringArray(raw[key]);
    if (values.length) {
      result[key] = values;
    }
  });
  return Object.keys(result).length ? result : undefined;
};

const normalizeResult = (raw: any, sequence: number): ResultView | null => {
  if (!raw || typeof raw !== "object") return null;
  const ip = String(raw?.ip ?? raw?.IP ?? "").trim();
  const portLabel = String(raw?.port ?? raw?.Port ?? "").trim();
  const port = toNumber(portLabel, 0);
  const host = String(raw?.host ?? raw?.Host ?? "").trim() || undefined;
  const hostCandidates = toStringArray(raw?.hosts ?? raw?.Hosts ?? []);
  const bindingSource = raw?.resolvedHosts ?? raw?.ResolvedHosts ?? [];
  const hostBindings = Array.isArray(bindingSource)
    ? (bindingSource as any[])
        .map((item) => {
          const bindingHost = String(item?.host ?? item?.Host ?? "").trim();
          const bindingIp =
            String(item?.ip ?? item?.IP ?? (ip || "")).trim() || ip;
          const recordTypeRaw = String(
            item?.recordType ?? item?.RecordType ?? "",
          ).trim();
          if (!bindingHost || !bindingIp) return null;
          const recordType =
            recordTypeRaw || (bindingIp.includes(":") ? "AAAA" : "A");
          return { host: bindingHost, ip: bindingIp, recordType };
        })
        .filter((item): item is HostBindingView => !!item)
    : undefined;
  const protocol = String(raw?.protocol ?? raw?.Protocol ?? "").trim();
  const title = String(raw?.title ?? raw?.Title ?? "").trim();
  const midware = String(raw?.midware ?? raw?.Midware ?? "").trim();
  const status = String(raw?.status ?? raw?.Status ?? "").trim();
  const url = String(raw?.url ?? raw?.URL ?? raw?.Url ?? "").trim();
  const hostSet = new Set<string>();
  if (host) {
    hostSet.add(host);
  }
  hostCandidates.forEach((item) => hostSet.add(item));
  hostBindings?.forEach((item) => hostSet.add(item.host));
  const hosts = hostBindings?.length
    ? hostBindings.map((item) => `${item.host} → ${item.ip}`)
    : Array.from(hostSet);
  const primaryHost = hostBindings?.[0]?.host ?? host ?? hosts[0];
  const frameworksSource = raw?.frameworks ?? raw?.Frameworks ?? [];
  const frameworkList = Array.isArray(frameworksSource)
    ? frameworksSource
    : typeof frameworksSource === "object"
      ? Object.values(frameworksSource)
      : [];
  const frameworks = frameworkList
    .map((item: any) => normalizeFramework(item))
    .filter((item): item is FrameworkView => !!item);
  const vulnsSource = raw?.vulns ?? raw?.Vulns ?? raw?.vulnerabilities ?? [];
  const vulnList = Array.isArray(vulnsSource)
    ? vulnsSource
    : typeof vulnsSource === "object"
      ? Object.values(vulnsSource)
      : [];
  const vulns = vulnList
    .map((item: any) => normalizeVulnerability(item))
    .filter((item): item is VulnerabilityView => !!item);
  const extracts = normalizeExtracts(
    raw?.extracts ?? raw?.Extracts ?? raw?.extracteds,
  );
  const workerLabel = String(
    raw?.worker ??
      raw?.Worker ??
      raw?.params?.worker ??
      raw?.Params?.Worker ??
      "",
  ).trim();

  return {
    key: `${ip}:${portLabel || port}-${sequence}`,
    sequence,
    ip,
    host: primaryHost,
    hosts,
    hostBindings,
    port,
    portLabel,
    protocol,
    title,
    midware,
    status,
    url,
    frameworks,
    vulnerabilities: vulns,
    extracts,
    receivedAt: new Date(),
    worker: workerLabel || undefined,
  };
};

const normalizeTask = (
  raw: any,
  statusMap: Record<number, string>,
): TaskView | null => {
  if (!raw || typeof raw !== "object") return null;
  const id = toNumber(raw?.id ?? raw?.ID, 0);
  if (!id) return null;
  const statusCode = toNumber(raw?.status ?? raw?.Status, 0);
  const statusKey = statusMap[statusCode]?.toLowerCase?.() ?? "";
  const metricsRaw = raw?.metrics ?? raw?.Metrics ?? {};
  const params = raw?.params ?? raw?.Params;
  const workerLabel = String(
    params?.worker ?? params?.Worker ?? raw?.worker ?? raw?.Worker ?? "",
  ).trim();
  const metrics: TaskMetricsView = {
    targetCount: toNumber(
      metricsRaw?.targetCount ?? metricsRaw?.TargetCount,
      0,
    ),
    portCount: toNumber(metricsRaw?.portCount ?? metricsRaw?.PortCount, 0),
    resultCount: toNumber(
      metricsRaw?.resultCount ?? metricsRaw?.ResultCount,
      0,
    ),
    lastResult: toDate(metricsRaw?.lastResult ?? metricsRaw?.LastResult),
    planned: toNumber(metricsRaw?.planned ?? metricsRaw?.Planned, 0),
    enqueued: toNumber(metricsRaw?.enqueued ?? metricsRaw?.Enqueued, 0),
    started: toNumber(metricsRaw?.started ?? metricsRaw?.Started, 0),
    succeeded: toNumber(metricsRaw?.succeeded ?? metricsRaw?.Succeeded, 0),
    failed: toNumber(metricsRaw?.failed ?? metricsRaw?.Failed, 0),
    timedOut: toNumber(metricsRaw?.timedOut ?? metricsRaw?.TimedOut, 0),
    active: toNumber(metricsRaw?.active ?? metricsRaw?.Active, 0),
    pps: toFloat(metricsRaw?.pps ?? metricsRaw?.Pps, 0),
    uptimeMs: toNumber(metricsRaw?.uptimeMs ?? metricsRaw?.UptimeMs, 0),
  };
  return {
    id,
    statusCode,
    statusText: statusKey || `#${statusCode}`,
    createdAt: toDate(raw?.createdAt ?? raw?.CreatedAt),
    startedAt: toDate(raw?.startedAt ?? raw?.StartedAt),
    completedAt: toDate(raw?.completedAt ?? raw?.CompletedAt),
    metrics,
    params,
    error: raw?.error ?? raw?.Error ?? undefined,
    lastMessage: undefined,
    worker: workerLabel || undefined,
  };
};

const normalizeTaskEvent = (raw: any): TaskEventPayload | null => {
  if (!raw || typeof raw !== "object") return null;
  const taskId = toNumber(
    raw?.taskId ?? raw?.TaskID ?? raw?.taskID ?? raw?.id ?? raw?.ID,
    0,
  );
  if (!taskId) return null;
  const status = toNumber(raw?.status ?? raw?.Status, 0);
  const metricsRaw = raw?.metrics ?? raw?.Metrics ?? {};
  const metrics: TaskMetricsView = {
    targetCount: toNumber(
      metricsRaw?.targetCount ?? metricsRaw?.TargetCount,
      0,
    ),
    portCount: toNumber(metricsRaw?.portCount ?? metricsRaw?.PortCount, 0),
    resultCount: toNumber(
      metricsRaw?.resultCount ?? metricsRaw?.ResultCount,
      0,
    ),
    lastResult: toDate(metricsRaw?.lastResult ?? metricsRaw?.LastResult),
    planned: toNumber(metricsRaw?.planned ?? metricsRaw?.Planned, 0),
    enqueued: toNumber(metricsRaw?.enqueued ?? metricsRaw?.Enqueued, 0),
    started: toNumber(metricsRaw?.started ?? metricsRaw?.Started, 0),
    succeeded: toNumber(metricsRaw?.succeeded ?? metricsRaw?.Succeeded, 0),
    failed: toNumber(metricsRaw?.failed ?? metricsRaw?.Failed, 0),
    timedOut: toNumber(metricsRaw?.timedOut ?? metricsRaw?.TimedOut, 0),
    active: toNumber(metricsRaw?.active ?? metricsRaw?.Active, 0),
    pps: toFloat(metricsRaw?.pps ?? metricsRaw?.Pps, 0),
    uptimeMs: toNumber(metricsRaw?.uptimeMs ?? metricsRaw?.UptimeMs, 0),
  };
  const message = raw?.message ?? raw?.Message ?? undefined;
  const error = raw?.error ?? raw?.Error ?? undefined;
  const result = raw?.result ?? raw?.Result ?? undefined;
  const results = Array.isArray(raw?.results ?? raw?.Results)
    ? (raw?.results ?? raw?.Results)
    : undefined;
  return { taskId, status, metrics, message, error, result, results };
};

const formatDateTime = (value?: Date) => {
  if (!value) return "-";
  return dayjs(value).format("YYYY-MM-DD HH:mm:ss");
};

const formatDuration = (start?: Date, end?: Date) => {
  if (!start) return "-";
  const finish = end ?? new Date();
  const diffSeconds = Math.max(
    0,
    Math.round((finish.getTime() - start.getTime()) / 1000),
  );
  if (diffSeconds < 60) return `${diffSeconds}s`;
  const minutes = Math.floor(diffSeconds / 60);
  const seconds = diffSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
};

const formatDurationFromMs = (durationMs?: number) => {
  if (!durationMs || durationMs <= 0) return "-";
  const diffSeconds = Math.max(0, Math.round(durationMs / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s`;
  const minutes = Math.floor(diffSeconds / 60);
  const seconds = diffSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
};

const severityColor = (severity: string) => {
  switch (severity.toLowerCase()) {
    case "critical":
      return "magenta";
    case "high":
      return "volcano";
    case "medium":
    case "moderate":
      return "orange";
    case "low":
      return "blue";
    case "info":
    case "informational":
      return "default";
    default:
      return "geekblue";
  }
};

const frameworkTagColor = (framework: FrameworkView) => {
  if (framework.focus) {
    return "gold";
  }
  if (framework.tags.includes("web")) {
    return "blue";
  }
  return "default";
};

const hasExtracts = (record: ResultView) =>
  record.extracts && Object.keys(record.extracts).length > 0;

const Gogo: React.FC = () => {
  const [form] = Form.useForm<FormState>();
  const concurrencyMode =
    Form.useWatch("concurrencyMode", form) ?? DEFAULT_FORM.concurrencyMode;
  const [loading, setLoading] = useState(false);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [results, setResults] = useState<ResultView[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [message, setMessage] = useState<string>("");
  const [activeTab, setActiveTab] = useState<string>("results");
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [portPreset, setPortPreset] = useState<string | undefined>(() => {
    const preset = PORT_PRESETS.find(
      (item) => item.value === DEFAULT_FORM.ports,
    );
    return preset?.value;
  });

  const eventEnum = useSelector((state: RootState) => state.app.global.event);
  const statusEnum = useSelector((state: RootState) => state.app.global.status);

  const statusMap = useMemo(() => {
    if (!statusEnum) return {} as Record<number, string>;
    const dict: Record<number, string> = {};
    Object.entries(statusEnum as unknown as Record<string, number>).forEach(
      ([key, value]) => {
        dict[value] = key;
      },
    );
    return dict;
  }, [statusEnum]);

  const runningStatusCodes = useMemo(() => {
    const set = new Set<number>();
    if (statusEnum) {
      const candidates = [
        (statusEnum as any).Running,
        (statusEnum as any).RUNNING,
        (statusEnum as any).running,
      ];
      candidates.forEach((value) => {
        if (typeof value === "number") {
          set.add(value);
        }
      });
    }
    set.add(2);
    return set;
  }, [statusEnum]);

  const activeTask = useMemo(
    () => tasks.find((item) => item.id === activeTaskId) ?? null,
    [tasks, activeTaskId],
  );

  const isTaskRunning = useMemo(() => {
    if (!activeTask) return false;
    if (runningStatusCodes.has(activeTask.statusCode)) {
      return true;
    }
    return activeTask.statusText?.toLowerCase?.() === "running";
  }, [activeTask, runningStatusCodes]);

  const resultsRef = useRef<Map<number, ResultView[]>>(new Map());
  const logsRef = useRef<Map<number, LogEntry[]>>(new Map());
  const activeTaskIdRef = useRef<number | null>(null);
  const defaultsRef = useRef<config.Gogo | null>(null);

  const statusText = useCallback(
    (code?: number) => {
      if (code === undefined || code === null) return "未知";
      const key = statusMap[code]?.toLowerCase?.() ?? "";
      if (!key) return `#${code}`;
      return STATUS_TEXT_OVERRIDES[key] ?? key;
    },
    [statusMap],
  );

  const updateActiveTask = useCallback((taskId: number | null) => {
    activeTaskIdRef.current = taskId;
    setActiveTaskId(taskId);
    setActiveTab("results");
    if (taskId != null) {
      const currentResults = resultsRef.current.get(taskId) ?? [];
      const currentLogs = logsRef.current.get(taskId) ?? [];
      setResults(currentResults);
      setLogs(currentLogs);
    } else {
      setResults([]);
      setLogs(logsRef.current.get(0) ?? []);
    }
  }, []);

  const upsertTask = useCallback((next: TaskView) => {
    setTasks((prev) => {
      const existingIdx = prev.findIndex((item) => item.id === next.id);
      const merged: TaskView =
        existingIdx >= 0 ? { ...prev[existingIdx], ...next } : next;
      const list = existingIdx >= 0 ? [...prev] : [merged, ...prev];
      if (existingIdx >= 0) {
        list[existingIdx] = merged;
      }
      list.sort((a, b) => {
        const at = a.createdAt?.getTime?.() ?? 0;
        const bt = b.createdAt?.getTime?.() ?? 0;
        return bt - at;
      });
      return list;
    });
  }, []);

  const appendResult = useCallback((taskId: number, rawResult: any) => {
    const current = resultsRef.current.get(taskId) ?? [];
    const normalized = normalizeResult(rawResult, current.length + 1);
    if (!normalized) return;
    const next = [...current, normalized];
    resultsRef.current.set(taskId, next);
    if (activeTaskIdRef.current === taskId) {
      setResults(next);
    }
  }, []);

  const appendLog = useCallback(
    (taskId: number, text: string, status?: number) => {
      const logList = logsRef.current.get(taskId) ?? [];
      const entry: LogEntry = {
        time: dayjs().format("HH:mm:ss"),
        message: text,
        status: statusText(status),
      };
      const next = [...logList, entry];
      logsRef.current.set(taskId, next);
      if (activeTaskIdRef.current === taskId) {
        setLogs(next);
      } else if (activeTaskIdRef.current == null && taskId === 0) {
        setLogs(next);
      }
    },
    [statusText],
  );

  const loadDefaults = useCallback(async () => {
    try {
      const defaults = await GetDefaults();
      defaultsRef.current = defaults ?? null;
      appendLog(0, `获取默认配置成功：${safeStringify(defaults ?? {})}`);
      const rawMode = String(defaults?.ConcurrencyMode ?? "")
        .trim()
        .toLowerCase();
      const inferredManual =
        toNumber(defaults?.ConcurrencyThreads, 0) > 0 ||
        (rawMode === "" && toNumber(defaults?.Threads, 0) > 0);
      const concurrencyMode: "auto" | "manual" =
        rawMode === "manual" || inferredManual ? "manual" : "auto";
      const manualThreads = toNumber(
        defaults?.ConcurrencyThreads ?? defaults?.Threads,
        DEFAULT_FORM.manualThreads,
      );
      const maxThreads =
        toNumber(defaults?.ConcurrencyMaxThreads, DEFAULT_FORM.maxThreads) ||
        DEFAULT_FORM.maxThreads;
      const maxPps =
        toNumber(defaults?.ConcurrencyMaxPps, DEFAULT_FORM.maxPps) ||
        DEFAULT_FORM.maxPps;
      const perIpMaxPps =
        toNumber(defaults?.ConcurrencyPerIpMaxPps, DEFAULT_FORM.perIpMaxPps) ||
        DEFAULT_FORM.perIpMaxPps;

      const next: FormState = {
        ...DEFAULT_FORM,
        ports: defaults?.Ports ?? "top1",
        delay: toNumber(defaults?.Delay, DEFAULT_FORM.delay),
        httpsDelay: toNumber(defaults?.HTTPSDelay, DEFAULT_FORM.httpsDelay),
        exploit: defaults?.Exploit ?? DEFAULT_FORM.exploit,
        verbose: toNumber(defaults?.Verbose, DEFAULT_FORM.verbose),
        portProbe: "default",
        ipProbe: "default",
        targets: "",
        excludeTargets: "",
        workflow: "",
        ping: false,
        noScan: false,
        debug: false,
        opsec: false,
        resolveHosts: Boolean(
          defaults?.ResolveHosts ?? DEFAULT_FORM.resolveHosts,
        ),
        resolveIPv6: Boolean(defaults?.ResolveIPv6 ?? DEFAULT_FORM.resolveIPv6),
        preflightEnabled: Boolean(
          defaults?.PreflightEnable ?? DEFAULT_FORM.preflightEnabled,
        ),
        preflightPorts:
          String(
            defaults?.PreflightPorts ?? DEFAULT_FORM.preflightPorts,
          ).trim() || DEFAULT_FORM.preflightPorts,
        preflightTimeout: toNumber(
          defaults?.PreflightTimeout,
          DEFAULT_FORM.preflightTimeout,
        ),
        allowLoopback: Boolean(defaults?.AllowLoopback),
        allowPrivate: Boolean(defaults?.AllowPrivate),
        worker: String(defaults?.WorkerLabel ?? "").trim(),
        concurrencyMode,
        manualThreads:
          manualThreads > 0 ? manualThreads : DEFAULT_FORM.manualThreads,
        maxThreads: maxThreads > 0 ? maxThreads : DEFAULT_FORM.maxThreads,
        maxPps: maxPps > 0 ? maxPps : DEFAULT_FORM.maxPps,
        perIpMaxPps: perIpMaxPps > 0 ? perIpMaxPps : DEFAULT_FORM.perIpMaxPps,
      };
      form.setFieldsValue(next);
      const preset = PORT_PRESETS.find((item) => item.value === next.ports);
      setPortPreset(preset?.value);
    } catch (e) {
      errorNotification("错误", `获取端口扫描默认配置失败: ${String(e)}`);
      appendLog(0, `获取默认配置失败: ${String(e)}`);
    }
  }, [appendLog, form]);

  const loadTasks = useCallback(async () => {
    try {
      const items = await ListTasks();
      const normalized = (items || [])
        .map((item) => normalizeTask(item, statusMap))
        .filter((item): item is TaskView => !!item);
      appendLog(0, `加载任务列表成功，共 ${normalized.length} 个任务`);
      setTasks(normalized);
      if (normalized.length && activeTaskIdRef.current == null) {
        updateActiveTask(normalized[0].id);
      }
    } catch (e) {
      errorNotification("错误", `获取任务列表失败: ${String(e)}`);
      appendLog(0, `获取任务列表失败: ${String(e)}`);
    }
  }, [appendLog, statusMap, updateActiveTask]);

  useEffect(() => {
    loadDefaults();
    loadTasks();
  }, [loadDefaults, loadTasks]);

  useEffect(() => {
    if (!eventEnum?.GogoTaskUpdate) return;
    const unsubscribe = EventsOn(eventEnum.GogoTaskUpdate, (payload: any) => {
      const detail = payload?.data ?? payload?.Data ?? payload;
      const eventPayload = normalizeTaskEvent(detail);
      if (!eventPayload) return;
      const taskId = eventPayload.taskId;
      const status = eventPayload.status;
      const metrics = eventPayload.metrics;
      const messageText = eventPayload.message;
      const errorText = eventPayload.error;
      appendLog(
        taskId,
        `接收到任务事件：status=${status}, payload=${safeStringify(detail)}`,
        status,
      );

      upsertTask({
        id: taskId,
        statusCode: status,
        statusText: statusText(status),
        metrics,
        error: errorText,
        lastMessage: messageText,
      });

      if (messageText) {
        appendLog(taskId, messageText, status);
        setMessage(messageText);
      }
      if (errorText) {
        appendLog(taskId, errorText, status);
      }
      if (eventPayload.result) {
        appendResult(taskId, eventPayload.result);
        appendLog(
          taskId,
          `接收到扫描结果：${safeStringify(eventPayload.result)}`,
          status,
        );
      }
      if (eventPayload.results && eventPayload.results.length) {
        eventPayload.results.forEach((entry) => appendResult(taskId, entry));
        appendLog(
          taskId,
          `接收到批量扫描结果 ${eventPayload.results.length} 条`,
          status,
        );
      }
    });
    return () => {
      unsubscribe?.();
    };
  }, [
    appendLog,
    appendResult,
    eventEnum?.GogoTaskUpdate,
    statusText,
    upsertTask,
  ]);

  const saveDefaults = useCallback(async () => {
    try {
      setSavingDefaults(true);
      const values = await form.validateFields();
      appendLog(0, `准备保存默认配置：${safeStringify(values)}`);
      const modeValue = defaultsRef.current?.Mode ?? "default";
      const isManual = values.concurrencyMode === "manual";
      const manualThreads = Math.max(
        1,
        toNumber(values.manualThreads, DEFAULT_FORM.manualThreads),
      );
      const maxThreads = Math.max(
        1,
        toNumber(values.maxThreads, DEFAULT_FORM.maxThreads),
      );
      const maxPps = Math.max(0, toNumber(values.maxPps, DEFAULT_FORM.maxPps));
      const perIpMaxPps = Math.max(
        0,
        toNumber(values.perIpMaxPps, DEFAULT_FORM.perIpMaxPps),
      );

      const payload: config.Gogo = {
        Ports: values.ports,
        Mode: modeValue,
        Threads: isManual ? manualThreads : 0,
        Delay: values.delay,
        HTTPSDelay: values.httpsDelay,
        Exploit: values.exploit,
        Verbose: values.verbose,
        ResolveHosts: values.resolveHosts,
        ResolveIPv6: values.resolveIPv6,
        PreflightEnable: values.preflightEnabled,
        PreflightPorts: values.preflightPorts,
        PreflightTimeout: values.preflightTimeout,
        AllowLoopback: values.allowLoopback,
        AllowPrivate: values.allowPrivate,
        WorkerLabel: values.worker,
        ConcurrencyMode: values.concurrencyMode,
        ConcurrencyThreads: isManual ? manualThreads : 0,
        ConcurrencyMaxThreads: maxThreads,
        ConcurrencyMaxPps: maxPps,
        ConcurrencyPerIpMaxPps: perIpMaxPps,
      } as config.Gogo;
      await SaveDefaults(payload);
      defaultsRef.current = payload;
      infoNotification("成功", "已保存端口扫描默认配置");
      appendLog(0, `默认配置保存成功：${safeStringify(payload)}`);
    } catch (e) {
      if (e?.errorFields) return;
      errorNotification("错误", `保存默认配置失败: ${String(e)}`);
      appendLog(0, `保存默认配置失败: ${String(e)}`);
    } finally {
      setSavingDefaults(false);
    }
  }, [appendLog, form]);

  const startTask = useCallback(async () => {
    try {
      const values = await form.validateFields();
      const targetList = toStringArray(values.targets);
      if (targetList.length === 0) {
        errorNotification("错误", "请填写至少一个目标");
        return;
      }
      setLoading(true);

      const defaultsSnapshot = defaultsRef.current;
      const resolvedMode = normalizeField(
        undefined,
        defaultsSnapshot?.Mode,
        "default",
      );
      const resolvedPorts = normalizeField(
        values.ports,
        defaultsSnapshot?.Ports,
        "top1",
      );
      const resolvedExploit = normalizeField(
        values.exploit,
        defaultsSnapshot?.Exploit,
        "none",
      );
      const resolvedPortProbe = normalizeField(
        values.portProbe,
        undefined,
        resolvedMode,
      );
      const resolvedIPProbe = normalizeField(
        values.ipProbe,
        undefined,
        resolvedMode,
      );
      const resolvedWorker = normalizeField(
        values.worker,
        defaultsSnapshot?.WorkerLabel,
        "",
      );
      const resolvedPreflightPorts = normalizeField(
        values.preflightPorts,
        defaultsSnapshot?.PreflightPorts,
        DEFAULT_FORM.preflightPorts,
      );
      const fallbackPreflightTimeout = toNumber(
        defaultsSnapshot?.PreflightTimeout,
        DEFAULT_FORM.preflightTimeout,
      );
      const resolvedPreflightTimeout =
        toNumber(values.preflightTimeout, 0) ||
        fallbackPreflightTimeout ||
        DEFAULT_FORM.preflightTimeout;
      const manualThreads = Math.max(
        1,
        toNumber(values.manualThreads, DEFAULT_FORM.manualThreads),
      );
      const resolvedMaxThreads = Math.max(
        1,
        toNumber(values.maxThreads, DEFAULT_FORM.maxThreads),
      );
      const resolvedMaxPps = Math.max(
        0,
        toNumber(values.maxPps, DEFAULT_FORM.maxPps),
      );
      const resolvedPerIpMaxPps = Math.max(
        0,
        toNumber(values.perIpMaxPps, DEFAULT_FORM.perIpMaxPps),
      );

      const concurrency: gogoscan.ConcurrencyOptions = {
        mode: values.concurrencyMode,
        threads: values.concurrencyMode === "manual" ? manualThreads : 0,
        maxThreads: values.concurrencyMode === "auto" ? resolvedMaxThreads : 0,
        maxPps: resolvedMaxPps,
        perIpMaxPps: resolvedPerIpMaxPps,
      } as gogoscan.ConcurrencyOptions;

      const params: gogoscan.ScanParams = {
        targets: targetList,
        target: "",
        targetsText: values.targets,
        exclude: toStringArray(values.excludeTargets),
        ports: resolvedPorts,
        mode: resolvedMode,
        ping: values.ping,
        noScan: values.noScan,
        threads: concurrency.threads ?? 0,
        delay: values.delay,
        httpsDelay: values.httpsDelay,
        exploit: resolvedExploit,
        verbose: values.verbose,
        portProbe: resolvedPortProbe,
        ipProbe: resolvedIPProbe,
        workflow: values.workflow,
        debug: values.debug,
        opsec: values.opsec,
        resolveHosts: values.resolveHosts,
        resolveIPv6: values.resolveIPv6,
        preflightEnabled: values.preflightEnabled,
        preflightPorts: resolvedPreflightPorts,
        preflightTimeout: resolvedPreflightTimeout,
        allowLoopback: values.allowLoopback,
        allowPrivate: values.allowPrivate,
        worker: resolvedWorker,
        concurrency,
      } as gogoscan.ScanParams;
      appendLog(0, `启动任务参数：${safeStringify(params)}`);

      const task = await StartTask(params);
      const normalized = normalizeTask(task, statusMap);
      if (normalized) {
        resultsRef.current.set(normalized.id, []);
        logsRef.current.set(normalized.id, []);
        upsertTask(normalized);
        updateActiveTask(normalized.id);
        appendLog(normalized.id, "任务已启动", normalized.statusCode);
        setMessage("任务已启动");
      }
    } catch (e) {
      if (e?.errorFields) return;
      errorNotification("错误", `启动任务失败: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [appendLog, form, statusMap, updateActiveTask, upsertTask]);

  const stopTask = useCallback(async () => {
    if (!activeTaskIdRef.current) return;
    try {
      appendLog(activeTaskIdRef.current, "发送停止任务请求");
      await StopTask(activeTaskIdRef.current);
      appendLog(activeTaskIdRef.current, "已请求停止任务");
      setMessage("已请求停止任务");
    } catch (e) {
      errorNotification("错误", `停止任务失败: ${String(e)}`);
      appendLog(activeTaskIdRef.current, `停止任务失败: ${String(e)}`);
    }
  }, [appendLog]);

  const refreshTask = useCallback(async () => {
    if (!activeTaskIdRef.current) return;
    try {
      const task = await GetTask(activeTaskIdRef.current);
      const normalized = normalizeTask(task, statusMap);
      if (normalized) {
        upsertTask(normalized);
        appendLog(normalized.id, "已刷新任务状态", normalized.statusCode);
      }
    } catch (e) {
      errorNotification("错误", `刷新任务失败: ${String(e)}`);
      appendLog(activeTaskIdRef.current, `刷新任务失败: ${String(e)}`);
    }
  }, [appendLog, statusMap, upsertTask]);

  const exportResults = useCallback(() => {
    if (!activeTaskId) {
      infoNotification("提示", "请选择任务后再导出结果");
      return;
    }
    if (!results.length) {
      infoNotification("提示", "当前任务暂无扫描结果");
      return;
    }

    const escapeCell = (value: string | number | undefined | null) => {
      const text = value == null ? "" : String(value);
      const escaped = text.replace(/"/g, '""');
      return `"${escaped}"`;
    };

    const header = [
      "序号",
      "IP",
      "域名",
      "端口",
      "协议",
      "状态",
      "标题",
      "中间件",
      "URL",
    ];

    const rows = results.map((item) => [
      item.sequence,
      item.ip,
      item.hosts?.join(" | ") ?? item.host ?? "",
      item.portLabel || item.port,
      item.protocol,
      item.status,
      item.title,
      item.midware,
      item.url,
    ]);

    const csvLines = [
      header.map((cell) => escapeCell(cell)).join(","),
      ...rows.map((row) => row.map((cell) => escapeCell(cell)).join(",")),
    ];

    const csvContent = "\ufeff" + csvLines.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const timestamp = dayjs().format("YYYYMMDD_HHmmss");
    const link = document.createElement("a");
    link.href = url;
    link.download = `portscan_results_${activeTaskId}_${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    appendLog(activeTaskId, "已导出扫描结果");
    infoNotification("成功", "扫描结果已导出");
  }, [activeTaskId, appendLog, results]);

  const taskColumns = useMemo<ColumnsType<TaskView>>(
    () => [
      {
        title: (
          <Tooltip title="任务的唯一标识符">
            <span>任务ID</span>
          </Tooltip>
        ),
        dataIndex: "id",
        width: 120,
      },
      {
        title: (
          <Tooltip title="当前任务所处的状态">
            <span>状态</span>
          </Tooltip>
        ),
        dataIndex: "statusCode",
        width: 120,
        render: (_, record) => {
          const key = record.statusText?.toLowerCase?.() ?? "";
          const color = STATUS_COLORS[key] ?? "default";
          const text = STATUS_TEXT_OVERRIDES[key] ?? record.statusText;
          return <Tag color={color}>{text}</Tag>;
        },
      },
      {
        title: (
          <Tooltip title="执行该任务的 worker 节点">
            <span>Worker</span>
          </Tooltip>
        ),
        dataIndex: "worker",
        width: 140,
        render: (_, record) =>
          record.worker ? <Tag color="geekblue">{record.worker}</Tag> : "-",
      },
      {
        title: (
          <Tooltip title="当前任务累计返回的结果数量">
            <span>结果数</span>
          </Tooltip>
        ),
        dataIndex: ["metrics", "resultCount"],
        width: 120,
        render: (_, record) => record.metrics?.resultCount ?? 0,
      },
      {
        title: "目标数量",
        dataIndex: ["metrics", "targetCount"],
        width: 120,
        render: (_, record) => record.metrics?.targetCount ?? 0,
      },
      {
        title: "端口数量",
        dataIndex: ["metrics", "portCount"],
        width: 120,
        render: (_, record) => record.metrics?.portCount ?? 0,
      },
      {
        title: "创建时间",
        dataIndex: "createdAt",
        width: 200,
        render: (value) => formatDateTime(value as Date | undefined),
      },
      {
        title: "操作",
        key: "action",
        width: 160,
        render: (_, record) => (
          <Space size="middle">
            <Button
              type="link"
              size="small"
              onClick={() => updateActiveTask(record.id)}
            >
              查看
            </Button>
            <Button
              type="link"
              size="small"
              danger
              onClick={() => {
                updateActiveTask(record.id);
                stopTask();
              }}
            >
              停止
            </Button>
          </Space>
        ),
      },
    ],
    [stopTask, updateActiveTask],
  );

  const resultColumns = useMemo<ColumnsType<ResultView>>(() => {
    const compareString = (a?: string, b?: string) =>
      (a ?? "").localeCompare(b ?? "", "zh-Hans-CN", {
        numeric: true,
        sensitivity: "base",
      });
    const primaryHost = (record: ResultView) =>
      record.hostBindings?.[0]?.host ?? record.host ?? "";
    return [
      {
        title: (
          <Tooltip title="结果在当前任务中的出现顺序">
            <span>序号</span>
          </Tooltip>
        ),
        dataIndex: "sequence",
        width: 80,
        sorter: (a, b) => a.sequence - b.sequence,
      },
      {
        title: (
          <Tooltip title="发现的远端 IP 地址">
            <span>IP</span>
          </Tooltip>
        ),
        dataIndex: "ip",
        width: 150,
        sorter: (a, b) => compareString(a.ip, b.ip),
      },
      {
        title: (
          <Tooltip title="关联到该 IP 的域名或主机名">
            <span>域名</span>
          </Tooltip>
        ),
        dataIndex: "host",
        width: 220,
        sorter: (a, b) => compareString(primaryHost(a), primaryHost(b)),
        render: (_, record) =>
          record.hostBindings && record.hostBindings.length ? (
            <Space size={[4, 4]} wrap>
              {record.hostBindings.map((binding) => (
                <Tag
                  key={`${record.key}-host-${binding.host}-${binding.ip}`}
                  color={binding.recordType === "AAAA" ? "purple" : "blue"}
                  title={`${binding.host} → ${binding.ip}`}
                >
                  {`${binding.host} → ${binding.ip}`}
                </Tag>
              ))}
            </Space>
          ) : record.hosts && record.hosts.length ? (
            <Space size={[4, 4]} wrap>
              {record.hosts.map((item) => (
                <Tag key={`${record.key}-host-${item}`} color="blue">
                  {item}
                </Tag>
              ))}
            </Space>
          ) : (
            "-"
          ),
      },
      {
        title: (
          <Tooltip title="执行该结果的 worker 节点">
            <span>Worker</span>
          </Tooltip>
        ),
        dataIndex: "worker",
        width: 140,
        sorter: (a, b) => compareString(a.worker, b.worker),
        render: (value: string | undefined) =>
          value ? <Tag color="geekblue">{value}</Tag> : "-",
      },
      {
        title: (
          <Tooltip title="开放的端口号或标签">
            <span>端口</span>
          </Tooltip>
        ),
        dataIndex: "portLabel",
        width: 90,
        sorter: (a, b) => a.port - b.port,
      },
      {
        title: (
          <Tooltip title="识别到的协议类型">
            <span>协议</span>
          </Tooltip>
        ),
        dataIndex: "protocol",
        width: 90,
        sorter: (a, b) => compareString(a.protocol, b.protocol),
      },
      {
        title: (
          <Tooltip title="站点或服务返回的标题">
            <span>标题</span>
          </Tooltip>
        ),
        dataIndex: "title",
        width: 220,
        ellipsis: true,
        sorter: (a, b) => compareString(a.title, b.title),
      },
      {
        title: (
          <Tooltip title="指纹匹配到的中间件信息">
            <span>中间件</span>
          </Tooltip>
        ),
        dataIndex: "midware",
        width: 200,
        ellipsis: true,
        sorter: (a, b) => compareString(a.midware, b.midware),
      },
      {
        title: (
          <Tooltip title="检测到的应用框架或组件">
            <span>框架</span>
          </Tooltip>
        ),
        dataIndex: "frameworks",
        width: 220,
        render: (value: FrameworkView[]) =>
          value?.length ? (
            <Space size={[4, 4]} wrap>
              {value.map((item) => (
                <Tag
                  key={`${item.name}-${item.version ?? ""}`}
                  color={frameworkTagColor(item)}
                >
                  {item.version ? `${item.name} ${item.version}` : item.name}
                </Tag>
              ))}
            </Space>
          ) : (
            "-"
          ),
      },
      {
        title: (
          <Tooltip title="由端口扫描引擎/neutron 返回的漏洞信息">
            <span>漏洞</span>
          </Tooltip>
        ),
        dataIndex: "vulnerabilities",
        width: 240,
        render: (value: VulnerabilityView[]) =>
          value?.length ? (
            <Space size={[4, 4]} wrap>
              {value.map((item) => (
                <Tag
                  key={`${item.name}-${item.severity}`}
                  color={severityColor(item.severity)}
                >
                  {`${item.name} (${item.severity})`}
                </Tag>
              ))}
            </Space>
          ) : (
            "-"
          ),
      },
      {
        title: (
          <Tooltip title="额外提取的关键字段，点击行可查看详情">
            <span>提取项</span>
          </Tooltip>
        ),
        dataIndex: "extracts",
        width: 220,
        render: (value: ResultView["extracts"]) =>
          value && Object.keys(value).length ? (
            <Space size={[4, 4]} wrap>
              {Object.keys(value).map((key) => (
                <Tag key={`extract-${key}`} color="purple">
                  {key}
                </Tag>
              ))}
            </Space>
          ) : (
            "-"
          ),
      },
      {
        title: (
          <Tooltip title="组合后的访问 URL">
            <span>URL</span>
          </Tooltip>
        ),
        dataIndex: "url",
        width: 260,
        ellipsis: true,
        sorter: (a, b) => compareString(a.url, b.url),
      },
      {
        title: (
          <Tooltip title="结果接收时间">
            <span>时间</span>
          </Tooltip>
        ),
        dataIndex: "receivedAt",
        width: 200,
        sorter: (a, b) =>
          (a.receivedAt?.getTime?.() ?? 0) - (b.receivedAt?.getTime?.() ?? 0),
        defaultSortOrder: "descend",
        render: (value: Date | undefined) => formatDateTime(value),
      },
    ];
  }, []);

  const renderExtractsPanel = useCallback((record: ResultView) => {
    if (!hasExtracts(record) || !record.extracts) {
      return <Text type="secondary">暂无提取信息</Text>;
    }
    return (
      <div className="gogo-extracts">
        {Object.entries(record.extracts).map(([key, items]) => (
          <div
            key={`${record.key}-extract-${key}`}
            className="gogo-extracts-row"
          >
            <Text strong>{key}</Text>
            <Space size={[4, 4]} wrap>
              {items.map((item, idx) => (
                <Tag
                  key={`${record.key}-extract-${key}-${idx}`}
                  color="default"
                >
                  {item}
                </Tag>
              ))}
            </Space>
          </div>
        ))}
      </div>
    );
  }, []);

  const tabItems = useMemo<TabsProps["items"]>(
    () => [
      {
        key: "results",
        label: "扫描结果",
        children: (
          <div className="gogo-tab-panel">
            <div className="gogo-toolbar">
              <Space size={8} wrap align="center">
                <Tooltip title="从后端刷新当前任务的最新状态和结果">
                  <Button onClick={refreshTask} disabled={!activeTaskId}>
                    刷新当前任务
                  </Button>
                </Tooltip>
                <Tooltip title="将当前任务的端口扫描结果导出为 CSV 文件">
                  <Button onClick={exportResults} disabled={!results.length}>
                    导出结果
                  </Button>
                </Tooltip>
              </Space>
              <Text type="secondary" className="gogo-toolbar-count">
                {`记录数：${results.length}`}
              </Text>
            </div>
            <Table
              rowKey="key"
              columns={resultColumns}
              dataSource={results}
              pagination={{ pageSize: 20, showSizeChanger: false }}
              size="small"
              scroll={{ x: 1600 }}
              className="gogo-table gogo-table-compact"
              expandable={{
                expandedRowRender: renderExtractsPanel,
                rowExpandable: (record) => hasExtracts(record),
              }}
            />
          </div>
        ),
      },
      {
        key: "tasks",
        label: "任务列表",
        children: (
          <div className="gogo-tab-panel">
            <div className="gogo-toolbar">
              <Text type="secondary">点击任务即可查看对应结果与日志</Text>
            </div>
            <Table
              rowKey="id"
              columns={taskColumns}
              dataSource={tasks}
              pagination={{ pageSize: 5, showSizeChanger: false }}
              size="small"
              className="gogo-table gogo-table-compact"
              onRow={(record) => ({
                onClick: () => updateActiveTask(record.id),
              })}
              rowClassName={(record) =>
                record.id === activeTaskId ? "gogo-active-row" : ""
              }
            />
          </div>
        ),
      },
      {
        key: "logs",
        label: "任务日志",
        children: (
          <div className="gogo-tab-panel">
            <div className="gogo-toolbar">
              <Text type="secondary">
                {activeTaskId
                  ? `任务 #${activeTaskId} 的实时日志`
                  : "暂无选中任务"}
              </Text>
            </div>
            <div className="gogo-log">
              {logs.length === 0 ? (
                <Text type="secondary">暂无日志</Text>
              ) : (
                logs.map((entry, index) => (
                  <div
                    key={`${entry.time}-${index}`}
                    className="gogo-log-entry"
                  >
                    <Text type="secondary">{entry.time}</Text>
                    <Text className="gogo-log-message">{entry.message}</Text>
                    {entry.status ? (
                      <Tag color="default">{entry.status}</Tag>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        ),
      },
    ],
    [
      activeTaskId,
      exportResults,
      logs,
      refreshTask,
      renderExtractsPanel,
      resultColumns,
      results,
      taskColumns,
      tasks,
      updateActiveTask,
    ],
  );

  const activeStatusKey = activeTask?.statusText?.toLowerCase?.() ?? "";
  const activeStatusLabel = activeTask
    ? (STATUS_TEXT_OVERRIDES[activeStatusKey] ?? activeTask.statusText ?? "-")
    : "-";
  const activeStatusColor = STATUS_COLORS[activeStatusKey] ?? "default";
  const activeMetrics = activeTask?.metrics;
  const uptimeMs = activeMetrics?.uptimeMs ?? 0;
  const isWarmup = uptimeMs >= 0 && uptimeMs < 3000;
  const ppsRaw = activeMetrics?.pps ?? 0;
  const formattedPps = Math.round((ppsRaw + Number.EPSILON) * 10) / 10;
  const displayedPps = activeMetrics
    ? isWarmup
      ? "预热中"
      : formattedPps
    : "-";
  const activeWorkerLabel =
    activeTask?.worker ?? activeTask?.params?.worker ?? undefined;
  const summaryMetrics = [
    {
      key: "targets",
      label: "目标",
      value: activeMetrics?.targetCount ?? 0,
      tooltip: "本次任务计划扫描的目标数量",
    },
    {
      key: "ports",
      label: "端口",
      value: activeMetrics?.portCount ?? 0,
      tooltip: "任务中即将探测的端口数量",
    },
    {
      key: "results",
      label: "结果",
      value: activeMetrics?.resultCount ?? results.length,
      tooltip: "已返回的有效扫描结果数量",
    },
    {
      key: "planned",
      label: "计划",
      value: activeMetrics?.planned ?? 0,
      tooltip: "需要执行的 IP×端口 组合总数",
    },
    {
      key: "enqueued",
      label: "已调度",
      value: activeMetrics?.enqueued ?? 0,
      tooltip: "已进入执行队列的任务数量",
    },
    {
      key: "started",
      label: "已开始",
      value: activeMetrics?.started ?? 0,
      tooltip: "已交由工作协程处理的任务数量",
    },
    {
      key: "succeeded",
      label: "成功",
      value: activeMetrics?.succeeded ?? 0,
      tooltip: "探测成功并返回开放结果的数量",
    },
    {
      key: "failed",
      label: "失败",
      value: activeMetrics?.failed ?? 0,
      tooltip: "探测失败或关闭的次数",
    },
    {
      key: "timedOut",
      label: "超时",
      value: activeMetrics?.timedOut ?? 0,
      tooltip: "遇到超时的任务次数",
    },
    {
      key: "active",
      label: "活动",
      value: activeMetrics?.active ?? 0,
      tooltip: "当前仍在执行中的任务数量",
    },
    {
      key: "pps",
      label: "速率",
      value: displayedPps,
      tooltip: isWarmup
        ? "速率预热中，等待稳定样本"
        : "过去一个时间片内平均每秒处理的任务数",
    },
  ];
  const activeTaskMessage = message || activeTask?.lastMessage || "";

  useEffect(() => {
    setNowTick(Date.now());
    if (isTaskRunning) {
      const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
      return () => window.clearInterval(timer);
    }
    return undefined;
  }, [isTaskRunning]);

  const runtimeLabel = useMemo(() => {
    if (activeMetrics?.uptimeMs && activeMetrics.uptimeMs > 0) {
      return formatDurationFromMs(activeMetrics.uptimeMs);
    }
    if (!activeTask) return "-";
    const start = activeTask.startedAt ?? activeTask.createdAt;
    if (!start) return "-";
    const end = activeTask.completedAt ?? activeTask.metrics?.lastResult;
    if (end) {
      return formatDuration(start, end);
    }
    if (isTaskRunning) {
      return formatDuration(start, new Date(nowTick));
    }
    return "-";
  }, [activeMetrics?.uptimeMs, activeTask, isTaskRunning, nowTick]);

  return (
    <div className="gogo-page">
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={8} className="gogo-column">
          <Card bordered={false} className="gogo-card" title="端口扫描配置">
            <Form
              form={form}
              layout="vertical"
              initialValues={DEFAULT_FORM}
              className="gogo-form"
              onValuesChange={(changedValues: Partial<FormState>) => {
                if (
                  Object.prototype.hasOwnProperty.call(changedValues, "ports")
                ) {
                  const nextPorts = (changedValues.ports ?? "") as string;
                  const preset = PORT_PRESETS.find(
                    (item) => item.value === nextPorts,
                  );
                  setPortPreset(preset?.value);
                }
                if (
                  Object.prototype.hasOwnProperty.call(
                    changedValues,
                    "concurrencyMode",
                  )
                ) {
                  const nextMode = changedValues.concurrencyMode;
                  if (nextMode === "manual") {
                    const current = toNumber(
                      form.getFieldValue("manualThreads"),
                      0,
                    );
                    if (current <= 0) {
                      form.setFieldsValue({
                        manualThreads: DEFAULT_FORM.manualThreads,
                      });
                    }
                  } else if (nextMode === "auto") {
                    const currentMax = toNumber(
                      form.getFieldValue("maxThreads"),
                      0,
                    );
                    if (currentMax <= 0) {
                      form.setFieldsValue({
                        maxThreads: DEFAULT_FORM.maxThreads,
                      });
                    }
                  }
                }
              }}
            >
              <Form.Item
                label="目标列表"
                name="targets"
                tooltip="支持 IP、域名、CIDR；多个目标可使用换行或分号分隔。"
                rules={[{ required: true, message: "请输入扫描目标" }]}
              >
                <TextArea
                  rows={4}
                  placeholder="每行一个目标或网段，例如 192.168.1.1 或 example.com"
                />
              </Form.Item>
              <Form.Item
                label="排除目标"
                name="excludeTargets"
                tooltip="可选，将会跳过这些目标的扫描，可填写 IP、CIDR 或域名。"
              >
                <TextArea
                  rows={3}
                  placeholder="按行或逗号填写需要跳过的 IP/CIDR/域名"
                />
              </Form.Item>
              <Form.Item
                label="端口预设"
                tooltip="快速选择常用端口组合，自动填充下方端口输入框。"
              >
                <Select
                  allowClear
                  placeholder="选择常用端口"
                  value={portPreset}
                  options={PORT_PRESETS}
                  style={{ width: "100%" }}
                  onChange={(value) => {
                    const presetValue = value ?? undefined;
                    setPortPreset(presetValue);
                    form.setFieldsValue({ ports: presetValue ?? "" });
                  }}
                />
              </Form.Item>
              <Form.Item
                label="端口"
                name="ports"
                tooltip="支持端口扫描内置标签（如 top1）或自定义端口列表，例如 80,443 或 1-65535。"
              >
                <Input placeholder="例如 top1 或 80,443,8080-8090" />
              </Form.Item>
              <Collapse
                bordered={false}
                size="small"
                className="gogo-advanced-collapse"
                defaultActiveKey={[]}
                items={[
                  {
                    key: "advanced",
                    label: (
                      <Tooltip title="更多高级配置项，可按需展开">
                        高级选项
                      </Tooltip>
                    ),
                    children: (
                      <div className="gogo-advanced">
                        <Form.Item
                          label="并发策略"
                          name="concurrencyMode"
                          tooltip="Auto 根据系统负载和速率上限自动扩缩；Manual 使用固定线程数。"
                        >
                          <Radio.Group buttonStyle="solid">
                            <Radio.Button value="auto">Auto</Radio.Button>
                            <Radio.Button value="manual">Manual</Radio.Button>
                          </Radio.Group>
                        </Form.Item>
                        {concurrencyMode === "manual" ? (
                          <Form.Item
                            label="手动线程数"
                            name="manualThreads"
                            tooltip="固定的工作线程数量。设得过高可能压垮本地或目标。"
                          >
                            <InputNumber min={1} style={{ width: "100%" }} />
                          </Form.Item>
                        ) : (
                          <Form.Item
                            label="最大线程上限"
                            name="maxThreads"
                            tooltip="自动模式的并发上限，用于避免在资源紧张时过量扩容。"
                          >
                            <InputNumber min={64} style={{ width: "100%" }} />
                          </Form.Item>
                        )}
                        <Row gutter={12}>
                          <Col span={12}>
                            <Form.Item
                              label="全局速率 (PPS)"
                              name="maxPps"
                              tooltip="限制全局每秒发起的探测数，防止对外造成洪峰。"
                            >
                              <InputNumber
                                min={100}
                                step={100}
                                style={{ width: "100%" }}
                              />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              label="单 IP 速率 (PPS)"
                              name="perIpMaxPps"
                              tooltip="限制单个目标每秒的探测数，避免局部压测。"
                            >
                              <InputNumber
                                min={10}
                                step={10}
                                style={{ width: "100%" }}
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Row gutter={12}>
                          <Col span={12}>
                            <Form.Item
                              label="延迟 (秒)"
                              name="delay"
                              tooltip="每个目标之间的延迟（秒），可减缓扫描速度以规避风控。"
                            >
                              <InputNumber min={0} style={{ width: "100%" }} />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              label="HTTPS 延迟 (秒)"
                              name="httpsDelay"
                              tooltip="对 HTTPS 请求额外等待的秒数，遇到慢速站点时可适当增加。"
                            >
                              <InputNumber min={0} style={{ width: "100%" }} />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Form.Item
                          label="指纹等级"
                          name="verbose"
                          tooltip="指纹识别等级，数值越高收集的指纹信息越多（0-3）。"
                        >
                          <InputNumber
                            min={0}
                            max={3}
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                        <Form.Item
                          label="Exploit"
                          name="exploit"
                          tooltip="指定 exploit 标签（例如 auto），用于联动端口扫描的漏洞验证能力。"
                        >
                          <Input placeholder="none、auto 或 exploit 标签" />
                        </Form.Item>
                        <Form.Item
                          label="工作流"
                          name="workflow"
                          tooltip="可选，填写端口扫描 workflow ID 以执行自定义流程。"
                        >
                          <Input placeholder="可选 workflow ID" />
                        </Form.Item>
                        <Row gutter={12}>
                          <Col span={12}>
                            <Form.Item
                              label="端口探测"
                              name="portProbe"
                              tooltip="探测端口存活的模板，默认 default 与扫描模式一致。"
                            >
                              <Input placeholder="默认 default" />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              label="IP 探测"
                              name="ipProbe"
                              tooltip="探测 IP 存活的模板，默认 default 与扫描模式一致。"
                            >
                              <Input placeholder="默认 default" />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Row gutter={12}>
                          <Col span={12}>
                            <Form.Item
                              label="Ping"
                              name="ping"
                              tooltip="启用后将在扫描前执行 ICMP Ping 探测。"
                              valuePropName="checked"
                            >
                              <Switch />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              label="仅探测"
                              name="noScan"
                              tooltip="只进行端口和主机探测，不执行后续的指纹识别。"
                              valuePropName="checked"
                            >
                              <Switch />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Row gutter={12}>
                          <Col span={12}>
                            <Form.Item
                              label="调试"
                              name="debug"
                              tooltip="输出调试级别日志，便于排查问题。"
                              valuePropName="checked"
                            >
                              <Switch />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              label="OPSEC"
                              name="opsec"
                              tooltip="启用更安全的扫描策略，降低对目标的影响。"
                              valuePropName="checked"
                            >
                              <Switch />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Row gutter={12}>
                          <Col span={12}>
                            <Form.Item
                              label="解析域名"
                              name="resolveHosts"
                              tooltip="启用后会对输入的域名解析全部 A/AAAA 记录。"
                              valuePropName="checked"
                            >
                              <Switch />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              label="解析 IPv6"
                              name="resolveIPv6"
                              tooltip="开启后会将域名解析的 IPv6 地址一并加入扫描。"
                              valuePropName="checked"
                            >
                              <Switch />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Row gutter={12}>
                          <Col span={12}>
                            <Form.Item
                              label="启用活性预检"
                              name="preflightEnabled"
                              tooltip="扫描前先对指定端口执行快速 TCP 探测，未通过的主机会跳过扫描。"
                              valuePropName="checked"
                            >
                              <Switch />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              label="预检超时 (毫秒)"
                              name="preflightTimeout"
                              tooltip="单个端口预检的超时时间，单位毫秒。"
                            >
                              <InputNumber
                                min={50}
                                step={50}
                                style={{ width: "100%" }}
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Form.Item
                          label="预检端口"
                          name="preflightPorts"
                          tooltip="用于活性预检的端口列表，使用逗号或范围表示。"
                        >
                          <Input placeholder="例如 80,443,53,3389" />
                        </Form.Item>
                        <Row gutter={12}>
                          <Col span={12}>
                            <Form.Item
                              label="允许回环地址"
                              name="allowLoopback"
                              tooltip="默认禁止扫描 127.0.0.1/::1 等回环地址，开启后才允许。"
                              valuePropName="checked"
                            >
                              <Switch />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              label="允许私网地址"
                              name="allowPrivate"
                              tooltip="默认跳过私网/内网 IP，开启后可对这些目标执行扫描。"
                              valuePropName="checked"
                            >
                              <Switch />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Form.Item
                          label="Worker 标识"
                          name="worker"
                          tooltip="用于区分执行节点的自定义标识。"
                        >
                          <Input placeholder="例如 worker-01" />
                        </Form.Item>
                      </div>
                    ),
                  },
                ]}
              />
            </Form>
            <Divider className="gogo-divider" />
            <div className="gogo-action-group">
              <Space wrap>
                <Tooltip title="开始一个新的端口扫描任务">
                  <Button type="primary" loading={loading} onClick={startTask}>
                    启动任务
                  </Button>
                </Tooltip>
                <Tooltip title="请求后端停止当前选中的任务">
                  <Button onClick={stopTask} disabled={!activeTaskId} danger>
                    停止任务
                  </Button>
                </Tooltip>
                <Tooltip title="立即向后端获取最新的任务状态">
                  <Button onClick={refreshTask} disabled={!activeTaskId}>
                    刷新状态
                  </Button>
                </Tooltip>
              </Space>
            </div>
            <Divider className="gogo-divider" />
            <div className="gogo-action-group">
              <Space wrap>
                <Tooltip title="从配置文件加载上一份端口扫描默认参数">
                  <Button onClick={loadDefaults}>恢复默认</Button>
                </Tooltip>
                <Tooltip title="将当前表单保存为新的默认配置">
                  <Button
                    type="dashed"
                    loading={savingDefaults}
                    onClick={saveDefaults}
                  >
                    保存为默认
                  </Button>
                </Tooltip>
              </Space>
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={16} className="gogo-column gogo-right-column">
          <Card bordered={false} className="gogo-card" title="任务概览">
            {activeTask ? (
              <div className="gogo-summary-card">
                <div className="gogo-summary-header">
                  <Space align="center" size={8} wrap>
                    <Text strong>{`任务 #${activeTask.id}`}</Text>
                    <Tooltip title={`状态代码：${activeTask.statusCode}`}>
                      <Tag color={activeStatusColor}>{activeStatusLabel}</Tag>
                    </Tooltip>
                    {activeWorkerLabel ? (
                      <Tag color="geekblue">Worker: {activeWorkerLabel}</Tag>
                    ) : null}
                  </Space>
                  {activeTaskMessage ? (
                    <Tooltip title="最后一条任务提示">
                      <Text type="secondary">{activeTaskMessage}</Text>
                    </Tooltip>
                  ) : null}
                </div>
                <div className="gogo-summary-metrics">
                  {summaryMetrics.map((metric) => (
                    <Tooltip key={metric.key} title={metric.tooltip}>
                      <div className="gogo-summary-metric">
                        <span className="gogo-summary-value">
                          {metric.value}
                        </span>
                        <span className="gogo-summary-label">
                          {metric.label}
                        </span>
                      </div>
                    </Tooltip>
                  ))}
                </div>
                <div className="gogo-summary-times">
                  <Tooltip title="任务创建时间">
                    <Text type="secondary">
                      创建：{formatDateTime(activeTask.createdAt)}
                    </Text>
                  </Tooltip>
                  <Tooltip title="任务开始时间">
                    <Text type="secondary">
                      开始：{formatDateTime(activeTask.startedAt)}
                    </Text>
                  </Tooltip>
                  <Tooltip title="若任务未完成，则显示当前累计耗时">
                    <Text type="secondary">耗时：{runtimeLabel}</Text>
                  </Tooltip>
                </div>
                {activeTask.error ? (
                  <Text type="danger">{`错误：${activeTask.error}`}</Text>
                ) : null}
              </div>
            ) : (
              <Text type="secondary">选择任务以查看进度和详情。</Text>
            )}
          </Card>
          <Card bordered={false} className="gogo-card">
            <Tabs
              items={tabItems}
              activeKey={activeTab}
              onChange={(key) => setActiveTab(key)}
              className="gogo-tabs"
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default Gogo;
