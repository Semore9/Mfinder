import React from "react";
import { Space, Switch, Typography } from "antd";
import type { OperationId } from "./types";
import type { Operation, OperationFormProps } from "./types";
import { Buffer } from "buffer";

const { Text } = Typography;

export type UrlDecodeConfig = {
  plusToSpace: boolean;
};

const UrlDecodeForm: React.FC<OperationFormProps<UrlDecodeConfig>> = ({
  config,
  onChange,
}) => {
  return (
    <Space direction="vertical" size={4}>
      <Space size={6}>
        <Switch
          size="small"
          checked={config.plusToSpace}
          onChange={(checked) => onChange({ ...config, plusToSpace: checked })}
        />
        <Text>将 "+" 视为空格</Text>
      </Space>
    </Space>
  );
};

export type UrlEncodeConfig = {
  spaceToPlus: boolean;
};

const UrlEncodeForm: React.FC<OperationFormProps<UrlEncodeConfig>> = ({
  config,
  onChange,
}) => {
  return (
    <Space direction="vertical" size={4}>
      <Space size={6}>
        <Switch
          size="small"
          checked={config.spaceToPlus}
          onChange={(checked) => onChange({ ...config, spaceToPlus: checked })}
        />
        <Text>将空格编码为 "+"</Text>
      </Space>
    </Space>
  );
};

export type Base64DecodeConfig = {
  urlSafe: boolean;
};

const Base64DecodeForm: React.FC<
  OperationFormProps<Base64DecodeConfig>
> = ({ config, onChange }) => {
  return (
    <Space direction="vertical" size={4}>
      <Space size={6}>
        <Switch
          size="small"
          checked={config.urlSafe}
          onChange={(checked) => onChange({ ...config, urlSafe: checked })}
        />
        <Text>兼容 URL Safe 格式</Text>
      </Space>
    </Space>
  );
};

export type Base64EncodeConfig = {
  urlSafe: boolean;
  includePadding: boolean;
};

const Base64EncodeForm: React.FC<
  OperationFormProps<Base64EncodeConfig>
> = ({ config, onChange }) => {
  return (
    <Space direction="vertical" size={4}>
      <Space size={6}>
        <Switch
          size="small"
          checked={config.urlSafe}
          onChange={(checked) => onChange({ ...config, urlSafe: checked })}
        />
        <Text>输出 URL Safe 格式</Text>
      </Space>
      <Space size={6}>
        <Switch
          size="small"
          checked={config.includePadding}
          onChange={(checked) =>
            onChange({ ...config, includePadding: checked })
          }
        />
        <Text>保留填充 "="</Text>
      </Space>
    </Space>
  );
};

export type HexDecodeConfig = {
  ignoreWhitespace: boolean;
};

const HexDecodeForm: React.FC<OperationFormProps<HexDecodeConfig>> = ({
  config,
  onChange,
}) => {
  return (
    <Space direction="vertical" size={4}>
      <Space size={6}>
        <Switch
          size="small"
          checked={config.ignoreWhitespace}
          onChange={(checked) =>
            onChange({ ...config, ignoreWhitespace: checked })
          }
        />
        <Text>忽略空白字符</Text>
      </Space>
    </Space>
  );
};

export type HexEncodeConfig = {
  uppercase: boolean;
};

const HexEncodeForm: React.FC<OperationFormProps<HexEncodeConfig>> = ({
  config,
  onChange,
}) => {
  return (
    <Space direction="vertical" size={4}>
      <Space size={6}>
        <Switch
          size="small"
          checked={config.uppercase}
          onChange={(checked) => onChange({ ...config, uppercase: checked })}
        />
        <Text>输出大写字母</Text>
      </Space>
    </Space>
  );
};

type EmptyConfig = Record<string, never>;

const ensureTextArea = () => {
  if (typeof document === "undefined") {
    return null;
  }
  const shared = ensureTextArea as any;
  if (!shared.cache) {
    shared.cache = document.createElement("textarea");
  }
  return shared.cache as HTMLTextAreaElement;
};

const htmlEntitiesFallback: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": "\"",
  "&#39;": "'",
  "&apos;": "'",
};

const decodeHtmlEntities = (input: string) => {
  const textarea = ensureTextArea();
  if (textarea) {
    textarea.innerHTML = input;
    return textarea.value;
  }
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, dec) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/(&lt;|&gt;|&amp;|&quot;|&#39;|&apos;)/g, (match) => htmlEntitiesFallback[match] ?? match);
};

const encodeHtmlEntities = (input: string) => {
  const textarea = ensureTextArea();
  if (textarea) {
    textarea.textContent = input;
    return textarea.innerHTML;
  }
  return input.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
};

