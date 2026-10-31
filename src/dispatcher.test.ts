import { Client, InMemoryTransport } from "@modelcontextprotocol/client"
import { describe, expect, it, vi } from "vitest"
import type { ToolCatalogEntry, ToolHandler, ToolServerOptions } from "./index.js"
import {
  buildRegistry,
  createToolServerFactory,
  jsonResult,
  Refusal,
  summaryResult,
  ToolError,
  withContent,
} from "./index.js"

const entry = (name: string): ToolCatalogEntry => ({
  name,
  title: name,
  description: `the ${name} tool`,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { n: { type: "integer" } },
  },
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["summary"],
    properties: { summary: { type: "string" } },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
})
const contract = ["ok", "picture", "bad_output", "boom", "tool_error", "long", "guarded"].map(entry)

interface Ctx {
  who: string
}
class Expected extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retry?: number,
  ) {
    super(message)
  }
}

const handlers: Record<string, ToolHandler<Ctx>> = {
  ok: async (_a, ctx) => ({ summary: `hello ${ctx.who}` }),
  picture: async () =>
    withContent({ summary: "pic" }, [{ type: "image", data: "QUJD", mimeType: "image/png" }]),
  bad_output: async () => ({ summary: 42 }),
  boom: async () => {
    throw new Error("C:\\secret")
  },
  tool_error: async () => {
    throw new ToolError("DUPLICATE", "again", { summary: "stored" })
  },
  long: async () => {
    throw new Expected("RATE_LIMITED", "x".repeat(400), 7)
  },
  guarded: async () => ({ summary: "ran" }),
}

function options(over: Partial<ToolServerOptions<Ctx>> = {}): ToolServerOptions<Ctx> {
  return {
    info: { name: "kit-test", version: "0.0.0" },
    registry: buildRegistry(contract, handlers),
    buildContext: () => ({ who: "world" }),
    mapError: (err) => {
      if (err instanceof ToolError)
        return { code: err.code, message: err.message, extra: { result: err.result } }
      if (err instanceof Expected)
        return { code: err.code, message: err.message, extra: { retry_after_seconds: err.retry } }
      return undefined
    },
    internalError: "INTERNAL",
    renderResult: (o) => summaryResult(o),
    logger: () => {},
    ...over,
  }
}

async function connect(opts: ToolServerOptions<Ctx>) {
  const server = await createToolServerFactory(opts)({ era: "legacy" })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "t", version: "0" })
  await server.connect(b)
  await client.connect(a)
  return client
}

async function call(
  opts: ToolServerOptions<Ctx>,
  name: string,
  args: Record<string, unknown> = {},
) {
  const client = await connect(opts)
  const res = await client.callTool({ name, arguments: args })
  const text = (res.content as { type: string; text?: string }[])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("")
  return { res, text, body: res.isError ? JSON.parse(text) : undefined }
}

describe("createToolServerFactory", () => {
  it("lists the registry catalog and reports the count to onList", async () => {
    const onList = vi.fn()
    const client = await connect(options({ onList }))
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(contract.map((t) => t.name))
    expect(onList).toHaveBeenCalledWith(contract.length)
  })

  it("answers an unknown tool with INVALID_INPUT", async () => {
    const { body } = await call(options(), "nope")
    expect(body).toEqual({ code: "INVALID_INPUT", message: "Unknown tool: nope" })
  })

  it("answers invalid input with the instance path and the ajv message", async () => {
    const { body } = await call(options(), "ok", { n: "x" })
    expect(body.code).toBe("INVALID_INPUT")
    expect(body.message).toBe("/n must be integer")
    const root = await call(options(), "ok", { extra: 1 })
    expect(root.body.message).toMatch(/^\(root\) must NOT have additional properties/)
  })

  it("answers a refusal from authorize, after validation and before the handler", async () => {
    const authorize = vi.fn(async (_c: Ctx, tool: string) =>
      tool === "guarded" ? new Refusal("ACCESS_DENIED", "no") : undefined,
    )
    const denied = await call(options({ authorize }), "guarded")
    expect(denied.body).toEqual({ code: "ACCESS_DENIED", message: "no" })
    expect((await call(options({ authorize }), "ok")).res.structuredContent).toEqual({
      summary: "hello world",
    })
    authorize.mockClear()
    await call(options({ authorize }), "guarded", { n: "bad" })
    expect(authorize).not.toHaveBeenCalled()
  })

  it("never leaks an unexpected throw's message, and logs it", async () => {
    const logger = vi.fn()
    const { res, text, body } = await call(
      options({ logger, internalError: "UPSTREAM_UNAVAILABLE" }),
      "boom",
    )
    expect(body).toEqual({ code: "UPSTREAM_UNAVAILABLE", message: "Internal error." })
    expect(JSON.stringify(res)).not.toContain("secret")
    expect(text).not.toContain("secret")
    expect(logger).toHaveBeenCalledOnce()
  })

  it("answers output failing its own schema generically, with the configured internal code", async () => {
    const logger = vi.fn()
    const { body } = await call(
      options({ logger, internalError: "UPSTREAM_UNAVAILABLE" }),
      "bad_output",
    )
    expect(body).toEqual({ code: "UPSTREAM_UNAVAILABLE", message: "Internal error." })
    expect(logger).toHaveBeenCalledOnce()
  })

  it("answers the refusal buildContext returns, without running the handler", async () => {
    const run = vi.fn(handlers.ok)
    const { body } = await call(
      options({
        registry: buildRegistry(contract, { ...handlers, ok: run }),
        buildContext: () => new Refusal("FORBIDDEN", "Not signed in."),
      }),
      "ok",
    )
    expect(body).toEqual({ code: "FORBIDDEN", message: "Not signed in." })
    expect(run).not.toHaveBeenCalled()
  })

  it("maps expected errors through mapError: extras, and a message cut to 256", async () => {
    const dup = await call(options(), "tool_error")
    expect(dup.body).toEqual({ code: "DUPLICATE", message: "again", result: { summary: "stored" } })
    const long = await call(options(), "long")
    expect(long.body.code).toBe("RATE_LIMITED")
    expect(long.body.retry_after_seconds).toBe(7)
    expect(long.body.message).toHaveLength(256)
  })

  it("renders through renderResult: text, structured output, image blocks and the tool name", async () => {
    const seen: string[] = []
    const opts = options({
      renderResult: (o, n) => {
        seen.push(n)
        return summaryResult(o)
      },
    })
    const ok = await call(opts, "ok")
    expect(ok.text).toBe("hello world")
    expect(ok.res.structuredContent).toEqual({ summary: "hello world" })
    const pic = await call(opts, "picture")
    expect(pic.res.content).toEqual([
      { type: "text", text: "pic" },
      { type: "image", data: "QUJD", mimeType: "image/png" },
    ])
    expect(pic.res.structuredContent).toEqual({ summary: "pic" })
    expect(seen).toEqual(["ok", "picture"])
  })
})

describe("result helpers", () => {
  it("jsonResult puts JSON text beside the structured output", () => {
    expect(jsonResult({ a: 1 })).toEqual({
      structured: { a: 1 },
      content: [{ type: "text", text: '{"a":1}' }],
    })
  })

  it("summaryResult puts the summary first, then image blocks and extras", () => {
    const img = { type: "image", data: "QQ==", mimeType: "image/png" } as const
    const r = summaryResult(withContent({ summary: "s" }, [img]), [{ type: "text", text: "x" }])
    expect(r.structured).toEqual({ summary: "s" })
    expect(r.content).toEqual([{ type: "text", text: "s" }, img, { type: "text", text: "x" }])
  })
})
