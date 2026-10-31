import { readFileSync } from "node:fs"
import type { ValidateFunction } from "ajv"
import { Ajv2020 } from "ajv/dist/2020.js"

// The tool registry: the contract file (`contracts/tools.json`) is the source of every tool's name,
// description, schemas and annotations, and a handler supplies the behaviour. The served catalog is
// the contract's entries that have a handler, so a tool appears in tools/list the moment its handler
// lands and never before. A handler whose name is not in the contract is a boot error; there is no
// second place a schema can be written.

export interface ToolAnnotations {
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint?: boolean
  openWorldHint: boolean
}

export interface ToolCatalogEntry {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  annotations: ToolAnnotations
}

/** An MCP image content block: standard base64 (with padding) of the picture's bytes. */
export interface ImageBlock {
  type: "image"
  data: string
  mimeType: string
}

/** A handler's answer that carries content blocks beside its structured output (a picture). */
export class ToolResult {
  constructor(
    readonly output: unknown,
    readonly content: readonly ImageBlock[],
  ) {}
}

export const withContent = (output: unknown, content: readonly ImageBlock[]): ToolResult =>
  new ToolResult(output, content)

/** A failure a caller can act on: surfaced as `{code, message}` JSON. `code` is a contract error code. */
export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** Carried in the error body as `result`: a DUPLICATE error returns the stored answer this way. */
    readonly result?: unknown,
  ) {
    super(message)
  }
}

/** The common handler shape: the call's arguments, then the server's own context. */
export type ToolHandler<Ctx> = (args: Record<string, unknown>, ctx: Ctx) => Promise<unknown>

/** Any handler shape. A server whose handlers take other parameters passes its own type to `buildRegistry`. */
export type AnyToolHandler = (...args: never[]) => unknown

interface ContractFile {
  tools: ToolCatalogEntry[]
}

/** Reads the `tools` array of a contract file. The path is required: a package cannot guess where a server keeps it. */
export function loadContractTools(file: string): readonly ToolCatalogEntry[] {
  return (JSON.parse(readFileSync(file, "utf8")) as ContractFile).tools
}

export interface Registry<H extends AnyToolHandler = ToolHandler<never>> {
  /** Contract entries that have a handler, in contract order. */
  catalog: readonly ToolCatalogEntry[]
  handlers: ReadonlyMap<string, H>
  inputValidators: ReadonlyMap<string, ValidateFunction>
  outputValidators: ReadonlyMap<string, ValidateFunction>
}

export interface BuildRegistryOptions {
  /** Fail boot naming the first contract tool that has no handler. Default false: serve the ones that do. */
  requireAllHandlers?: boolean
}

export function buildRegistry<H extends AnyToolHandler = ToolHandler<never>>(
  contractTools: readonly ToolCatalogEntry[],
  handlers: Readonly<Record<string, H>>,
  options: BuildRegistryOptions = {},
): Registry<H> {
  const known = new Set(contractTools.map((t) => t.name))
  for (const name of Object.keys(handlers)) {
    if (!known.has(name)) throw new Error(`handler for ${name}, which is not in the contract`)
  }
  if (options.requireAllHandlers) {
    const missing = contractTools.find((t) => !Object.hasOwn(handlers, t.name))
    if (missing) throw new Error(`no handler for ${missing.name}, which the contract lists`)
  }
  const catalog = contractTools.filter((t) => Object.hasOwn(handlers, t.name))
  const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true })
  return {
    catalog,
    handlers: new Map(catalog.map((t): [string, H] => [t.name, handlers[t.name] as H])),
    inputValidators: new Map(
      catalog.map((t): [string, ValidateFunction] => [t.name, ajv.compile(t.inputSchema)]),
    ),
    outputValidators: new Map(
      catalog.map((t): [string, ValidateFunction] => [t.name, ajv.compile(t.outputSchema)]),
    ),
  }
}
