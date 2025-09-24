import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Empty,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import TextArea from "antd/es/input/TextArea";
import { ColumnsType } from "antd/es/table";
import Copy from "@/component/Copy";
import {
  PROCESS_LOOKUP,
  SoftwareSignature,
  CURATED_SIGNATURE_COUNT,
  LEGACY_SIGNATURE_COUNT,
  TOTAL_SIGNATURE_COUNT,
} from "@/config/securitySignatures";
import { sleep } from "@/util/util";

const { Text, Title, Paragraph } = Typography;

type ParsedProcess = {
  imageName: string;
  pid: string;
  services: string;
};

type MatchRow = {
  key: string;
  imageName: string;
  pid: string;
  services: string;
  category: SoftwareSignature["category"];
  displayName: string;
  description?: string;
};

const normalize = (value: string) => value.trim().toLowerCase();

const parseTasklistOutput = (raw: string): ParsedProcess[] => {
  const lines = raw.split(/\r?\n/).map((line) => line.trimEnd());
  const results: ParsedProcess[] = [];

  for (const line of lines) {
    if (!line) continue;
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes("image name") || lowerLine.includes("映像名称")) {
      continue;
    }
    if (/^[=\-\s]+$/.test(line)) {
      continue;
    }
    if (line.startsWith("INFO:")) {
      continue;
    }

    const matched = line.match(/^(.+?)\s+(\d+)\s+(.+)$/);
    if (matched) {
      const [, imageName, pid, services] = matched;
      results.push({
        imageName: imageName.trim(),
        pid: pid.trim(),
        services: services.trim(),
      });
    }
  }

  return results;
};

const buildMatchRows = (
  processes: ParsedProcess[],
): { matches: MatchRow[]; unknown: ParsedProcess[] } => {
  const matches: MatchRow[] = [];
  const unknown: ParsedProcess[] = [];

  processes.forEach((proc, index) => {
    const signature = PROCESS_LOOKUP.get(normalize(proc.imageName));
    if (signature) {
      matches.push({
        key: `${proc.imageName}-${proc.pid}-${signature.id}-${index}`,
        imageName: proc.imageName,
        pid: proc.pid,
        services: proc.services,
        category: signature.category,
        displayName: signature.displayName,
        description: signature.description,
      });
    } else {
      unknown.push(proc);
    }
  });

  return { matches, unknown };
};

const summaryByCategory = (matches: MatchRow[]) => {
  const counter = new Map<string, number>();
  matches.forEach((row) => {
    counter.set(row.category, (counter.get(row.category) || 0) + 1);
  });
  return Array.from(counter.entries()).map(([category, count]) => ({
    category,
    count,
  }));
};

