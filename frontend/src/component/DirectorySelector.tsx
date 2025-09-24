import { Button, Flex, Input, Space, message, Tooltip } from "antd";
import React, { useMemo, useState } from "react";
import { CopyOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { OpenDirectoryDialog } from "../../wailsjs/go/osoperation/Runtime";

export interface DirectorySelectorProps {
  value?: string | number | undefined;
  onSelect?: (dir: string) => void;
  label?: string;
  labelWidth?: string | number;
  inputWidth?: string | number;
  placeholder?: string;
}

const DirectorySelector: React.FC<DirectorySelectorProps> = (props) => {
  const [copied, setCopied] = useState(false);
  const displayValue = useMemo(
    () => (props.value ? String(props.value) : ""),
    [props.value],
  );

  const openDirectoryDialog = () => {
    OpenDirectoryDialog().then((result) => {
      if (props.onSelect) {
        props.onSelect(result);
      }
    });
  };

  const copyValue = async () => {
    if (!displayValue) {
      return;
    }
    try {
      await navigator.clipboard.writeText(displayValue);
      setCopied(true);
      message.success("路径已复制");
    } catch (err) {
      message.error("复制失败，请手动复制");
    } finally {
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <Flex justify={"left"}>
      {props.label && (
        <span
          style={{
            display: "inline-block",
            textAlign: "left",
            paddingRight: "5px",
            height: "24px",
            width: props.labelWidth || "fit-content",
            minWidth: props.labelWidth || "fit-content",
            whiteSpace: "nowrap",
          }}
        >
          {props.label}
        </span>
      )}
      <Space.Compact size={"small"} style={{ width: "100%" }}>
        <Input
          size={"small"}
          value={displayValue}
          readOnly
          placeholder={props.placeholder}
          style={{ width: props.inputWidth || 360 }}
        />
        <Tooltip
          title={copied ? "已复制" : "复制路径"}
          open={copied ? true : undefined}
        >
          <Button
            icon={<CopyOutlined />}
            disabled={!displayValue}
            onClick={copyValue}
          />
        </Tooltip>
        <Button icon={<FolderOpenOutlined />} onClick={openDirectoryDialog}>
          选择
        </Button>
      </Space.Compact>
    </Flex>
  );
};

export default DirectorySelector;
