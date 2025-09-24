import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import TextArea from "antd/es/input/TextArea";
import {Button, Checkbox, Flex, Input, InputNumber, Modal, Select, Space, Splitter, Tag, Tooltip} from "antd";
import "@/pages/Httpx.css"
import {errorNotification} from "@/component/Notification";
import {BrowserOpenURL, EventsOn} from "../../wailsjs/runtime";
import {SyncOutlined} from "@ant-design/icons";
import {Run, SaveConfig as SaveHttpxConfig, Stop} from "../../wailsjs/go/httpx/Bridge";
import {useDispatch, useSelector} from "react-redux";
import {appActions, RootState} from "@/store/store";
import {Chrome} from "@/component/Icon";
import {copy, copyCol, copyRow, strSplit} from "@/util/util";
import TabsV2 from "@/component/TabsV2";
import {AgGridReact} from "ag-grid-react";
import {
    ColDef,
    GetContextMenuItemsParams,
    GetRowIdParams,
    ICellRendererParams,
    MenuItemDef,
    SideBarDef
} from "ag-grid-community";
import {config, event} from "../../wailsjs/go/models";
import LabelInput from "@/component/LabelInput";
import FileSelector from "@/component/FileSelector";
import {AGGridCommonOptions} from "@/pages/Props";
import {OpenDirectoryDialog, ShowItemInFolder} from "../../wailsjs/go/osoperation/Runtime";
import {Abs} from "../../wailsjs/go/osoperation/Path";
import EventDetail = event.EventDetail;

interface PageDataType {
    index: number;
    url: string;
    title?: string;
    statusCode?: number;
    contentLength?: number;
    technologies?: string;
    webserver?: string;
    ip?: string;
    screenshot?: string;
    screenshotPreview?: string;
    raw: string;
}

interface RunStats {
    exitCode: number;
    durationMs: number;
    lines: number;
    reason?: string;
    stopped: boolean;
}

const buildAutoFlagPreview = (httpx: config.Httpx): string => {
    const parts: string[] = [];
    const push = (enabled: boolean, flag: string) => {
        if (enabled) {
            parts.push(flag);
        }
    };
    push(httpx.Silent, "-silent");
    push(httpx.JSON, "-json");
    push(httpx.StatusCode, "-sc");
    push(httpx.Title, "-title");
    push(httpx.ContentLength, "-cl");
    push(httpx.TechnologyDetect, "-td");
    push(httpx.WebServer, "-server");
    push(httpx.IP, "-ip");
    if (httpx.Screenshot) {
        const mode = (httpx.ScreenshotMode || 'external').toLowerCase();
        if (mode === 'internal') {
            parts.push('[internal]');
        } else {
            parts.push("-screenshot");
            push(httpx.ScreenshotSystemChrome, "-system-chrome");
            if (httpx.ScreenshotDirectory?.trim()) {
                parts.push(`-srd "${httpx.ScreenshotDirectory.trim()}"`);
            }
        }
    }
    return parts.join(" ");
};

const formatDuration = (ms: number): string => {
    if (!ms || ms <= 0) {
        return "0ms";
    }
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const remainSeconds = seconds % 60;
    const remainMinutes = minutes % 60;
    const parts: string[] = [];
    if (hours) parts.push(`${hours}h`);
    if (remainMinutes) parts.push(`${remainMinutes}m`);
    if (remainSeconds) parts.push(`${remainSeconds}s`);
    const msRemain = ms % 1000;
    if (!parts.length || msRemain) {
        parts.push(`${msRemain}ms`);
    }
    return parts.join(" ");
};

const normalizeScreenshotPath = async (p?: string): Promise<string | undefined> => {
    if (!p || !p.trim()) {
        return undefined;
    }
    try {
        return await Abs(p.trim());
    } catch (e) {
        console.warn("failed to resolve screenshot path", p, e);
        return p.trim();
    }
};

const DEFAULT_SCREENSHOT_TIMEOUT_SECONDS = 15;

