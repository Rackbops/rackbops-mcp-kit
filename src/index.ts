// The package's public surface. The contract lint is a separate entry point, `@rackbops/mcp-kit/testing`.
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
