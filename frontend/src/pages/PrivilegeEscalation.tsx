import { useMemo, useState } from "react";
import {
  BackTop,
  Button,
  Card,
  Empty,
  Input,
  Layout,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import Copy from "@/component/Copy";
import { PRIV_ESC_LIST, type PrivEscEntry } from "@/config/securitySignatures";

const { Text, Paragraph } = Typography;
const { Content } = Layout;

interface PrivEscRow extends PrivEscEntry {
  key: string;
  searchText: string;
  platformTokensNormalized: string[];
  kbListNormalized: string[];
}

interface AnalysedRow extends PrivEscRow {
  isPatched: boolean;
  matchedKBs: string[];
  missingKBs: string[];
}

const sanitizeToken = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const GENERIC_PLATFORM_TOKENS = new Set([
  "windows",
  "win",
  "microsoft",
  "server",
  "os",
]);

const pushToken = (collector: Set<string>, value: string) => {
  const token = sanitizeToken(value);
  if (token.length < 2) {
    return;
  }

  collector.add(token);

  if (token.startsWith("windows")) {
    const suffix = token.slice(7);
    if (suffix.length > 0) {
      collector.add(`win${suffix}`);
      if (suffix.length >= 2) {
        collector.add(suffix);
      }
    }
  } else if (token.startsWith("win") && token.length > 3) {
    const suffix = token.slice(3);
    if (suffix.length > 0) {
      collector.add(`windows${suffix}`);
      if (suffix.length >= 2) {
        collector.add(suffix);
      }
    }
  } else if (token.startsWith("server")) {
    const suffix = token.slice(6);
    if (suffix.length > 0) {
      if (suffix.length >= 2) {
        collector.add(suffix);
      }
      collector.add(`windows${suffix}`);
      collector.add(`win${suffix}`);
    }
  }
};

const collectPlatformTokens = (platforms: string): string[] => {
  const collector = new Set<string>();

  platforms
    .split(/[\\/、,，;\-\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => pushToken(collector, item));

  const windowsMatches = platforms.match(/Windows\s+\d+[A-Za-z0-9]*/gi);
  if (windowsMatches) {
    windowsMatches.forEach((pattern) => {
      pushToken(collector, pattern);
      const digits = pattern.match(/\d+[A-Za-z0-9]*/g);
      if (digits) {
        digits.forEach((d) => {
          pushToken(collector, `Windows${d}`);
          pushToken(collector, `Win${d}`);
          pushToken(collector, d);
        });
      }
    });
  }

  const serverMatches = platforms.match(/Server\s+\d+[A-Za-z0-9]*/gi);
  if (serverMatches) {
    serverMatches.forEach((pattern) => {
      pushToken(collector, pattern);
      const digits = pattern.match(/\d+[A-Za-z0-9]*/g);
      if (digits) {
        digits.forEach((d) => {
          pushToken(collector, `Server${d}`);
          pushToken(collector, d);
        });
      }
    });
  }

  const buildMatches = platforms.match(/\b\d{4,5}\b/g);
  if (buildMatches) {
    buildMatches.forEach((num) => pushToken(collector, num));
  }

  return Array.from(collector);
};

const normalizeKB = (value: string): string => {
  const upper = value.trim().toUpperCase();
  if (/^KB\d{6,7}$/.test(upper)) {
    return upper;
  }
  if (/^K\d{6,7}$/.test(upper)) {
    return `KB${upper.slice(1)}`;
  }
  const match = upper.match(/\d{6,7}/);
  return match ? `KB${match[0]}` : upper;
};

const extractKBs = (text: string): string[] => {
  const matches = text.match(/K\s*B?\d{6,7}/gi);
  if (!matches) return [];
  const normalized = matches.map((item) => normalizeKB(item));
  return Array.from(new Set(normalized));
};

const extractAutoPlatformTokens = (text: string) => {
  const tokens = new Set<string>();
  const labels: string[] = [];

  const extractValue = (raw: string) => {
    const colonSegments = raw.split(/[:：]/);
    if (colonSegments.length >= 2) {
      return colonSegments.slice(1).join(":").trim();
    }
    const parts = raw.trim().split(/\s{2,}/);
    if (parts.length >= 2) {
      return parts.slice(1).join(" ").trim();
    }
    return "";
  };

  const lines = text.split(/\r?\n/);
  lines.forEach((line) => {
    const lower = line.toLowerCase();
    if (lower.includes("os 名称") || lower.includes("os 名稱") || lower.includes("os name")) {
      const value = extractValue(line);
      if (value) {
        labels.push(value);
        collectPlatformTokens(value).forEach((token) => tokens.add(token));
      }
    }
    if (lower.includes("os 版本") || lower.includes("os version")) {
      const value = extractValue(line);
      if (value) {
        labels.push(value);
        collectPlatformTokens(value).forEach((token) => tokens.add(token));
      }
    }
  });

  return { tokens: Array.from(tokens), labels };
};

const PrivilegeEscalation: React.FC = () => {
  const [keyword, setKeyword] = useState<string>("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [kbInput, setKbInput] = useState<string>("");
  const [detectedKBs, setDetectedKBs] = useState<string[]>([]);
  const [autoPlatformTokens, setAutoPlatformTokens] = useState<string[]>([]);
  const [autoPlatformLabels, setAutoPlatformLabels] = useState<string[]>([]);
  const [showOnlyUnpatched, setShowOnlyUnpatched] = useState<boolean>(false);
  const [applyAutoFilter, setApplyAutoFilter] = useState<boolean>(true);
  const [hasAnalysed, setHasAnalysed] = useState<boolean>(false);

  const rows = useMemo<PrivEscRow[]>(() => {
    return PRIV_ESC_LIST.map((entry, index) => {
      const normalizedTokens = collectPlatformTokens(entry.platforms);
      const kbListNormalized = entry.kbList.map((kb) => normalizeKB(kb));
      return {
        ...entry,
        key: `${entry.id}-${index}`,
        searchText:
          `${entry.id} ${entry.kbList.join(" ")} ${entry.vector} ${entry.platforms}`.toLowerCase(),
        platformTokensNormalized: normalizedTokens,
        kbListNormalized,
      };
    });
  }, []);

  const platformOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((row) => {
      row.platformTokensNormalized.forEach((token) => {
        if (token.startsWith("windows") || token.startsWith("win")) {
          set.add(token);
        } else if (/^\d{2,4}h\d$/i.test(token)) {
          set.add(token);
        } else if (token.length >= 3) {
          set.add(token);
        }
      });
    });
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((token) => ({
        label: token,
        value: token,
      }));
  }, [rows]);

  const autoPlatformTokenSet = useMemo(() => {
    if (autoPlatformTokens.length === 0) {
      return new Set<string>();
    }
    const filtered = autoPlatformTokens.filter(
      (token) => !GENERIC_PLATFORM_TOKENS.has(token),
    );
    const effectiveTokens = filtered.length > 0 ? filtered : autoPlatformTokens;
    return new Set(effectiveTokens);
  }, [autoPlatformTokens]);

  const filteredRows = useMemo(() => {
    const trimmedKeyword = keyword.trim().toLowerCase();
    const manualPlatforms = selectedPlatforms.map((item) => item.toLowerCase());

    return rows.filter((row) => {
      if (trimmedKeyword && !row.searchText.includes(trimmedKeyword)) {
        return false;
      }

      if (manualPlatforms.length > 0) {
        const hasManualMatch = manualPlatforms.every((token) =>
          row.platformTokensNormalized.includes(token),
        );
        if (!hasManualMatch) {
          return false;
        }
      }

      if (applyAutoFilter && autoPlatformTokenSet.size > 0) {
        const hasAutoMatch = row.platformTokensNormalized.some((token) =>
          autoPlatformTokenSet.has(token),
        );
        if (!hasAutoMatch) {
          return false;
        }
      }

      return true;
    });
  }, [
    rows,
    keyword,
    selectedPlatforms,
    applyAutoFilter,
    autoPlatformTokenSet,
  ]);

  const shouldShowRows = useMemo(() => {
    if (hasAnalysed) {
      return true;
    }
    if (selectedPlatforms.length > 0) {
      return true;
    }
    if (keyword.trim().length > 0) {
      return true;
    }
    return false;
  }, [hasAnalysed, selectedPlatforms, keyword]);

  const filteredRowsForDisplay = useMemo(
    () => (shouldShowRows ? filteredRows : []),
    [filteredRows, shouldShowRows],
  );

  const kbSet = useMemo(() => new Set(detectedKBs), [detectedKBs]);

  const analysedRows = useMemo<AnalysedRow[]>(() => {
    return filteredRowsForDisplay.map((row) => {
      const matchedKBs = row.kbListNormalized.filter((kb) => kbSet.has(kb));
      const isPatched = matchedKBs.length > 0;
      const missingKBs = row.kbListNormalized.filter((kb) => !kbSet.has(kb));
      return {
        ...row,
        isPatched,
        matchedKBs,
        missingKBs,
      };
    });
  }, [filteredRowsForDisplay, kbSet]);

  const displayRows = useMemo(() => {
    if (showOnlyUnpatched) {
      return analysedRows.filter((row) => !row.isPatched);
    }
    return analysedRows;
  }, [analysedRows, showOnlyUnpatched]);

  const patchedCount = useMemo(
    () => analysedRows.filter((row) => row.isPatched).length,
    [analysedRows],
  );
  const unpatchedCount = analysedRows.length - patchedCount;

  const emptyDescription = shouldShowRows ? "未匹配到记录" : "粘贴补丁信息并点击分析";

  const handleAnalyseKB = () => {
    const extracted = extractKBs(kbInput);
    const auto = extractAutoPlatformTokens(kbInput);
    setDetectedKBs(extracted);
    setAutoPlatformTokens(auto.tokens);
    setAutoPlatformLabels(auto.labels);
    if (auto.tokens.length > 0) {
      setApplyAutoFilter(true);
    }
    setHasAnalysed(true);
  };

  const handleClearKB = () => {
    setKbInput("");
    setDetectedKBs([]);
    setAutoPlatformTokens([]);
    setAutoPlatformLabels([]);
    setHasAnalysed(false);
  };

  const columns: ColumnsType<AnalysedRow> = [
    {
      title: "编号",
      dataIndex: "id",
      width: 140,
      render: (value: string) => (
        <Copy text={value} placement="bottom">
          <Text strong>{value}</Text>
        </Copy>
      ),
    },
    {
      title: "KB 补丁",
      dataIndex: "kbList",
      render: (values: string[], row) => (
        <Space size={[6, 6]} wrap>
          {values.map((kb) => (
            <Copy key={`${row.key}-${kb}`} text={normalizeKB(kb)} placement="bottom">
              <Tag color="blue">{normalizeKB(kb)}</Tag>
            </Copy>
          ))}
        </Space>
      ),
    },
    {
      title: "漏洞组件 / 说明",
      dataIndex: "vector",
      width: 260,
      render: (value: string) => <Text>{value}</Text>,
    },
    {
      title: "适用系统",
      dataIndex: "platforms",
      width: 260,
      render: (value: string) => (
        <Paragraph
          style={{ marginBottom: 0 }}
          ellipsis={{ rows: 3, expandable: true }}
        >
          {value}
        </Paragraph>
      ),
    },
    {
      title: "补丁状态",
      dataIndex: "isPatched",
      width: 160,
      render: (_value: boolean, row) => {
        if (row.isPatched) {
          return (
            <Tag color="success">
              已安装 {row.matchedKBs.length ? row.matchedKBs.join(" / ") : "-"}
            </Tag>
          );
        }
        return (
          <Tag color="error">
            缺少 {row.missingKBs.length ? row.missingKBs.join(" / ") : "补丁"}
          </Tag>
        );
      },
    },
  ];

  return (
    <Layout style={{ height: "100%", overflow: "hidden" }}>
      <Content style={{ height: "100%", overflow: "auto", padding: 16 }}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Card size="small" title="使用说明">
            <Space direction="vertical" size={6} style={{ width: "100%" }}>
              <Paragraph style={{ marginBottom: 0 }}>
                提权辅助列表收录了常见的 Windows 内核 / 服务 / RDP 等漏洞编号与对应
                KB 补丁，可根据系统版本或补丁缺失情况快速定位潜在利用点。
              </Paragraph>
              <Paragraph style={{ marginBottom: 0 }}>
                支持按关键字模糊搜索（编号、KB、组件、平台等），可多选系统版本关键词
                进行筛选。数据覆盖经典 MS07~MS21 系列及 2022-2024 年常见 CVE
                （Win32k/CLFS/Installer 等提权），来源于社区整理，建议结合当下环境再次
                验证。
              </Paragraph>
              <Paragraph style={{ marginBottom: 0 }}>
                建议在目标主机执行 <Text code>wmic qfe get HotFixID</Text>、
                <Text code>systeminfo</Text>、<Text code>Get-HotFix</Text> 等命令，复制完整
                输出到下方输入框，快速识别缺失补丁。
              </Paragraph>
            </Space>
          </Card>

          <Card
            size="small"
            title="已安装补丁粘贴区"
            extra={<Text type="secondary">支持粘贴原始命令输出</Text>}
          >
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Input.TextArea
                value={kbInput}
                onChange={(event) => setKbInput(event.target.value)}
                autoSize={{ minRows: 8, maxRows: 16 }}
                placeholder={`示例：\nHotFixID\nKB5025224\nKB5003254\nKB4577015`}
              />
              <Space>
                <Button type="primary" onClick={handleAnalyseKB}>
                  分析补丁
                </Button>
                <Button onClick={handleClearKB}>清空</Button>
                {detectedKBs.length > 0 && (
                  <Tag color="processing">已识别 {detectedKBs.length} 条 KB</Tag>
                )}
              </Space>
            </Space>
          </Card>

          <Card size="small" title="筛选">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Input
                placeholder="输入编号、KB、组件、平台等关键字"
                allowClear
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
              <Select
                mode="multiple"
                allowClear
                placeholder="按系统版本过滤（可多选）"
                options={platformOptions}
                value={selectedPlatforms}
                onChange={setSelectedPlatforms}
                style={{ width: "100%" }}
                maxTagCount="responsive"
              />
              <Space wrap size={8}>
                <Tag color="processing">总计 {rows.length} 条</Tag>
                <Tag color="success">匹配条件 {filteredRowsForDisplay.length} 条</Tag>
                {analysedRows.length > 0 && (
                  <>
                    <Tag color="success">已安装 {patchedCount} 条</Tag>
                    <Tag color="error">缺失 {unpatchedCount} 条</Tag>
                  </>
                )}
                {selectedPlatforms.length > 0 && (
                  <Button type="link" onClick={() => setSelectedPlatforms([])}>
                    清除平台筛选
                  </Button>
                )}
                {autoPlatformLabels.length > 0 && (
                  <Space size={4}>
                    <Tag color="geekblue">
                      识别系统: {autoPlatformLabels[0]}
                      {autoPlatformLabels.length > 1 ? " ..." : ""}
                    </Tag>
                    <Switch
                      size="small"
                      checked={applyAutoFilter}
                      onChange={setApplyAutoFilter}
                    />
                    <Text type="secondary">仅显示匹配目标系统</Text>
                  </Space>
                )}
                <Space size={4}>
                  <Switch
                    size="small"
                    checked={showOnlyUnpatched}
                    onChange={setShowOnlyUnpatched}
                  />
                  <Text type="secondary">仅显示缺失补丁</Text>
                </Space>
              </Space>
            </Space>
          </Card>

          <Card size="small" title="提权补丁列表">
            {displayRows.length === 0 ? (
              <Empty description={emptyDescription} />
            ) : (
              <Table
                size="small"
                bordered
                rowKey={(record) => record.key}
                dataSource={displayRows}
                columns={columns}
                pagination={{
                  position: ["topRight", "bottomRight"],
                  pageSize: 15,
                  showSizeChanger: true,
                  pageSizeOptions: ["10", "15", "20", "30"],
                  showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${total} 条`,
                }}
                scroll={{ x: "max-content" }}
              />
            )}
          </Card>
        </Space>
        <BackTop visibilityHeight={200} />
      </Content>
    </Layout>
  );
};

export default PrivilegeEscalation;
