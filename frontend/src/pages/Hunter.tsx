import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
    Button,
    Col,
    DatePicker,
    Flex,
    Input,
    InputNumber,
    Modal,
    Pagination,
    Popover,
    Row,
    Select,
    Spin,
    Switch,
    Tabs,
    Tag,
    Tooltip,
    Upload
} from 'antd';
import {CloudDownloadOutlined, InboxOutlined, LoadingOutlined, SearchOutlined, UserOutlined} from '@ant-design/icons';
import {errorNotification} from '@/component/Notification';
import {appActions, RootState, userActions} from '@/store/store';
import {useDispatch, useSelector} from 'react-redux';
import {ExportDataPanelProps} from './Props';
import {copy, getAllDisplayedColumnKeys, getSortedData, RangePresets} from '@/util/util';
import {config, event, hunter} from "../../wailsjs/go/models";
import {Export, GetUserInfo, Query, SetAuth} from "../../wailsjs/go/hunter/Bridge";
import {BrowserOpenURL, EventsOn} from "../../wailsjs/runtime";
import type {Tab} from 'rc-tabs/lib/interface';
import {Coin1, Dots} from "@/component/Icon";
import {md5} from "js-md5"
import {toUint8Array} from "js-base64";
import {WithIndex} from "@/component/Interface";
import TabLabel from "@/component/TabLabel";
import {TargetKey} from "@/pages/Constants";
import Candidate, {ItemType} from "@/component/Candidate";
import {FindByPartialKey} from "../../wailsjs/go/history/Bridge";
import {AgGridReact} from "ag-grid-react";
import {
    ColDef,
    GetContextMenuItemsParams,
    ITooltipParams,
    ProcessCellForExportParams,
    SideBarDef,
    ValueGetterParams
} from "ag-grid-community";
import Help from "@/pages/HunterUsage";
import {Fetch} from "../../wailsjs/go/application/Application";
import Password from "@/component/Password";
import Label from "@/component/Label";
import {AGGridCommonOptions} from "@/pages/Props";

const pageSizeOptions = [10, 20, 50, 100]

const defaultQueryOption: QueryOptions = {
    isWeb: 3,
    statusCode: "",
    portFilter: false,
    dateRange: []
}

interface TabContentProps {
    colDefs?: ColDef[] | undefined | null,
    input?: string,
    newTab?: (input: string, colDefs: ColDef[] | undefined | null, opts: QueryOptions) => void,
    queryOption?: QueryOptions
}

type PageDataType = WithIndex<hunter.Item>

interface QueryOptions {
    isWeb: 1 | 2 | 3;
    statusCode: string;
    portFilter: boolean;
    dateRange: string[]
}