const unicodeEscape = (input: string) => {
  return Array.from(input).map((char) => {
    const codePoint = char.codePointAt(0)!;
    if (codePoint <= 0x7e && codePoint >= 0x20) {
      return char;
    }
    if (codePoint > 0xffff) {
      return `\\u{${codePoint.toString(16).toUpperCase()}}`;
    }
    return `\\u${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
  }).join("");
};

const unicodeUnescape = (input: string) => {
  return input
    .replace(/\u\{([0-9a-fA-F]+)\}/g, (_match, hex) => {
      const value = parseInt(hex, 16);
      if (Number.isNaN(value)) {
        throw new Error(`非法 Unicode 值: ${hex}`);
      }
      return String.fromCodePoint(value);
    })
    .replace(/\u([0-9a-fA-F]{4})/g, (_match, hex) => {
      const value = parseInt(hex, 16);
      if (Number.isNaN(value)) {
        throw new Error(`非法 Unicode 值: ${hex}`);
      }
      return String.fromCharCode(value);
    });
};

const safeDecodeURIComponent = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    throw new Error(
      `URL 解码失败: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

const sanitizeBase64 = (value: string, urlSafe: boolean) => {
  let sanitized = value.trim();
  if (urlSafe) {
    sanitized = sanitized.replace(/-/g, "+").replace(/_/g, "/");
  }
  sanitized = sanitized.replace(/\s+/g, "");
  const padding = sanitized.length % 4;
  if (padding) {
    sanitized = sanitized.padEnd(sanitized.length + (4 - padding), "=");
  }
  return sanitized;
};

export const operations: Operation[] = [
  {
    id: "urlDecode",
    name: "URL Decode",
    category: "URL",
    description: "对字符串执行 URL 解码",
    createConfig: (): UrlDecodeConfig => ({ plusToSpace: true }),
    Form: UrlDecodeForm,
    run: (input, config: UrlDecodeConfig) => {
      const prepared = config.plusToSpace ? input.replace(/\+/g, " ") : input;
      return safeDecodeURIComponent(prepared);
    },
  },
  {
    id: "urlEncode",
    name: "URL Encode",
    category: "URL",
    description: "对字符串执行 URL 编码",
    createConfig: (): UrlEncodeConfig => ({ spaceToPlus: false }),
    Form: UrlEncodeForm,
    run: (input, config: UrlEncodeConfig) => {
      const encoded = encodeURIComponent(input);
      if (config.spaceToPlus) {
        return encoded.replace(/%20/g, "+");
      }
      return encoded;
    },
  },
  {
    id: "base64Decode",
    name: "Base64 Decode",
    category: "Base64",
    description: "将 Base64 字符串解码为 UTF-8 文本",
    createConfig: (): Base64DecodeConfig => ({ urlSafe: true }),
    Form: Base64DecodeForm,
    run: (input, config: Base64DecodeConfig) => {
      const sanitized = sanitizeBase64(input, config.urlSafe);
      try {
        return Buffer.from(sanitized, "base64").toString("utf-8");
      } catch (error) {
        throw new Error(
          `Base64 解码失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  },
  {
    id: "base64Encode",
    name: "Base64 Encode",
    category: "Base64",
    description: "将 UTF-8 文本编码为 Base64",
    createConfig: (): Base64EncodeConfig => ({
      urlSafe: false,
      includePadding: true,
    }),
    Form: Base64EncodeForm,
    run: (input, config: Base64EncodeConfig) => {
      const encoded = Buffer.from(input, "utf-8").toString("base64");
      let result = encoded;
      if (!config.includePadding) {
        result = result.replace(/=+$/g, "");
      }
      if (config.urlSafe) {
        result = result.replace(/\+/g, "-").replace(/\//g, "_");
      }
      return result;
    },
  },
  {
    id: "hexDecode",
    name: "Hex Decode",
    category: "Hex",
    description: "将十六进制字符串解码为 UTF-8 文本",
    createConfig: (): HexDecodeConfig => ({ ignoreWhitespace: true }),
    Form: HexDecodeForm,
    run: (input, config: HexDecodeConfig) => {
      let sanitized = input;
      if (config.ignoreWhitespace) {
        sanitized = sanitized.replace(/\s+/g, "");
      }
      if (sanitized.length % 2 !== 0) {
        throw new Error("十六进制长度必须为偶数");
      }
      if (!/^([0-9a-fA-F]{2})*$/.test(sanitized)) {
        throw new Error("存在非法十六进制字符");
      }
      try {
        return Buffer.from(sanitized, "hex").toString("utf-8");
      } catch (error) {
        throw new Error(
          `Hex 解码失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  },
  {
    id: "hexEncode",
    name: "Hex Encode",
    category: "Hex",
    description: "将 UTF-8 文本编码为十六进制",
    createConfig: (): HexEncodeConfig => ({ uppercase: false }),
    Form: HexEncodeForm,
    run: (input, config: HexEncodeConfig) => {
      const encoded = Buffer.from(input, "utf-8").toString("hex");
      return config.uppercase ? encoded.toUpperCase() : encoded;
    },
  },
  {
    id: "htmlDecode",
    name: "HTML Decode",
    category: "HTML",
    description: "将 HTML 实体还原为原始字符",
    createConfig: (): EmptyConfig => ({}),
    run: (input) => decodeHtmlEntities(input),
  },
  {
    id: "htmlEncode",
    name: "HTML Encode",
    category: "HTML",
    description: "将文本转换为 HTML 实体，避免被浏览器解析",
    createConfig: (): EmptyConfig => ({}),
    run: (input) => encodeHtmlEntities(input),
  },
  {
    id: "unicodeEscape",
    name: "Unicode Escape",
    category: "Unicode",
    description: "将字符转换为 Unicode 转义序列",
    createConfig: (): EmptyConfig => ({}),
    run: (input) => unicodeEscape(input),
  },
  {
    id: "unicodeUnescape",
    name: "Unicode Unescape",
    category: "Unicode",
    description: "解析 Unicode 转义序列为实际字符",
    createConfig: (): EmptyConfig => ({}),
    run: (input) => unicodeUnescape(input),
  },
];

export const operationMap = operations.reduce<Record<OperationId, Operation>>(
  (acc, operation) => {
    acc[operation.id] = operation;
    return acc;
  },
  {} as Record<OperationId, Operation>,
);