const parseDurationSeconds = (value?: string | null): number => {
    if (!value || typeof value !== 'string') {
        return DEFAULT_SCREENSHOT_TIMEOUT_SECONDS;
    }
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
        return DEFAULT_SCREENSHOT_TIMEOUT_SECONDS;
    }
    const match = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
    if (!match) {
        const fallback = Number(trimmed);
        if (Number.isFinite(fallback) && fallback > 0) {
            return Math.round(fallback);
        }
        return DEFAULT_SCREENSHOT_TIMEOUT_SECONDS;
    }
    const numeric = Number(match[1]);
    const unit = match[2] || 's';
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return DEFAULT_SCREENSHOT_TIMEOUT_SECONDS;
    }
    switch (unit) {
        case 'ms':
            return Math.max(1, Math.round(numeric / 1000));
        case 'm':
            return Math.max(1, Math.round(numeric * 60));
        case 'h':
            return Math.max(1, Math.round(numeric * 3600));
        default:
            return Math.max(1, Math.round(numeric));
    }
};

const secondsToDuration = (seconds: number): string => {
    const clamped = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : DEFAULT_SCREENSHOT_TIMEOUT_SECONDS;
    return `${clamped}s`;
};

const firstDefined = <T,>(...values: Array<T | null | undefined>): T | undefined => {
    for (const value of values) {
        if (value !== undefined && value !== null) {
            return value;
        }
    }
    return undefined;
};

const coerceNumber = (value: unknown): number | undefined => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return undefined;
        }
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
};

const coerceTechnologies = (value: unknown): string | undefined => {
    if (!value) {
        return undefined;
    }
    if (Array.isArray(value)) {
        const items = value.map(item => String(item).trim()).filter(Boolean);
        return items.length ? items.join(', ') : undefined;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || undefined;
    }
    return undefined;
};

const coerceIP = (data: Record<string, any>): string | undefined => {
    const primary = firstDefined(data['ip'], data['ip_address'], data['address']);
    if (typeof primary === 'string' && primary.trim()) {
        return primary.trim();
    }
    const records = data['a'];
    if (Array.isArray(records) && records.length > 0) {
        const candidate = records.map(item => String(item).trim()).find(Boolean);
        if (candidate) {
            return candidate;
        }
    }
    const host = data['host'];
    if (typeof host === 'string') {
        const trimmed = host.trim();
        if (/^\d+\.\d+\.\d+\.\d+$/.test(trimmed)) {
            return trimmed;
        }
    }
    return undefined;
};