const ExportDataPanel = (props: { id: number, total: number, currentPageSize: number }) => {
    const user = useSelector((state: RootState) => state.user.hunter)
    const [page, setPage] = useState<number>(0)
    const [pageSize, setPageSize] = useState<number>(props.currentPageSize)
    const [maxPage, setMaxPage] = useState<number>(0)
    const [cost, setCost] = useState<number>(0)
    const [status, setStatus] = useState<"" | "error" | "warning">("")
    const [isExporting, setIsExporting] = useState<boolean>(false)
    const [exportable, setExportable] = useState<boolean>(false)
    const dispatch = useDispatch()
    const [disable, setDisable] = useState<boolean>(false)
    const event = useSelector((state: RootState) => state.app.global.event)
    const stat = useSelector((state: RootState) => state.app.global.status)
    const exportID = useRef(0)

    useEffect(() => {
        EventsOn(event.HunterExport, (eventDetail: event.EventDetail) => {
            if (eventDetail.ID !== exportID.current) {
                return
            }
            setIsExporting(false)
            setDisable(false)
            if (eventDetail.Status === stat.Stopped) {
                GetUserInfo().then(
                    result => {
                        dispatch(userActions.setHunterUser({restToken: result}))
                    }
                )
            } else if (eventDetail.Status === stat.Error) {
                errorNotification("错误", eventDetail.Error)
            }
        })
    }, []);
    useEffect(() => {
        const maxPage = Math.ceil(props.total / pageSize)
        setMaxPage(maxPage)
        if (page >= maxPage) {
            setPage(maxPage)
            setCost(props.total)
        } else {
            setCost(page * pageSize)
        }
    }, [pageSize, props.total])

    const exportData = (pageNum: number) => {
        setIsExporting(true)
        setDisable(true)
        Export(props.id, pageNum, pageSize)
            .then(r => exportID.current = r)
            .catch(
                err => {
                    errorNotification("错误", err)
                    setIsExporting(false)
                    setDisable(false)
                }
            )
    }
    return <>
        <Button
            disabled={disable}
            size="small"
            onClick={() => setExportable(true)}
            icon={isExporting ? <LoadingOutlined/> : <CloudDownloadOutlined/>}
        >
            {isExporting ? "正在导出" : "导出结果"}
        </Button>
        <Modal
            {...ExportDataPanelProps}
            title="导出结果"
            open={exportable}
            onOk={() => {
                if ((maxPage === 0) || (maxPage > 0 && (maxPage < page || page <= 0))) {
                    setStatus("error")
                    return
                } else {
                    setStatus("")
                }
                setExportable(false)
                exportData(page)
            }}
            onCancel={() => {
                setExportable(false);
                setStatus("")
            }}
        >
            <span style={{display: 'grid', gap: "3px"}}>
                <Row>
                    <span style={{
                        display: 'flex',
                        flexDirection: "row",
                        gap: "10px",
                        backgroundColor: '#f3f3f3',
                        width: "100%"
                    }}>当前积分: <span style={{color: "red"}}>{user.RestQuota || 0}</span></span>
                </Row>
                <Row>
                    <Col span={10}>
                        <span>导出分页大小</span>
                    </Col>
                    <Col span={14}>
                        <Select
                            size='small'
                            style={{width: '80px'}}
                            defaultValue={pageSize}
                            options={pageSizeOptions.map(size => ({label: size.toString(), value: size}))}
                            onChange={(size) => {
                                setPageSize(size)
                            }}
                        />
                    </Col>
                </Row>
                <Row>
                    <Col span={10}>
                        <span style={{display: 'flex', whiteSpace: 'nowrap'}}>导出页数(max:{maxPage})</span>
                    </Col>
                    <Col span={14}>
                        <InputNumber
                            size='small'
                            status={status}
                            value={page}
                            min={0}
                            onChange={(value: number | null) => {
                                if (value) {
                                    if (value >= maxPage) {
                                        setPage(maxPage);
                                        setCost(props.total)
                                    } else {
                                        setCost(pageSize * value)
                                        setPage(value)
                                    }
                                }
                            }}
                            keyboard={true}
                        />=
                        <Input
                            style={{width: '100px'}}
                            size='small'
                            value={cost}
                            suffix={"积分"}
                        />
                    </Col>
                </Row>
            </span>
        </Modal></>
}

