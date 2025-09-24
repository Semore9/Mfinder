import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  ExportOutlined,
  ImportOutlined,
  PlayCircleOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  ConfigProvider,
  Empty,
  Flex,
  Modal,
  Space,
  Splitter,
  Switch,
  Tooltip,
  Typography,
  message,
} from "antd";
import TextArea from "antd/es/input/TextArea";
import locale from "antd/locale/zh_CN";
import { CssConfig } from "@/pages/Constants";
import { operations, operationMap } from "@/pages/cipher/operations";
import type {
  Operation,
  OperationId,
  PipelineStep,
  StepExecutionState,
} from "@/pages/cipher/types";
import "./Cipher.css";

const { Text, Title } = Typography;

type OperationByCategory = {
  category: string;
  items: Operation[];
};

type SerializedStep = {
  operationId: OperationId;
  config?: any;
};

type SerializedPipeline = {
  version?: number;
  steps?: SerializedStep[];
  pipeline?: SerializedStep[];
};

const Cipher: React.FC = () => {
  const [messageApi, contextHolder] = message.useMessage();
  const [inputValue, setInputValue] = useState<string>("");
  const [outputValue, setOutputValue] = useState<string>("");
  const [pipeline, setPipeline] = useState<PipelineStep[]>([]);
  const [stepStates, setStepStates] = useState<Record<string, StepExecutionState>>({});
  const [autoRun, setAutoRun] = useState<boolean>(true);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [importText, setImportText] = useState<string>("");
  const [importError, setImportError] = useState<string | null>(null);

  const idRef = useRef<number>(0);

  const operationGroups = useMemo<OperationByCategory[]>(() => {
    const grouped = new Map<string, Operation[]>();
    operations.forEach((operation) => {
      if (!grouped.has(operation.category)) {
        grouped.set(operation.category, []);
      }
      grouped.get(operation.category)!.push(operation);
    });
    return Array.from(grouped.entries()).map(([category, items]) => ({
      category,
      items,
    }));
  }, []);

  const selectStep = useCallback((stepId: string) => {
    setSelectedStepId((prev) => (prev === stepId ? null : stepId));
  }, []);

  const addOperation = useCallback((operationId: OperationId) => {
    const operation = operationMap[operationId];
    if (!operation) return;
    const stepId = `step-${idRef.current++}`;
    const step: PipelineStep = {
      id: stepId,
      operationId: operation.id,
      config: operation.createConfig(),
    };
    setPipeline((prev) => [...prev, step]);
    setStepStates((prev) => ({ ...prev, [stepId]: {} }));
  }, []);

  const updateStepConfig = useCallback((stepId: string, config: any) => {
    setPipeline((prev) =>
      prev.map((step) => (step.id === stepId ? { ...step, config } : step)),
    );
  }, []);

  const removeStep = useCallback((stepId: string) => {
    setPipeline((prev) => prev.filter((step) => step.id !== stepId));
    setStepStates((prev) => {
      if (!(stepId in prev)) return prev;
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
    setSelectedStepId((prev) => (prev === stepId ? null : prev));
  }, []);

  const moveStep = useCallback((stepId: string, direction: number) => {
    if (direction === 0) return;
    setPipeline((prev) => {
      const index = prev.findIndex((step) => step.id === stepId);
      if (index < 0) return prev;
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      next.splice(targetIndex, 0, removed);
      return next;
    });
  }, []);

  const clearPipeline = useCallback(() => {
    setPipeline([]);
    setStepStates({});
    setSelectedStepId(null);
    setOutputValue(inputValue);
  }, [inputValue]);

  const handleExportPipeline = useCallback(async () => {
    if (pipeline.length === 0) {
      messageApi.warning("流水线为空，无法导出");
      return;
    }
    const payload: SerializedPipeline = {
      version: 1,
      steps: pipeline.map((step) => ({
        operationId: step.operationId,
        config: step.config,
      })),
    };
    const serialized = JSON.stringify(payload, null, 2);
    try {
      const clipboard =
        typeof navigator !== "undefined" ? navigator.clipboard : undefined;
      if (!clipboard?.writeText) {
        throw new Error("Clipboard API 不可用");
      }
      await clipboard.writeText(serialized);
      messageApi.success("配方已复制到剪贴板");
    } catch (_error) {
      Modal.info({
        title: "导出配方",
        width: 560,
        content: (
          <div className="cipher-export-preview">
            <pre>{serialized}</pre>
          </div>
        ),
      });
      messageApi.warning("无法访问剪贴板，请手动复制");
    }
  }, [messageApi, pipeline]);

  const openImportModal = useCallback(() => {
    setImportError(null);
    setImportModalOpen(true);
  }, []);

  const handleImportCancel = useCallback(() => {
    setImportModalOpen(false);
    setImportError(null);
  }, []);

  const handleImportConfirm = useCallback(() => {
    try {
      setImportError(null);
      const trimmed = importText.trim();
      if (!trimmed) {
        throw new Error("请输入配方内容");
      }
      const parsed = JSON.parse(trimmed) as SerializedPipeline | SerializedStep[];
      let rawSteps: any[] | null = null;
      if (Array.isArray(parsed)) {
        rawSteps = parsed;
      } else if (parsed && Array.isArray(parsed.steps)) {
        rawSteps = parsed.steps;
      } else if (parsed && Array.isArray(parsed.pipeline)) {
        rawSteps = parsed.pipeline;
      }
      if (!rawSteps) {
        throw new Error("未找到 steps 数组");
      }
      if (rawSteps.length === 0) {
        setPipeline([]);
        setStepStates({});
        setSelectedStepId(null);
        setImportModalOpen(false);
        messageApi.success("已导入空配方");
        return;
      }
      const nextSteps: PipelineStep[] = rawSteps.map((item, index) => {
        if (!item || typeof item !== "object") {
          throw new Error(`第 ${index + 1} 个步骤格式错误`);
        }
        const operationId = item.operationId as OperationId;
        const operation = operationId ? operationMap[operationId] : undefined;
        if (!operation) {
          throw new Error(`第 ${index + 1} 个步骤使用了未知操作: ${item.operationId}`);
        }
        const baseConfig = operation.createConfig();
        let config = item.config;
        if (config == null) {
          config = baseConfig;
        } else if (typeof baseConfig === "object" && baseConfig !== null) {
          config = { ...baseConfig, ...config };
        }
        const stepId = `step-${idRef.current++}`;
        return { id: stepId, operationId: operation.id, config };
      });
      setPipeline(nextSteps);
      setStepStates({});
      setSelectedStepId(nextSteps[0]?.id ?? null);
      setImportModalOpen(false);
      messageApi.success(`成功导入 ${nextSteps.length} 个步骤`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }, [importText, messageApi]);

  const executePipeline = useCallback(() => {
    setIsRunning(true);
    try {
      if (pipeline.length === 0) {
        setStepStates({});
        setOutputValue(inputValue);
        return;
      }
      const nextStates: Record<string, StepExecutionState> = {};
      let current = inputValue;
      for (const step of pipeline) {
        const operation = operationMap[step.operationId];
        if (!operation) {
          nextStates[step.id] = { error: `未知操作: ${step.operationId}` };
          break;
        }
        try {
          const result = operation.run(current, step.config);
          current = result;
          nextStates[step.id] = { output: result };
        } catch (error) {
          const messageText =
            error instanceof Error ? error.message : String(error);
          nextStates[step.id] = { error: messageText };
          break;
        }
      }
      for (const step of pipeline) {
        if (!nextStates[step.id]) {
          nextStates[step.id] = {};
        }
      }
      setStepStates(nextStates);
      setOutputValue(current);
    } finally {
      setIsRunning(false);
    }
  }, [inputValue, pipeline]);

  useEffect(() => {
    if (autoRun) {
      executePipeline();
    }
  }, [autoRun, inputValue, pipeline, executePipeline]);

  useEffect(() => {
    setSelectedStepId((prev) =>
      prev && pipeline.find((step) => step.id === prev) ? prev : null,
    );
  }, [pipeline]);

  const selectedStepIndex = selectedStepId
    ? pipeline.findIndex((step) => step.id === selectedStepId)
    : -1;
  const displayedOutput =
    selectedStepId && selectedStepIndex !== -1
      ? stepStates[selectedStepId]?.output ?? ""
      : outputValue;
  const outputLabel =
    selectedStepId && selectedStepIndex !== -1
      ? `输出（步骤 ${selectedStepIndex + 1}）`
      : "输出（最终）";

  return (
    <ConfigProvider
      locale={locale}
      theme={{ components: { Tree: { nodeSelectedBg: "#ffffff" } } }}
    >
      {contextHolder}
      <Splitter
        style={{
          height: `calc(100vh - ${CssConfig.title.height} - ${CssConfig.tab.height})`,
        }}
      >
        <Splitter.Panel defaultSize="22%">
          <div className="cipher-panel cipher-panel-operations">
            <Flex vertical gap={16}>
              <Title level={5} style={{ margin: 0 }}>
                操作列表
              </Title>
              {operationGroups.map((group) => (
                <div key={group.category} className="cipher-operations-group">
                  <Text strong>{group.category}</Text>
                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                    {group.items.map((operation) => (
                      <Tooltip
                        key={operation.id}
                        placement="right"
                        title={operation.description || operation.name}
                      >
                        <Button
                          block
                          icon={<PlusOutlined />}
                          onClick={() => addOperation(operation.id)}
                        >
                          {operation.name}
                        </Button>
                      </Tooltip>
                    ))}
                  </Space>
                </div>
              ))}
            </Flex>
          </div>
        </Splitter.Panel>
        <Splitter.Panel defaultSize="28%">
          <div className="cipher-panel cipher-panel-pipeline">
            <Flex vertical gap={12} style={{ height: "100%" }}>
              <Flex align="center" justify="space-between">
                <Title level={5} style={{ margin: 0 }}>
                  操作流水线
                </Title>
                <Space size={8}>
                  <Button
                    size="small"
                    icon={<ExportOutlined />}
                    onClick={handleExportPipeline}
                    disabled={!pipeline.length}
                  >
                    导出
                  </Button>
                  <Button
                    size="small"
                    icon={<ImportOutlined />}
                    onClick={openImportModal}
                  >
                    导入
                  </Button>
                  <Button
                    size="small"
                    onClick={clearPipeline}
                    disabled={!pipeline.length}
                  >
                    清空
                  </Button>
                </Space>
              </Flex>
              <div className="cipher-pipeline-list">
                {pipeline.length === 0 ? (
                  <Flex
                    align="center"
                    justify="center"
                    style={{ height: "100%" }}
                  >
                    <Empty description="添加操作以构建流水线" />
                  </Flex>
                ) : (
                  pipeline.map((step, index) => {
                    const operation = operationMap[step.operationId];
                    const FormComponent = operation?.Form as
                      | React.FC<any>
                      | undefined;
                    const state = stepStates[step.id];
                    const isActive = selectedStepId === step.id;
                    const hasError = Boolean(state?.error);
                    return (
                      <Card
                        key={step.id}
                        size="small"
                        className={`cipher-step-card${
                          isActive ? " cipher-step-card-active" : ""
                        }${hasError ? " cipher-step-card-error" : ""}`}
                        onClick={() => selectStep(step.id)}
                        bodyStyle={{ padding: 12 }}
                      >
                        <Flex justify="space-between" align="center">
                          <Space size={6}>
                            <Text strong>{index + 1}.</Text>
                            <Text>{operation?.name || step.operationId}</Text>
                          </Space>
                          <Space size={4}>
                            <Tooltip title="上移">
                              <Button
                                size="small"
                                type="text"
                                icon={<ArrowUpOutlined />}
                                disabled={index === 0}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  moveStep(step.id, -1);
                                }}
                              />
                            </Tooltip>
                            <Tooltip title="下移">
                              <Button
                                size="small"
                                type="text"
                                icon={<ArrowDownOutlined />}
                                disabled={index === pipeline.length - 1}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  moveStep(step.id, 1);
                                }}
                              />
                            </Tooltip>
                            <Tooltip title="删除">
                              <Button
                                size="small"
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeStep(step.id);
                                }}
                              />
                            </Tooltip>
                          </Space>
                        </Flex>
                        {FormComponent ? (
                          <div className="cipher-step-form">
                            <FormComponent
                              config={step.config}
                              onChange={(config: any) =>
                                updateStepConfig(step.id, config)
                              }
                            />
                          </div>
                        ) : null}
                        {hasError ? (
                          <Text type="danger">{state?.error}</Text>
                        ) : state?.output !== undefined ? (
                          <div className="cipher-step-preview">
                            <Text type="secondary">输出预览：</Text>
                            <pre>{state.output || ""}</pre>
                          </div>
                        ) : null}
                      </Card>
                    );
                  })
                )}
              </div>
            </Flex>
          </div>
        </Splitter.Panel>
        <Splitter.Panel>
          <div className="cipher-panel cipher-panel-io">
            <Flex align="center" justify="space-between">
              <Title level={5} style={{ margin: 0 }}>
                输入 / 输出
              </Title>
              <Space size={12}>
                <Space size={6}>
                  <Switch
                    size="small"
                    checked={autoRun}
                    onChange={setAutoRun}
                  />
                  <Text>自动运行</Text>
                </Space>
                <Tooltip title="手动运行流水线">
                  <Button
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    loading={isRunning}
                    onClick={executePipeline}
                    disabled={autoRun}
                  >
                    运行
                  </Button>
                </Tooltip>
              </Space>
            </Flex>
            <Splitter layout="vertical" style={{ marginTop: 12 }}>
              <Splitter.Panel>
                <Flex vertical gap={4} style={{ height: "100%" }}>
                  <Text strong>输入</Text>
                  <TextArea
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    style={{ height: "100%" }}
                    placeholder="在这里粘贴或输入待转换的字符串"
                  />
                </Flex>
              </Splitter.Panel>
              <Splitter.Panel>
                <Flex vertical gap={4} style={{ height: "100%" }}>
                  <Text strong>{outputLabel}</Text>
                  <TextArea
                    value={displayedOutput}
                    readOnly
                    style={{ height: "100%" }}
                    placeholder="流水线的输出会显示在这里"
                  />
                </Flex>
              </Splitter.Panel>
            </Splitter>
          </div>
        </Splitter.Panel>
      </Splitter>
      <Modal
        title="导入配方"
        open={importModalOpen}
        onOk={handleImportConfirm}
        onCancel={handleImportCancel}
        okText="导入"
        cancelText="取消"
        destroyOnClose
        width={560}
      >
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Text type="secondary">将导出的 JSON 配方粘贴到这里</Text>
          <TextArea
            value={importText}
            onChange={(event) => {
              setImportText(event.target.value);
              if (importError) {
                setImportError(null);
              }
            }}
            autoSize={{ minRows: 6 }}
            placeholder='{"version":1,"steps":[...]}'
          />
          {importError ? <Text type="danger">{importError}</Text> : null}
        </Space>
      </Modal>
    </ConfigProvider>
  );
};

export { Cipher };
export default Cipher;