const SecurityProcess: React.FC = () => {
  const [input, setInput] = useState<string>("");
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [unknown, setUnknown] = useState<ParsedProcess[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const columns: ColumnsType<MatchRow> = useMemo(
    () => [
      {
        title: "序号",
        dataIndex: "index",
        width: 70,
        align: "center",
        render: (_value, _row, index) => index + 1,
      },
      {
        title: "进程名",
        dataIndex: "imageName",
        width: 200,
        render: (value: string) => (
          <Copy text={value} placement="bottom">
            <Text>{value}</Text>
          </Copy>
        ),
      },
      {
        title: "PID",
        dataIndex: "pid",
        width: 100,
        render: (value: string) => <Text>{value}</Text>,
      },
      {
        title: "服务/说明",
        dataIndex: "services",
        render: (value: string) => (
          <Paragraph
            style={{ margin: 0, whiteSpace: "pre-wrap" }}
            ellipsis={{ rows: 3, expandable: true }}
          >
            {value}
          </Paragraph>
        ),
      },
      {
        title: "类别",
        dataIndex: "category",
        width: 150,
        render: (value: MatchRow["category"]) => (
          <Tag color="blue">{value}</Tag>
        ),
      },
      {
        title: "软件/产品",
        dataIndex: "displayName",
        width: 220,
        render: (value: string) => <Text strong>{value}</Text>,
      },
      {
        title: "备注",
        dataIndex: "description",
        render: (value?: string) =>
          value ? (
            <Text type="secondary">{value}</Text>
          ) : (
            <Text type="secondary">-</Text>
          ),
      },
    ],
    [],
  );

  const handleAnalyze = async () => {
    if (!input.trim()) {
      message.warning("请粘贴 tasklist /svc 输出内容");
      return;
    }
    setLoading(true);
    await sleep(100);
    try {
      const parsed = parseTasklistOutput(input);
      if (parsed.length === 0) {
        message.warning(
          "未识别到任何进程，请确认已复制完整的 tasklist /svc 输出",
        );
        setMatches([]);
        setUnknown([]);
        return;
      }
      const { matches: matchedRows, unknown: unknownRows } =
        buildMatchRows(parsed);
      setMatches(matchedRows);
      setUnknown(unknownRows);
      if (matchedRows.length === 0) {
        message.info("未匹配到预置的杀软或常用工具，可根据需要补充指纹库");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setInput("");
    setMatches([]);
    setUnknown([]);
  };

  const stats = useMemo(() => summaryByCategory(matches), [matches]);

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card title="使用说明" size="small">
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          <Paragraph style={{ marginBottom: 0 }}>
            1. 在目标 Windows 主机执行 <Text code>tasklist /svc</Text>
            ，将完整输出复制粘贴到下方输入框。
          </Paragraph>
          <Paragraph style={{ marginBottom: 0 }}>
            2. 点击 <Text strong>分析</Text>{" "}
            后，系统将识别常见杀软、安全软件、终端工具等信息，辅助进行主机环境研判。
          </Paragraph>
          <Paragraph style={{ marginBottom: 0 }}>
            指纹库当前预置 <Text strong>{CURATED_SIGNATURE_COUNT}</Text>{" "}
            组手动维护指纹，额外兼容{" "}
            <Text strong>{LEGACY_SIGNATURE_COUNT}</Text> 条 avList
            进程映射，共覆盖 <Text strong>{TOTAL_SIGNATURE_COUNT}</Text>{" "}
            个进程，可在 <Text code>config/securitySignatures.ts</Text> 中扩展。
          </Paragraph>
        </Space>
      </Card>
      <Card
        size="small"
        title="进程列表粘贴区"
        extra={<Text type="secondary">最长支持 20000 字符</Text>}
      >
        <TextArea
          value={input}
          onChange={(event) => setInput(event.target.value.slice(0, 20000))}
          autoSize={{ minRows: 10, maxRows: 18 }}
          placeholder={`示例:\nImage Name                     PID Services\n========================= ======== ============================================\nSystem Idle Process              0 N/A\nSystem                           4 N/A\nMsMpEng.exe                   1234 SecurityHealthService\n360Tray.exe                   5678 360Safe, 360FsFlt`}
        />
        <Space style={{ marginTop: 12 }}>
          <Button type="primary" onClick={handleAnalyze} loading={loading}>
            分析
          </Button>
          <Button onClick={handleClear} disabled={loading}>
            清空
          </Button>
        </Space>
      </Card>
      <Card size="small" title="识别结果">
        {matches.length > 0 ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Space wrap>
              <Tag color="processing">匹配到 {matches.length} 条进程</Tag>
              {stats.map((item) => (
                <Tag key={item.category} color="blue">
                  {item.category} × {item.count}
                </Tag>
              ))}
              <Tag color="default">未匹配 {unknown.length} 条</Tag>
            </Space>
            <Table
              size="small"
              bordered
              rowKey={(record) => record.key}
              dataSource={matches}
              columns={columns}
              pagination={false}
              scroll={{ x: "max-content", y: 400 }}
            />
          </Space>
        ) : loading ? (
          <Empty description="正在识别..." />
        ) : (
          <Empty description="尚未识别到预置指纹" />
        )}
      </Card>
      {unknown.length > 0 && (
        <Card size="small" title="未匹配进程">
          <Space direction="vertical" size={4} style={{ width: "100%" }}>
            {unknown.slice(0, 30).map((proc, index) => (
              <Text
                key={`${proc.imageName}-${proc.pid}-${index}`}
                type="secondary"
              >
                {proc.imageName} (PID: {proc.pid})
              </Text>
            ))}
            {unknown.length > 30 && (
              <Text type="secondary">
                ... 共 {unknown.length} 条未匹配记录，仅展示前 30 条。
              </Text>
            )}
          </Space>
        </Card>
      )}
    </Space>
  );
};

export default SecurityProcess;