const TabContent: React.FC<TabContentProps> = (props) => {
    const gridRef = useRef<AgGridReact>(null);
    const [input, setInput] = useState<string>(props.input || "")
    const [inputCache, setInputCache] = useState<string>(input)
    const [queryOption, setQueryOption] = useState<QueryOptions>(props.queryOption || defaultQueryOption)
    const [loading, setLoading] = useState<boolean>(false)
    const [loading2, setLoading2] = useState<boolean>(false)
    const pageIDMap = useRef<{ [key: number]: number }>({})
    const [total, setTotal] = useState<number>(0)
    const [currentPage, setCurrentPage] = useState<number>(1)
    const [currentPageSize, setCurrentPageSize] = useState<number>(pageSizeOptions[0])
    const [clicked, setClicked] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [faviconUrl, setFaviconUrl] = useState("");
    const dispatch = useDispatch()
    const allowEnterPress = useSelector((state: RootState) => state.app.global.config?.QueryOnEnter.Assets)
    const event = useSelector((state: RootState) => state.app.global.event)
    const history = useSelector((state: RootState) => state.app.global.history)
    const status = useSelector((state: RootState) => state.app.global.status)
    const [pageData, setPageData] = useState<PageDataType[]>([])
    const [hasQueried, setHasQueried] = useState<boolean>(false)
    const [columnDefs] = useState<ColDef[]>(props.colDefs || [
        {headerName: '序号', field: "index", width: 80, pinned: 'left', tooltipField: 'index'},
        {headerName: 'URL', field: "url", width: 250, hide: true, tooltipField: 'url'},
        {headerName: '域名', field: "domain", width: 200, pinned: 'left', tooltipField: 'domain'},
        {headerName: 'IP', field: "ip", width: 150, tooltipField: 'ip'},
        {headerName: '端口', field: "port", width: 80, tooltipField: 'port',},
        {headerName: '协议', field: "protocol", width: 80, tooltipField: 'protocol',},
        {headerName: '网站标题', field: "web_title", width: 200, tooltipField: 'web_title',},
        {headerName: '备案号', field: "number", width: 180, tooltipField: 'number',},
        {headerName: '备案单位', field: "company", width: 100, tooltipField: 'company',},
        {headerName: '响应码', field: "status_code", width: 80, tooltipField: 'status_code',},
        {
            headerName: '组件', field: "component", width: 100,
            tooltipValueGetter: (params: ITooltipParams) => params.data?.component?.map((component: hunter.Component) => {
                return component.name + component.version
            })?.join(" | "),
            valueGetter: (params: ValueGetterParams) => params.data?.component?.map((component: hunter.Component) => {
                return component.name + component.version
            })?.join(" | ")
        },
        {headerName: '操作系统', field: "os", width: 100, hide: true, tooltipField: 'os'},
        {headerName: '城市', field: "city", width: 100, hide: true, tooltipField: 'city'},
        {headerName: '更新时间', field: "updated_at", width: 100, tooltipField: 'updated_at',},
        {headerName: 'web应用', field: "is_web", width: 100, hide: true, tooltipField: 'is_web'},
        {headerName: 'Banner', field: "banner", width: 100, hide: true, tooltipField: 'banner'},
        {headerName: '风险资产', field: "is_risk", width: 100, hide: true, tooltipField: 'is_risk'},
        {headerName: '注册机构', field: "as_org", width: 100, hide: true, tooltipField: 'as_org'},
        {headerName: '运营商', field: "isp", width: 100, hide: true, tooltipField: 'isp'},
    ]);
    const defaultSideBarDef = useMemo<SideBarDef>(() => {
        return {
            toolPanels: [
                {
                    id: "columns",
                    labelDefault: "表格字段",
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

    const processCellForClipboard = useCallback((params: ProcessCellForExportParams) => {
        return formattedValueForCopy(params.column?.getColId(), params.node?.data)
    }, []);
    const getContextMenuItems = useCallback((params: GetContextMenuItemsParams): any => {
        if (!pageData || pageData.length === 0 || !params.node) return []
        const cellValue = formattedValueForCopy(params.column?.getColId(), params.node?.data)
        return [
            {
                name: "浏览器打开URL",
                disabled: !params.node?.data.url,
                action: () => {
                    BrowserOpenURL(params.node?.data.url)
                },
            },
            {
                name: "查询C段",
                disabled: !params.node?.data.ip,
                action: () => {
                    props.newTab && props.newTab("ip=" + params.node?.data.ip + "/24", getColDefs(), queryOption)
                },
            },
            {
                name: "查询IP",
                disabled: !params.node?.data.ip,
                action: () => {
                    props.newTab && props.newTab("ip=" + params.node?.data.ip, getColDefs(), queryOption)
                },
            },
            {
                name: "查询标题",
                disabled: !params.node?.data.web_title,
                action: () => {
                    props.newTab && props.newTab("title=" + params.node?.data.web_title, getColDefs(), queryOption)
                },
            },
            'separator',
            {
                name: "复制单元格",
                disabled: !cellValue,
                action: () => {
                    copy(cellValue)
                },
            },
            {
                name: "复制该行",
                action: () => {
                    const data: PageDataType = params.node?.data
                    const values: any[] = [];
                    getAllDisplayedColumnKeys(gridRef.current?.api, columnDefs).forEach(key => {
                        values.push(formattedValueForCopy(key, data));
                    })
                    copy(values.join(gridRef.current?.api.getGridOption("clipboardDelimiter")))
                },
            },
            {
                name: "复制该列",
                action: () => {
                    const colValues = getSortedData<PageDataType>(gridRef.current?.api).map(item => {
                        return formattedValueForCopy(params.column?.getColId(), item)
                    })
                    copy(colValues.join('\n'))
                },
            },
            {
                name: "复制URL列",
                disabled: !params.node?.data?.ip,
                action: () => {
                    const colValues = getSortedData<PageDataType>(gridRef.current?.api).map(item => {
                        return formattedValueForCopy("url", item)
                    })
                    copy(colValues)
                },
            },
        ]
    }, [pageData, queryOption]);

    useEffect(() => {
        EventsOn(event.HunterQuery, function (eventDetail: event.EventDetail) {
            if (eventDetail.Status === status.Stopped)
                GetUserInfo().then(
                    result => {
                        dispatch(userActions.setHunterUser({restToken: result}))
                    }
                )
        })
        if (props.input) {
            handleNewQuery(input, currentPageSize)
        }
    }, [])

    const formattedValueForCopy = (colId: string | undefined, item: PageDataType) => {
        switch (colId) {
            case "component": {
                const tmp = item.component?.map((component: hunter.Component) => {
                    return component.name + component.version
                })
                return tmp?.join(" | ")
            }
            default:
                const t = item[colId as keyof PageDataType]
                return t === null ? undefined : t
        }
    }

    const getColDefs = () => {
        if (gridRef.current?.api) {
            return gridRef.current.api.getColumnDefs()
        }
        return columnDefs
    }

    const handleNewQuery = async (query: string, pageSize: number) => {
        const tmpInput = query.trim()
        setCurrentPageSize(pageSize)
        if (tmpInput === "") {
            setHasQueried(false)
            setInputCache("")
            setPageData([])
            setTotal(0)
            setCurrentPage(1)
            return
        }
        setInputCache(tmpInput)
        setHasQueried(true)
        setLoading(true)
        setCurrentPage(1)
        setTotal(0)
        pageIDMap.current = []
        Query(0, tmpInput, 1, pageSize, queryOption.dateRange[0] ? queryOption.dateRange[0] : "", queryOption.dateRange[1] ? queryOption.dateRange[1] : "", queryOption.isWeb, queryOption.statusCode, queryOption.portFilter).then(
            result => {
                let index = 0
                setPageData(result.items?.map((item) => {
                    const instance = new hunter.Item(item)
                    const {convertValues, ...reset} = instance
                    return {index: ++index, ...item, convertValues, ...reset}
                }))
                setTotal(result.total)
                setLoading(false)
                pageIDMap.current[1] = result.pageID
                dispatch(userActions.setHunterUser(result.User))
            }
        ).catch(
            err => {
                errorNotification("Hunter查询出错", err)
                setLoading(false)
                setPageData([])
            }
        )
    }

    const handlePaginationChange = async (newPage: number, newSize: number) => {
        if (!hasQueried) {
            return
        }
        //page发生变换，size使用原size
        if (newPage !== currentPage && newSize === currentPageSize) {
            setLoading(true)
            let pageID = pageIDMap.current[newPage]
            pageID = pageID ? pageID : 0
            Query(pageID, inputCache, newPage, currentPageSize, queryOption.dateRange[0] ? queryOption.dateRange[0] : "", queryOption.dateRange[1] ? queryOption.dateRange[1] : "", queryOption.isWeb, queryOption.statusCode, queryOption.portFilter).then(
                result => {
                    let index = (newPage - 1) * currentPageSize
                    setPageData(result.items.map(item => {
                        const instance = new hunter.Item(item)
                        const {convertValues, ...rest} = instance
                        return {index: ++index, ...rest, convertValues}
                    }))
                    setCurrentPage(newPage)
                    setTotal(result.total)
                    pageIDMap.current[newPage] = result.pageID
                    dispatch(userActions.setHunterUser(result.User))
                    setLoading(false)
                }
            ).catch(
                err => {
                    errorNotification("Hunter查询出错", err)
                    setLoading(false)
                }
            )
        }

        //size发生变换，page设为1
        if (newSize !== currentPageSize) {
            handleNewQuery(inputCache, newSize)
        }
    }

    const hide = () => {
        setClicked(false);
        setHovered(false);
    };

    const handleHoverChange = (open: boolean) => {
        setHovered(open);
        setClicked(false);
    };

    const handleClickChange = (open: boolean) => {
        setHovered(false);
        setClicked(open);
    };

    const getFaviconFromUrl = () => {
        if (!faviconUrl) {
            return
        }
        setLoading2(true)
        Fetch(faviconUrl)
            .then(data => {
                // @ts-ignore
                queryIconHash(toUint8Array(data).buffer)
            })
            .catch(error => {
                errorNotification("获取favicon出现错误", error);
            }).finally(() => {
            setLoading2(false)
        })

    }

    const queryIconHash = (iconArrayBuffer: string | ArrayBuffer | null | undefined) => {
        if (iconArrayBuffer instanceof ArrayBuffer) {
            const hash = md5(iconArrayBuffer)
            setInput(`web.icon="${hash}"`)
            handleNewQuery(`web.icon="${hash}"`, currentPageSize)
            hide()
        }
    }

    const iconSearchView = (
        <Popover
            placement={"bottom"}
            style={{width: 500}}
            content={<Button size={"small"} type={"text"}
                             onClick={() => handleClickChange(true)}>icon查询</Button>}
            trigger="hover"
            open={hovered}
            onOpenChange={handleHoverChange}
        >
            <Popover
                placement={"bottom"}
                title={"填入Icon URL或上传文件"}
                content={
                    <Spin spinning={loading2}>
                        <Flex vertical gap={5} style={{width: "600px"}}>
                            <Input
                                onChange={e => setFaviconUrl(e.target.value)}
                                size={"small"}
                                placeholder={"icon地址"}
                                suffix={<Button type='text' size="small" icon={<SearchOutlined/>}
                                                onClick={getFaviconFromUrl}/>}
                            />
                            <Upload.Dragger
                                showUploadList={false}
                                multiple={false}
                                customRequest={(options) => {
                                    const {file, onError} = options;
                                    ;
                                    if (file instanceof Blob) {
                                        const reader = new FileReader();
                                        reader.onload = (e) => {
                                            const arrayBuffer = e.target?.result;
                                            queryIconHash(arrayBuffer)
                                        };
                                        reader.readAsArrayBuffer(file);
                                    }
                                }
                                }
                            >
                                <p className="ant-upload-drag-icon">
                                    <InboxOutlined/>
                                </p>
                                <p className="ant-upload-hint">
                                    点击或拖拽文件
                                </p>
                            </Upload.Dragger>
                        </Flex>
                    </Spin>
                }
                trigger="click"
                open={clicked}
                onOpenChange={handleClickChange}
            >
                <Button size={"small"} type={"text"} icon={<Dots/>}/>
            </Popover>
        </Popover>
    )

    const footer = hasQueried ? (
        <Flex justify={"space-between"} align={'center'} style={{padding: '5px'}}>
            <Pagination
                showQuickJumper
                showSizeChanger
                total={total}
                pageSizeOptions={pageSizeOptions}
                defaultPageSize={pageSizeOptions[0]}
                defaultCurrent={1}
                current={currentPage}
                showTotal={(total) => `${total} items`}
                size="small"
                onChange={(page, size) => handlePaginationChange(page, size)}
            />
            <ExportDataPanel id={pageIDMap.current[1]} total={total}
                             currentPageSize={currentPageSize}/>
        </Flex>
    ) : null

    return <Flex vertical gap={5} style={{height: '100%'}}>
        <Flex vertical gap={5}>
            <Flex justify={"center"} align={'center'}>
                <Candidate<string>
                    size={"small"}
                    style={{width: 600}}
                    placeholder='Search...'
                    allowClear
                    value={input}
                    onSearch={(value) => handleNewQuery(value, currentPageSize)}
                    onPressEnter={(value) => {
                        if (!allowEnterPress) return
                        handleNewQuery(value, currentPageSize)
                    }}
                    items={[
                        {
                            onSelectItem: (item) => {
                                setInput(item.data)
                            },
                            fetch: async (v) => {
                                try {
                                    // @ts-ignore
                                    const response = await FindByPartialKey(history.Hunter, !v ? "" : v.toString());
                                    const a: ItemType<string>[] = response?.map(item => {
                                        const t: ItemType<string> = {
                                            value: item,
                                            label: item,
                                            data: item
                                        }
                                        return t;
                                    });
                                    return a;
                                } catch (e) {
                                    errorNotification("错误", String(e));
                                    return []; // 如果出现错误，返回空数组，避免组件出现异常
                                }
                            }
                        }
                    ]}
                />
                {iconSearchView}
                <Help/>
            </Flex>
            <Flex justify={"center"} align={'center'} gap={10}>
                <Flex gap={5} align={'center'}>
                    资产类型
                    <Select size="small"
                            style={{width: "110px"}}
                            defaultValue={3 as 1 | 2 | 3}
                            options={[{label: "web资产", value: 1}, {label: "非web资产", value: 2}, {
                                label: "全部",
                                value: 3
                            }]}
                            onChange={(value) => setQueryOption(prevState => ({...prevState, isWeb: value}))}/>
                </Flex>
                <DatePicker.RangePicker
                    presets={[
                        ...RangePresets,
                    ]}
                    style={{width: "230px"}}
                    size="small"
                    onChange={(_dates, dateStrings) => setQueryOption(prevState => ({
                        ...prevState,
                        dateRange: dateStrings
                    }))}
                    allowEmpty={[true, true]}
                    showNow
                />
                <Input style={{width: "300px"}} size="small" placeholder='状态码列表，以逗号分隔，如”200,401“'
                       onChange={(e) => setQueryOption(prevState => ({...prevState, statusCode: e.target.value}))}/>
                <Flex gap={5} align={'center'}>
                    数据过滤
                    <Switch size="small" checkedChildren="开启" unCheckedChildren="关闭"
                            onChange={(value) => setQueryOption(prevState => ({...prevState, portFilter: value}))}/>
                </Flex>
            </Flex>
        </Flex>
        <div style={{width: "100%", height: "100%"}}>
            <AgGridReact
                {...AGGridCommonOptions}
                ref={gridRef}
                loading={loading}
                embedFullWidthRows
                rowData={pageData}
                columnDefs={columnDefs}
                getContextMenuItems={getContextMenuItems}
                sideBar={defaultSideBarDef}
                processCellForClipboard={processCellForClipboard}
            />
        </div>
        {footer}
    </Flex>
}

const UserPanel = () => {
    const user = useSelector((state: RootState) => state.user.hunter)
    const [open, setOpen] = useState<boolean>(false)
    const dispatch = useDispatch()
    const cfg = useSelector((state: RootState) => state.app.global.config || new config.Config())

    const save = async (key: string) => {
        try {
            await SetAuth(key)
            const t = {...cfg, Hunter: {...cfg.Hunter, Token: key}} as config.Config;
            dispatch(appActions.setConfig(t))
            return true
        } catch (e) {
            errorNotification("错误", e)
            return false
        }
    }

    return <div style={{
        width: "auto",
        height: "23px",
        display: "flex",
        alignItems: "center",
        backgroundColor: "#f1f3f4",
        paddingRight: '10px'
    }}>
        <Flex align={"center"}>
            <Tooltip title="设置" placement={"bottom"}>
                <Button type='link' onClick={() => setOpen(true)}><UserOutlined/></Button>
            </Tooltip>
            <Flex gap={10}>
                <Tooltip title="剩余总积分,查询后自动获取" placement={"bottom"}>
                    <div style={{
                        display: 'flex',
                        alignItems: "center",
                        color: "#f5222d"
                    }}>
                        <Coin1/>
                        {user.RestQuota || 0}
                    </div>
                </Tooltip>
            </Flex>
        </Flex>
        <Modal
            open={open}
            onCancel={() => setOpen(false)}
            onOk={() => {
                setOpen(false)
            }}
            footer={null}
            closeIcon={null}
            width={600}
            destroyOnClose
        >
            <Flex vertical gap={10}>
                <Tag bordered={false} color="processing">
                    API信息
                </Tag>
                <Password labelWidth={100} value={cfg.Hunter.Token} label={"API key"} onSubmit={save}/>
                <Label labelWidth={100} value={user.AccountType} label={"账户类型"}/>
                <Label labelWidth={100} value={user.RestQuota} label={"剩余积分"}/>
            </Flex>
        </Modal>
    </div>
}

const Hunter = () => {
    const [activeKey, setActiveKey] = useState<string>("")
    const [items, setItems] = useState<Tab[]>([])
    const indexRef = useRef(1)

    useEffect(() => {
        const key = `${indexRef.current}`;
        setItems([{
            label: <TabLabel label={key}/>,
            key: key,
            children: <TabContent newTab={addTab}/>,
        }])
        setActiveKey(key)
    }, [])

    const onTabChange = (newActiveKey: string) => {
        setActiveKey(newActiveKey)
    };

    const addTab = (input: string, colDefs: ColDef[] | undefined | null, opts: QueryOptions) => {
        const newActiveKey = `${++indexRef.current}`;
        setActiveKey(newActiveKey)
        setItems(prevState => [
            ...prevState,
            {
                label: <TabLabel label={newActiveKey}/>,
                key: newActiveKey,
                children: <TabContent input={input} colDefs={colDefs} newTab={addTab} queryOption={opts}/>,
            },
        ])
    };

    const removeTab = (targetKey: TargetKey) => {
        const t = items.filter((item) => item.key !== targetKey);
        const newActiveKey = t.length && activeKey === targetKey ? t[t.length - 1]?.key : activeKey
        setItems(t)
        setActiveKey(newActiveKey)
    };

    const onEditTab = (
        targetKey: React.MouseEvent | React.KeyboardEvent | string,
        action: 'add' | 'remove',
    ) => {
        if (action === 'add') {
            addTab("", null, defaultQueryOption);
        } else {
            removeTab(targetKey);
        }
    };

    return (
        <Tabs
            style={{height: '100%', width: '100%'}}
            size="small"
            tabBarExtraContent={{
                right: <UserPanel/>
            }}
            type="editable-card"
            onChange={onTabChange}
            activeKey={activeKey}
            onEdit={onEditTab}
            items={items}
        />
    );
}

export default Hunter;
