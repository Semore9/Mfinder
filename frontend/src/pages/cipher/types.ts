import type { FC } from "react";

export type OperationId =
  | "urlDecode"
  | "urlEncode"
  | "base64Decode"
  | "base64Encode"
  | "hexDecode"
  | "hexEncode"
  | "htmlDecode"
  | "htmlEncode"
  | "unicodeEscape"
  | "unicodeUnescape";

export interface OperationFormProps<TConfig> {
  config: TConfig;
  onChange: (config: TConfig) => void;
}

export interface Operation<TConfig = any> {
  id: OperationId;
  name: string;
  category: string;
  description?: string;
  createConfig: () => TConfig;
  Form?: FC<OperationFormProps<TConfig>>;
  run: (input: string, config: TConfig) => string;
}

export interface PipelineStep {
  id: string;
  operationId: OperationId;
  config: any;
}

export interface StepExecutionState {
  error?: string;
  output?: string;
}