const TabContent = () => {
    const gridRef = useRef<AgGridReact>(null);
    // const [path, setPath] = useState<string>("")
    // const [flags, setFlags] = useState<string>("")
    const [running, setRunning] = useState<boolean>(false)
    const [targets, setTargets] = useState<string>("")
    const [offset, setOffset] = useState<number>(1)
    const [limit, setLimit] = useState<number>(15)
    const taskID = useRef<number>(0)
    const dispatch = useDispatch()
    const cfg = useSelector((state: RootState) => state.app.global.config)
    const status = useSelector((state: RootState) => state.app.global.status)
    const httpxConfig = cfg.Httpx ?? config.Httpx.createFrom({})
    const [pageData, setPageData] = useState<PageDataType[]>([])
    const [total, setTotal] = useState(0)
    const totalRef = useRef(0)
    const event = useSelector((state: RootState) => state.app.global.event)
    const [runStats, setRunStats] = useState<RunStats | null>(null)
    const [previewVisible, setPreviewVisible] = useState(false)
    const [previewSrc, setPreviewSrc] = useState<string | null>(null)
    const [previewTitle, setPreviewTitle] = useState<string>("")
    const autoFlagPreview = useMemo(() => buildAutoFlagPreview(httpxConfig), [httpxConfig])
    const screenshotMode = (httpxConfig.ScreenshotMode || 'external').toLowerCase()
    const isInternalScreenshot = screenshotMode === 'internal'
    const screenshotTimeoutSeconds = parseDurationSeconds(httpxConfig.ScreenshotTimeout)
    const showImagePreview = useCallback((src: string, title?: string) => {
        if (!src) {
            return
        }
        setPreviewSrc(src)
        setPreviewTitle(title ?? "截图预览")
        setPreviewVisible(true)
    }, [])
    const closePreview = useCallback(() => {
        setPreviewVisible(false)
        setPreviewSrc(null)
    }, [])
    const openScreenshot = useCallback(async (path: string) => {
        if (!path) {
            return
        }
        const absPath = await normalizeScreenshotPath(path)
        if (!absPath) {
            errorNotification("提示", `无法打开截图: ${path}`)
            return
        }
        const normalized = absPath.replace(/\\/g, '/');
        const idx = normalized.lastIndexOf('/')
        if (idx <= 0) {
            errorNotification("提示", `无法打开截图: ${absPath}`)
            return
        }
        const dir = absPath.substring(0, idx)
        const filename = absPath.substring(idx + 1)
        ShowItemInFolder(dir, filename).catch(err => errorNotification("错误", err))
    }, [])

    const [columnDefs] = useState<ColDef[]>([
        {headerName: '序号', field: "index", width: 80, pinned: 'left', tooltipField: 'index'},
        {
            headerName: '状态码', field: "statusCode", width: 100, tooltipField: 'statusCode',
            cellRenderer: (params: ICellRendererParams) => {
                const value = params.value
                if (!value) return <></>
                const code = Number(value)
                const color = code >= 500 ? 'magenta' : code >= 400 ? 'red' : code >= 300 ? 'blue' : 'green'
                return <Tag color={color}>{code}</Tag>
            }
        },
        {
            headerName: '链接', field: "url", width: 320, tooltipField: 'url',
            cellRenderer: (params: ICellRendererParams) => {
                if (!params.value) return <></>
                return <Flex align={"center"} gap={6}>
                    <Chrome onClick={() => BrowserOpenURL(params.value)}/>
                    <span style={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{params.value}</span>
                </Flex>
            }
        },
        {headerName: '标题', field: "title", width: 260, tooltipField: 'title'},
        {headerName: '技术', field: "technologies", width: 220, tooltipField: 'technologies'},
        {headerName: '服务', field: "webserver", width: 200, tooltipField: 'webserver'},
        {headerName: 'IP', field: "ip", width: 160, tooltipField: 'ip'},
        {
            headerName: '长度', field: "contentLength", width: 110, tooltipField: 'contentLength',
            valueFormatter: (params) => params.value ? Number(params.value).toLocaleString() : ''
        },
        {
            headerName: '截图', field: "screenshot", width: 200, autoHeight: true,
            cellRenderer: (params: ICellRendererParams<PageDataType>) => {
                const path = params.value as string | undefined
                const preview = params.data?.screenshotPreview
                const hasPreview = typeof preview === 'string' && preview.trim().length > 0
                if (!hasPreview && !path) {
                    return <span style={{color: '#999'}}>无</span>
                }
                const handlePreview = () => {
                    if (hasPreview) {
                        showImagePreview(preview!, params.data?.url)
                    } else if (path) {
                        void openScreenshot(path)
                    }
                }
                const handleOpenDirectory = () => {
                    if (path) {
                        void openScreenshot(path)
                    }
                }
                return (
                    <Flex vertical align="center" gap={8} style={{width: '100%'}}>
                        {hasPreview
                            ? <img
                                src={preview!}
                                alt="httpx screenshot"
                                style={{maxWidth: '100%', maxHeight: 140, borderRadius: 6, cursor: 'pointer', objectFit: 'contain'}}
                                onClick={handlePreview}
                            />
                            : <Button size="small" onClick={handleOpenDirectory}>打开所在目录</Button>}
                        {path && hasPreview && (
                            <Button size="small" onClick={handleOpenDirectory}>
                                打开所在目录
                            </Button>
                        )}
                    </Flex>
                )
            }
        }
    ]);

    const updateHttpx = (patch: Partial<config.Httpx>) => {
        const nextHttpx = {...httpxConfig, ...patch};
        const next = {...cfg, Httpx: nextHttpx} as config.Config;
        SaveHttpxConfig(nextHttpx).then(() => {
            dispatch(appActions.setConfig(next))
        }).catch(err => {
            errorNotification("错误", err)
        })
    }

    const defaultSideBarDef = useMemo<SideBarDef>(() => {
        return {
            toolPanels: [
                {
                    id: "columns",
                    labelDefault: "分组",
                    labelKey: "columns",
                    iconKey: "columns",
                    toolPanel: "agColumnsToolPanel",
                    toolPanelParams: {
                        suppressRowGroups: false,
                        suppressValues: false,
                        suppressPivots: true,
                        suppressPivotMode: true,
                        suppressColumnFilter: false,
                        suppressColumnSelectAll: true,
                        suppressColumnExpandAll: true,
                    },
                },
            ],
        }
    }, [])
    const getContextMenuItems = useCallback((params: GetContextMenuItemsParams,): (MenuItemDef)[] => {
        if (total === 0 || !params.node) return []
        return [
            {
                name: "浏览器打开URL",
                disabled: !params.node?.data.url,
                action: () => {
                    BrowserOpenURL(params.node?.data.url)
                },
            },
            {
                name: "复制URL",
                disabled: !params.node?.data?.url,
                action: () => {
                    if (params.node?.data?.url) {
                        copy(params.node.data.url)
                    }
                },
            },
            {
                name: "复制单元格",
                disabled: !params.value,
                action: () => {
                    copy(params.value)
                },
            },
            {
                name: "复制该行",
                disabled: !params.node?.data,
                action: () => {
                    copyRow<PageDataType>(params.node?.data, gridRef.current?.api, columnDefs)
                },
            },
            {
                name: "复制该列",
                action: () => {
                    copyCol<PageDataType>(params.column, gridRef.current?.api)
                },
            },
            {
                name: "复制原始JSON",
                disabled: !params.node?.data?.raw,
                action: () => {
                    if (params.node?.data?.raw) {
                        copy(params.node.data.raw)
                    }
                },
            },
        ];
    }, [columnDefs, total]);

    useEffect(() => {
        const off = EventsOn(event.Httpx, (eventDetail: EventDetail) => {
            console.debug('[httpx] event', eventDetail);
            if (eventDetail.ID !== taskID.current) {
                return;
            }

            const payload: any = eventDetail.Data;
            if (eventDetail.Status === status.Running) {
                if (!payload || !Array.isArray(payload.lines)) {
                    return;
                }
                if (payload.stream && payload.stream !== "stdout") {
                    const lines = payload.lines as string[]
                    if (lines.length) {
                        console.warn(`[httpx:${payload.stream}]`, ...lines)
                    }
                    return;
                }

                const lines = payload.lines as string[]
                void (async () => {
                    const additions: PageDataType[] = []
                    for (const raw of lines) {
                        if (typeof raw !== "string") {
                            continue
                        }
                        const trimmed = raw.trim()
                        if (!trimmed) {
                            continue
                        }
                        let addition: PageDataType | null = null
                        if (trimmed.startsWith("{")) {
                            try {
                                const data = JSON.parse(trimmed)
                                const url = data.url || data["final-url"] || data["final_url"] || data["input"] || data["host"]
                                if (url) {
                                    const statusCodeRaw = firstDefined(
                                        data["status-code"],
                                        data["status_code"],
                                        data["statusCode"],
                                    )
                                    const contentLengthRaw = firstDefined(
                                        data["content-length"],
                                        data["content_length"],
                                        data["contentLength"],
                                    )
                                    const codeNum = coerceNumber(statusCodeRaw)
                                    const lengthNum = coerceNumber(contentLengthRaw)
                                    const techField = firstDefined(
                                        data["technologies"],
                                        data["tech"],
                                        data["technology"],
                                        data["techs"],
                                    )
                                    const technologies = coerceTechnologies(techField)
                                    const ipValue = coerceIP(data)
                                    const webserverRaw = firstDefined(
                                        data["webserver"],
                                        data["server"],
                                        data["fingerprint"],
                                    )
                                    const webserver = typeof webserverRaw === 'string' ? webserverRaw : undefined
                                    const screenshotRaw = data["screenshot"]
                                        || data["screenshot-path"]
                                        || data["screenshotPath"]
                                        || data["screenshot_path"]
                                        || data["screenshot_path_rel"]
                                    const screenshotBytes = data["screenshot_bytes"]
                                        || data["screenshot-bytes"]
                                        || data["screenshotBytes"]
                                    let screenshot: string | undefined
                                    let screenshotPreview: string | undefined
                                    if (screenshotRaw && typeof screenshotRaw === 'string') {
                                        screenshot = await normalizeScreenshotPath(screenshotRaw) || screenshotRaw
                                    }
                                    if (screenshotBytes && typeof screenshotBytes === 'string') {
                                        const trimmedBytes = screenshotBytes.trim()
                                        if (trimmedBytes) {
                                            screenshotPreview = `data:image/png;base64,${trimmedBytes}`
                                        }
                                    }
                                    totalRef.current = totalRef.current + 1
                                    addition = {
                                        index: totalRef.current,
                                        url: url,
                                        title: data["title"] || data["page-title"],
                                        statusCode: typeof codeNum === 'number' ? codeNum : undefined,
                                        contentLength: typeof lengthNum === 'number' ? lengthNum : undefined,
                                        technologies,
                                        webserver,
                                        ip: ipValue,
                                        screenshot,
                                        screenshotPreview,
                                        raw: trimmed,
                                    }
                                }
                            } catch (err) {
                                console.warn("failed to parse httpx json line", trimmed, err)
                            }
                        }
                        if (!addition) {
                            if (!trimmed.startsWith("http")) {
                                continue
                            }
                            const t = strSplit(trimmed, ' ', 2)
                            totalRef.current = totalRef.current + 1
                            addition = {
                                index: totalRef.current,
                                url: t[0],
                                title: t[1] || "",
                                raw: trimmed,
                            }
                        }
                        additions.push(addition)
                    }
                    if (additions.length > 0) {
                        console.debug('[httpx] additions', additions.length, additions.slice(0, 3))
                        setPageData(prev => [...prev, ...additions])
                        setTotal(totalRef.current)
                    }
                })()
                return
            }

            taskID.current = 0
            setRunning(false)
            setTotal(totalRef.current)

            if (eventDetail.Status === status.Error) {
                const reason = payload?.reason || eventDetail.Error || "httpx 运行失败"
                errorNotification("错误", reason)
                setRunStats({
                    exitCode: payload?.exitCode ?? -1,
                    durationMs: payload?.durationMs ?? 0,
                    lines: payload?.lines ?? totalRef.current,
                    reason,
                    stopped: false
                })
                return
            }

            const reason = payload?.reason
            if (reason && reason !== "completed") {
                const friendly = reason === "canceled" ? "任务已手动终止" : reason
                errorNotification("提示", friendly)
            }
            setRunStats({
                exitCode: payload?.exitCode ?? 0,
                durationMs: payload?.durationMs ?? 0,
                lines: payload?.lines ?? totalRef.current,
                reason: payload?.reason,
                stopped: true
            })
        })
        return () => {
            off()
        }
    }, [])

    const saveHttpxFlag = (flag: string | number | undefined) => {
        updateHttpx({Flags: (flag ?? "") as string})
    }

    const saveHttpxPath = (path: string) => {
        if (!path) return
        updateHttpx({Path: path})
    }

    const chooseScreenshotDirectory = async () => {
        try {
            const selected = await OpenDirectoryDialog()
            if (selected) {
                updateHttpx({ScreenshotDirectory: selected})
            }
        } catch (err) {
            errorNotification("错误", err)
        }
    }

    const chooseTempDirectory = async () => {
        try {
            const selected = await OpenDirectoryDialog()
            if (selected) {
                updateHttpx({TempDirectory: selected})
            }
        } catch (err) {
            errorNotification("错误", err)
        }
    }

    const run = () => {
        if (!httpxConfig.Path || !httpxConfig.Path.trim()) {
            errorNotification("错误", "请先选择 httpx 可执行文件路径")
            return
        }
        const trimmedTargets = targets.split(/\r?\n/).map(t => t.trim()).filter(Boolean)
        if (trimmedTargets.length === 0) {
            errorNotification("错误", "请至少输入一个待探测目标")
            return
        }
        setPageData([])
        setOffset(1)
        setLimit(15)
        setTotal(0)
        totalRef.current = 0
        setRunStats(null)
        console.debug('[httpx] run', {path: httpxConfig.Path, flags: httpxConfig.Flags, targets: trimmedTargets.length})
        const normalizedTargets = trimmedTargets.join('\n')
        Run(httpxConfig.Path.trim(), httpxConfig.Flags || "", normalizedTargets).then(r => {
            taskID.current = r
            setRunning(true)
        }).catch(err => {
            errorNotification("错误", err)
            setRunning(false)
        })
    }

    const stop = () => {
        Stop(taskID.current).then(r => {
            taskID.current = 0
            setRunning(false)
        }).catch(err => {
            errorNotification("错误", err)
        })
    }

    const BrowserOpenMultiUrl = () => {
        const sortedData: PageDataType[] = [];
        gridRef.current?.api.forEachNodeAfterFilterAndSort((node) => {
            sortedData.push(node.data);
        });
        const totalCount = sortedData?.length || 0
        if (!totalCount) return
        for (const data of sortedData.slice(offset - 1, offset - 1 + limit)) {
            BrowserOpenURL(data.url)
        }
        const nextOffset = offset + limit
        setLimit(nextOffset > totalCount ? 0 : limit)
        setOffset(nextOffset > totalCount ? totalCount : nextOffset)
    }

    return (
        <>
        <Flex vertical gap={8} style={{height: '100%'}}>
            <Flex gap={6} vertical>
                <Flex gap={10} justify={"center"} align={"center"} wrap>
                    <FileSelector label="Httpx路径" value={httpxConfig.Path} inputWidth={360} onSelect={saveHttpxPath}/>
                    <Tooltip title={"额外参数（将追加在默认参数之后），请勿包含 -l"} placement={"bottom"}>
                        <div><LabelInput label="额外参数" value={httpxConfig.Flags} onBlur={saveHttpxFlag}/></div>
                    </Tooltip>
                    {!running && <Button size={"small"} type="primary" onClick={run}>执行</Button>}
                    {running &&
                        <Button size={"small"} danger onClick={stop} icon={<SyncOutlined spin={running}/>}>终止</Button>}
                </Flex>
                <Flex wrap justify={"center"} gap={12}>
                    <Checkbox checked={httpxConfig.Silent} onChange={e => updateHttpx({Silent: e.target.checked})}>Silent (-silent)</Checkbox>
                    <Checkbox checked={httpxConfig.JSON} onChange={e => updateHttpx({JSON: e.target.checked})}>JSON (-json)</Checkbox>
                    <Checkbox checked={httpxConfig.StatusCode} onChange={e => updateHttpx({StatusCode: e.target.checked})}>状态码 (-sc)</Checkbox>
                    <Checkbox checked={httpxConfig.Title} onChange={e => updateHttpx({Title: e.target.checked})}>标题 (-title)</Checkbox>
                    <Checkbox checked={httpxConfig.ContentLength} onChange={e => updateHttpx({ContentLength: e.target.checked})}>长度 (-cl)</Checkbox>
                </Flex>
                <Flex wrap justify={"center"} gap={12}>
                    <Checkbox checked={httpxConfig.TechnologyDetect} onChange={e => updateHttpx({TechnologyDetect: e.target.checked})}>技术 (-td)</Checkbox>
                    <Checkbox checked={httpxConfig.WebServer} onChange={e => updateHttpx({WebServer: e.target.checked})}>服务 (-server)</Checkbox>
                    <Checkbox checked={httpxConfig.IP} onChange={e => updateHttpx({IP: e.target.checked})}>IP (-ip)</Checkbox>
                    <Checkbox checked={httpxConfig.Screenshot} onChange={e => updateHttpx({Screenshot: e.target.checked})}>截图</Checkbox>
                    <Select
                        size={"small"}
                        style={{width: 160}}
                        value={httpxConfig.ScreenshotMode || 'external'}
                        options={[
                            {value: 'external', label: 'httpx 内置 (-screenshot)'},
                            {value: 'internal', label: '内置 chromedp'},
                        ]}
                        disabled={!httpxConfig.Screenshot}
                        onChange={(value) => updateHttpx({ScreenshotMode: value})}
                    />
                    <Checkbox disabled={!httpxConfig.Screenshot || isInternalScreenshot} checked={httpxConfig.ScreenshotSystemChrome} onChange={e => updateHttpx({ScreenshotSystemChrome: e.target.checked})}>系统 Chrome (-system-chrome)</Checkbox>
                </Flex>
                <Flex gap={8} justify={"center"} align={"center"} wrap>
                    <Input
                        size={"small"}
                        style={{width: 280}}
                        disabled={!httpxConfig.Screenshot}
                        value={httpxConfig.ScreenshotDirectory}
                        placeholder={"截图目录 (-srd)"}
                        onChange={e => updateHttpx({ScreenshotDirectory: e.target.value})}
                    />
                    <Button size={"small"} onClick={chooseScreenshotDirectory} disabled={!httpxConfig.Screenshot}>选择目录</Button>
                </Flex>
                {httpxConfig.Screenshot && isInternalScreenshot && (
                    <>
                        <Flex gap={8} justify={"center"} align={"center"} wrap>
                            <Input
                                size={"small"}
                                style={{width: 280}}
                                value={httpxConfig.ScreenshotBrowserPath}
                                placeholder={"浏览器路径 (可选)"}
                                onChange={e => updateHttpx({ScreenshotBrowserPath: e.target.value})}
                            />
                            <InputNumber
                                size={"small"}
                                min={1}
                                max={600}
                                value={screenshotTimeoutSeconds}
                                style={{width: 140}}
                                formatter={(value) => (value ? `${value}s` : '')}
                                parser={(value) => {
                                    if (value == null) {
                                        return 0;
                                    }
                                    const numeric = Number(
                                        String(value).replace(/s/gi, ""),
                                    );
                                    return Number.isNaN(numeric) ? 0 : numeric;
                                }}
                                onChange={value => {
                                    if (value == null) {
                                        return
                                    }
                                    updateHttpx({ScreenshotTimeout: secondsToDuration(Number(value))})
                                }}
                            />
                        </Flex>
                        <Flex gap={8} justify={"center"} align={"center"} wrap>
                            <InputNumber
                                size={"small"}
                                min={320}
                                max={7680}
                                value={httpxConfig.ScreenshotViewportWidth ?? 1366}
                                style={{width: 140}}
                                placeholder={"宽度"}
                                onChange={value => {
                                    if (value == null) {
                                        return
                                    }
                                    updateHttpx({ScreenshotViewportWidth: Number(value)})
                                }}
                            />
                            <InputNumber
                                size={"small"}
                                min={240}
                                max={4320}
                                value={httpxConfig.ScreenshotViewportHeight ?? 768}
                                style={{width: 140}}
                                placeholder={"高度"}
                                onChange={value => {
                                    if (value == null) {
                                        return
                                    }
                                    updateHttpx({ScreenshotViewportHeight: Number(value)})
                                }}
                            />
                            <InputNumber
                                size={"small"}
                                min={0.5}
                                max={4}
                                step={0.1}
                                value={httpxConfig.ScreenshotDeviceScaleFactor ?? 1.0}
                                style={{width: 140}}
                                placeholder={"缩放"}
                                onChange={value => {
                                    if (value == null) {
                                        return
                                    }
                                    updateHttpx({ScreenshotDeviceScaleFactor: Number(value)})
                                }}
                            />
                        </Flex>
                        <Flex gap={8} justify={"center"} align={"center"} wrap>
                            <InputNumber
                                size={"small"}
                                min={50}
                                max={100}
                                value={httpxConfig.ScreenshotQuality ?? 90}
                                style={{width: 140}}
                                placeholder={"质量"}
                                onChange={value => {
                                    if (value == null) {
                                        return
                                    }
                                    updateHttpx({ScreenshotQuality: Number(value)})
                                }}
                            />
                            <InputNumber
                                size={"small"}
                                min={1}
                                max={8}
                                value={httpxConfig.ScreenshotConcurrency ?? 2}
                                style={{width: 140}}
                                placeholder={"并发"}
                                onChange={value => {
                                    if (value == null) {
                                        return
                                    }
                                    updateHttpx({ScreenshotConcurrency: Number(value)})
                                }}
                            />
                        </Flex>
                    </>
                )}
                <Flex gap={8} justify={"center"} align={"center"} wrap>
                    <Input
                        size={"small"}
                        style={{width: 280}}
                        value={httpxConfig.TempDirectory}
                        placeholder={"临时目录 (可选)"}
                        onChange={e => updateHttpx({TempDirectory: e.target.value})}
                    />
                    <Button size={"small"} onClick={chooseTempDirectory}>选择临时目录</Button>
                </Flex>
                <Flex justify={"center"} gap={10} wrap>
                    <Tag color="geekblue">默认参数: {autoFlagPreview || "无"}</Tag>
                    {httpxConfig.Flags?.trim() && <Tag color="purple">额外参数: {httpxConfig.Flags}</Tag>}
                </Flex>
                <Flex gap={20} justify={"center"} align={"center"}>
                    <Space.Compact size={"small"}>
                        <InputNumber style={{width: "150px"}} prefix={<div>总数:</div>} value={total} disabled/>
                        <InputNumber style={{width: "150px"}} prefix={<div>起始:</div>} min={1} value={offset}
                                     onChange={(value) => value && setOffset(value)}/>
                        <InputNumber style={{width: "150px"}} prefix={<div>长度:</div>} value={limit}
                                     onChange={(value) => value && setLimit(value)}/>
                        <Button onClick={BrowserOpenMultiUrl} disabled={!total || limit === 0}>默认浏览器打开下一组</Button>
                    </Space.Compact>
                </Flex>
                {runStats && <Flex justify={"center"} gap={16} wrap>
                    <Tag color={runStats.stopped ? "green" : "red"}>状态: {runStats.stopped ? "完成" : "失败"}</Tag>
                    <Tag color="blue">耗时: {formatDuration(runStats.durationMs)}</Tag>
                    <Tag color="gold">条目: {runStats.lines}</Tag>
                    <Tag color="cyan">退出码: {runStats.exitCode}</Tag>
                    {runStats.reason && runStats.reason !== "completed" && <Tag color="default">原因: {runStats.reason}</Tag>}
                </Flex>}
            </Flex>
            <Flex style={{height: '100%', padding: '5px', boxSizing: 'border-box'}}>
                <Splitter style={{overflow: "hidden"}}>
                    <Splitter.Panel defaultSize="30%" min="20%" max="70%">
                        <TextArea
                            style={{height: '100%'}}
                            size={"small"}
                            value={targets}
                            allowClear
                            onChange={e => setTargets(e.target.value)}
                            placeholder={"每行一个"}
                        />
                    </Splitter.Panel>
                    <Splitter.Panel>
                        <div style={{width: "100%", height: "100%"}}>
                            <AgGridReact
                                {...AGGridCommonOptions}
                                ref={gridRef}
                                rowData={pageData}
                                columnDefs={columnDefs}
                                getRowId={(params: GetRowIdParams) => String(params.data.index)}
                                getContextMenuItems={getContextMenuItems}
                                sideBar={defaultSideBarDef}
                            />
                        </div>
                    </Splitter.Panel>
                </Splitter>
            </Flex>
        </Flex>
        <Modal
            open={previewVisible}
            title={previewTitle || '截图预览'}
            footer={null}
            width={900}
            centered
            destroyOnClose
            onCancel={closePreview}
            bodyStyle={{textAlign: 'center'}}
        >
            {previewSrc && (
                <img
                    src={previewSrc}
                    alt={previewTitle}
                    style={{maxWidth: '100%', height: 'auto', borderRadius: 8}}
                />
            )}
        </Modal>
        </>
    );
}


const Httpx = () => {
    return <TabsV2 defaultTabContent={<TabContent/>}/>
}

export default Httpx;
