import {useMemo, useRef, useState} from 'react';
import {Button, Empty, Space, Spin, Table, Typography, message} from 'antd';
import type {ColumnsType} from 'antd/es/table';
import TextArea from 'antd/es/input/TextArea';
import {useSelector} from 'react-redux';
import {RootState} from '@/store/store';
import TabsV2 from '@/component/TabsV2';
import Copy from '../component/Copy';
import {sleep} from '@/util/util';
import {GetCurrentDomain, GetCurrentIP, GetHistoryIP} from '../../wailsjs/go/ip138/Bridge';

const {Text, Title} = Typography;

type ResultType = 'domain' | 'ip';

type QueryResult = {
    index: number;
    target: string;
    type: ResultType;
    current: string[];
    history: string[];
    message?: string;
};

const isIPAddress = (value: string): boolean => {
    const ipv4Pattern = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){2}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6Pattern = /^([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:){1,7}:$|^[0-9a-fA-F]{1,4}(:[0-9a-fA-F]{1,4}){1,7}$|^::$/;
    return ipv4Pattern.test(value) || ipv6Pattern.test(value);
};

const formatList = (items: Array<{[key: string]: string}> | undefined, key1: string, key2?: string) => {
    if (!items || !Array.isArray(items)) return [];
    return items.map((item) => {
        const first = item[key1] || '';
        const second = key2 ? (item[key2] || '') : '';
        return [first, second].filter(Boolean).join(' ').trim();
    }).filter(Boolean);
};

const TabContent: React.FC = () => {
    const [input, setInput] = useState<string>('');
    const [results, setResults] = useState<QueryResult[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const allowEnterPress = useSelector((state: RootState) => state.app.global.config?.QueryOnEnter.IP138);
    const cancelled = useRef<boolean>(false);

    const targets = useMemo(() => {
        const items = input
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean);
        return Array.from(new Set(items));
    }, [input]);

    const runQuery = async () => {
        if (loading) return;
        if (targets.length === 0) {
            message.warning('请输入至少一个域名或IP');
            return;
        }
        cancelled.current = false;
        setLoading(true);
        setResults([]);
        try {
            for (let i = 0; i < targets.length; i++) {
                if (cancelled.current) break;
                const target = targets[i];
                const type: ResultType = isIPAddress(target) ? 'ip' : 'domain';
                const item: QueryResult = {
                    index: i,
                    target,
                    type,
                    current: [],
                    history: [],
                };
                try {
                    if (type === 'domain') {
                        const currentResp: any = await GetCurrentIP(target);
                        if (cancelled.current) break;
                        if (currentResp?.message) {
                            item.message = currentResp.message;
                        } else {
                            item.current = formatList(currentResp?.items, 'ip', 'locationOrDate');
                            if (!cancelled.current) {
                                try {
                                    const historyResp: any = await GetHistoryIP(target);
                                    item.history = formatList(historyResp, 'ip', 'locationOrDate');
                                } catch (historyErr: any) {
                                    item.history = [];
                                    if (!item.message) {
                                        item.message = typeof historyErr === 'string' ? historyErr : historyErr?.message;
                                    }
                                }
                            }
                        }
                    } else {
                        const domains: any = await GetCurrentDomain(target);
                        item.current = formatList(domains, 'domain', 'date');
                    }
                } catch (err: any) {
                    item.message = typeof err === 'string' ? err : (err?.message || '查询失败');
                }
                setResults((prev) => [...prev, item]);
                if (!cancelled.current && i !== targets.length - 1) {
                    await sleep(300);
                }
            }
        } finally {
            setLoading(false);
            if (cancelled.current) {
                message.warning('已终止本次查询');
            }
        }
    };

    const stopQuery = () => {
        cancelled.current = true;
        if (loading) {
            message.info('等待当前查询完成后将停止');
        }
    };

    const columns: ColumnsType<QueryResult> = useMemo(() => {
        const renderList = (items: string[]) => {
            if (!items || items.length === 0) {
                return <Text type="secondary">-</Text>;
            }
            return (
                <div style={{maxHeight: 180, overflowY: 'auto'}}>
                    <Space direction="vertical" size={4} style={{width: '100%'}}>
                        {items.map((entry, idx) => (
                            <Copy key={`${entry}-${idx}`} text={entry} placement="bottom">
                                <Text>{entry}</Text>
                            </Copy>
                        ))}
                    </Space>
                </div>
            );
        };

        return [
            {
                title: '序号',
                dataIndex: 'index',
                width: 80,
                align: 'center',
                render: (_: number, __: QueryResult, rowIndex: number) => rowIndex + 1,
            },
            {
                title: '目标',
                dataIndex: 'target',
                width: 200,
                render: (value: string) => (
                    <Copy text={value} placement="bottom">
                        <Text>{value}</Text>
                    </Copy>
                ),
            },
            {
                title: '类型',
                dataIndex: 'type',
                width: 100,
                align: 'center',
                render: (value: ResultType) => (value === 'domain' ? '域名' : 'IP'),
            },
            {
                title: '当前结果',
                dataIndex: 'current',
                render: (current: string[], record: QueryResult) => {
                    if (record.message) {
                        return <Text type="danger">{record.message}</Text>;
                    }
                    return (
                        <div>
                            <Text strong style={{display: 'block', marginBottom: 4}}>
                                {record.type === 'domain' ? '当前IP' : '关联域名'}：
                            </Text>
                            {renderList(current)}
                        </div>
                    );
                },
            },
            {
                title: '历史记录',
                dataIndex: 'history',
                render: (history: string[], record: QueryResult) => {
                    if (record.type !== 'domain' || record.message) {
                        return <Text type="secondary">-</Text>;
                    }
                    return (
                        <div>
                            <Text strong style={{display: 'block', marginBottom: 4}}>历史记录：</Text>
                            {renderList(history)}
                        </div>
                    );
                },
            },
        ];
    }, []);

    return (
        <div style={{maxWidth: 960, margin: '0 auto'}}>
            <Space direction="vertical" size={12} style={{width: '100%'}}>
                <TextArea
                    placeholder="每行填写一个域名或IP，可混合批量查询"
                    autoSize={{minRows: 6, maxRows: 12}}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onPressEnter={(event) => {
                        if (!allowEnterPress) return;
                        if (event.shiftKey) return;
                        event.preventDefault();
                        runQuery();
                    }}
                />
                <Space>
                    <Button type="primary" onClick={runQuery} loading={loading}>
                        {loading ? '查询中' : '查询'}
                    </Button>
                    <Button onClick={() => {
                        if (loading) return;
                        setInput('');
                        setResults([]);
                    }} disabled={loading}>
                        清空
                    </Button>
                    {loading && (
                        <Button type="link" onClick={stopQuery} icon={<Spin size="small" />}>
                            终止
                        </Button>
                    )}
                </Space>
                <div>
                    <Text type="secondary">共 {targets.length} 个目标</Text>
                </div>
                {results.length === 0 && !loading ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                    <Table
                        size="middle"
                        bordered
                        rowKey={(record) => `${record.target}-${record.index}`}
                        dataSource={results}
                        columns={columns}
                        pagination={false}
                        loading={loading}
                        scroll={{x: 'max-content', y: 480}}
                    />
                )}
            </Space>
        </div>
    );
};

const IP138: React.FC = () => {
    return <TabsV2 defaultTabContent={<TabContent />} />;
};

export default IP138;
