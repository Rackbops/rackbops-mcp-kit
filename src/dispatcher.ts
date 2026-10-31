import type {
  McpRequestContext,
  McpServerFactory,
  ServerContext,
} from "@modelcontextprotocol/server"
import { Server } from "@modelcontextprotocol/server"
import type { ErrorObject } from "ajv"
import { type ImageBlock, type Registry, type ToolHandler, ToolResult } from "./registry.js"

// The tools/call dispatcher, hand-dispatched over the low-level Server and never `registerTool`:
// registerTool turns an unexpected throw into a protocol-level error with no body a caller can act
// on. Owning tools/call means every failure, a bug in the server included, is a tool result whose
// body is `{code, message, ...extras}` JSON.
//
// What differs between servers is five hooks, never a branch on which server is calling:
// buildContext, authorize, mapError, internalError and renderResult.
//
// Order of a call: unknown tool -> buildContext -> input validation -> authorize -> handler ->
// renderResult -> output validation.

export interface TextBlock {
  type: "text"
  text: string
}
export type ContentBlock = TextBlock | ImageBlock

/** A refusal to proceed, answered as `{code, message, ...extra}`. */
export class Refusal {
  constructor(
    readonly code: string,
    readonly message: string,
    readonly extra?: Readonly<Record<string, unknown>>,
  ) {}
}

/** What `mapError` returns for an error the server expects: its code, message and any extra body fields. */
export interface MappedError {
  code: string
  message: string
  extra?: Readonly<Record<string, unknown>>
}

/** A handler's answer as the caller sees it: `structured` is validated against the tool's outputSchema. */
export interface Rendered {
  structured: unknown
  content: readonly ContentBlock[]
}

export interface BuildContextInput {
  /** The factory's construction context (`authInfo` as the HTTP layer passed it). */
  request: McpRequestContext
  /** The call's own context (`http.authInfo`, `mcpReq.signal`). */
  call: ServerContext
}

export type Logger = (message: string, err?: unknown) => void

export interface ToolServerOptions<Ctx> {
  info: { name: string; title?: string; version: string }
  instructions?: string
  registry: Registry<ToolHandler<Ctx>>
  /** Returns the handler's context, or a `Refusal` (answered as is). A throw is handled like a handler's. */
  buildContext(input: BuildContextInput): Ctx | Refusal | Promise<Ctx | Refusal>
  /** Runs after input validation and before the handler. Return a `Refusal` or throw to refuse. */
  // biome-ignore lint/suspicious/noConfusingVoidType: a gate that only throws should not have to return undefined
  authorize?(ctx: Ctx, toolName: string): void | Refusal | Promise<void | Refusal>
  /** Maps an error the server expects; `undefined` means unexpected (logged, answered generically). */
  mapError(err: unknown): MappedError | undefined
  /** Code for an unexpected failure and for output failing its own schema. */
  internalError: string
  /** Turns a handler's answer into the structured output and content blocks. */
  renderResult(output: unknown, toolName: string): Rendered
  /** Called with the number of tools served on each `tools/list`. */
  onList?(count: number): void
  /** Receives log lines; default `console.error`. */
  logger?: Logger
}

const GENERIC = "Internal error."

function errorResult(code: string, message: string, extra?: Readonly<Record<string, unknown>>) {
  const body = { code, message: message.slice(0, 256), ...extra }
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify(body) }],
  }
}

function firstAjvError(errors: ErrorObject[] | null | undefined): string {
  const err = errors?.[0]
  if (!err) return "Invalid input."
  return `${err.instancePath || "(root)"} ${err.message ?? "is invalid"}`.trim()
}

/** Splits a handler answer that may be a `ToolResult` into its structured output and image blocks. */
export function splitToolResult(output: unknown): {
  output: unknown
  content: readonly ImageBlock[]
} {
  return output instanceof ToolResult
    ? { output: output.output, content: output.content }
    : { output, content: [] }
}

/** JSON text beside the structured output (discord-mcp's shape). */
export function jsonResult(output: unknown, extra: readonly ContentBlock[] = []): Rendered {
  const { output: structured, content } = splitToolResult(output)
  return {
    structured,
    content: [{ type: "text", text: JSON.stringify(structured) }, ...content, ...extra],
  }
}

/** `structuredContent.summary` as the text block (Meals' shape), then any image blocks. */
export function summaryResult(output: unknown, extra: readonly ContentBlock[] = []): Rendered {
  const { output: structured, content } = splitToolResult(output)
  const summary = (structured as { summary?: unknown } | null)?.summary
  return {
    structured,
    content: [{ type: "text", text: String(summary) }, ...content, ...extra],
  }
}

export function createToolServerFactory<Ctx>(options: ToolServerOptions<Ctx>): McpServerFactory {
  const { registry, info } = options
  const log: Logger =
    options.logger ?? ((m, e) => (e === undefined ? console.error(m) : console.error(m, e)))
  return (request) => {
    const server = new Server(
      info.title === undefined
        ? { name: info.name, version: info.version }
        : { name: info.name, title: info.title, version: info.version },
      {
        capabilities: { tools: {} },
        ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
      },
    )

    server.setRequestHandler("tools/list", () => {
      options.onList?.(registry.catalog.length)
      return { tools: registry.catalog } as never
    })

    server.setRequestHandler("tools/call", async (req, call: ServerContext) => {
      const { name, arguments: args } = req.params
      const handler = registry.handlers.get(name)
      const inputValidate = registry.inputValidators.get(name)
      const outputValidate = registry.outputValidators.get(name)
      if (!handler || !inputValidate || !outputValidate) {
        return errorResult("INVALID_INPUT", `Unknown tool: ${name}`)
      }
      try {
        const ctx = await options.buildContext({ request, call })
        if (ctx instanceof Refusal) {
          log(`${info.name}: ${name} refused: ${ctx.code}`)
          return errorResult(ctx.code, ctx.message, ctx.extra)
        }
        const candidate = args ?? {}
        if (!inputValidate(candidate)) {
          return errorResult("INVALID_INPUT", firstAjvError(inputValidate.errors))
        }
        const denied = await options.authorize?.(ctx, name)
        if (denied instanceof Refusal) return errorResult(denied.code, denied.message, denied.extra)
        const output = await handler(candidate as Record<string, unknown>, ctx)
        const rendered = options.renderResult(output, name)
        if (!outputValidate(rendered.structured)) {
          log(`${info.name}: ${name} produced output failing its own outputSchema`)
          return errorResult(options.internalError, GENERIC)
        }
        return {
          content: [...rendered.content],
          structuredContent: rendered.structured as Record<string, unknown>,
        }
      } catch (err) {
        const mapped = options.mapError(err)
        if (mapped) return errorResult(mapped.code, mapped.message, mapped.extra)
        // Never return err.message: it may carry a path or a raw driver error.
        log(`${info.name}: ${name} threw an unexpected error:`, err)
        return errorResult(options.internalError, GENERIC)
      }
    })
    return server
  }
}
