// The package's public surface. The contract lint is a separate entry point, `@rackbops/mcp-kit/testing`.

export {
  type BuildContextInput,
  type ContentBlock,
  createToolServerFactory,
  jsonResult,
  type Logger,
  type MappedError,
  Refusal,
  type Rendered,
  splitToolResult,
  summaryResult,
  type TextBlock,
  type ToolServerOptions,
} from "./dispatcher.js"
export {
  type AnyToolHandler,
  type BuildRegistryOptions,
  buildRegistry,
  type ImageBlock,
  loadContractTools,
  type Registry,
  type ToolAnnotations,
  type ToolCatalogEntry,
  ToolError,
  type ToolHandler,
  ToolResult,
  withContent,
} from "./registry.js"
