import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { ToolCatalogEntry } from "./index.js"
import { buildRegistry, loadContractTools, ToolError, ToolResult, withContent } from "./index.js"

const entry = (name: string): ToolCatalogEntry => ({
  name,
  title: name,
  description: `the ${name} tool`,
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  outputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { ok: { type: "boolean" } },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
})
const contract = ["get_day", "get_recipe", "list_stores"].map(entry)
const noop = async (): Promise<unknown> => ({})

describe("buildRegistry", () => {
  it("serves only the contract entries that have a handler, in contract order", () => {
    const registry = buildRegistry(contract, { list_stores: noop, get_day: noop })
    expect(registry.catalog.map((t) => t.name)).toEqual(["get_day", "list_stores"])
    expect([...registry.handlers.keys()]).toEqual(["get_day", "list_stores"])
    expect([...registry.inputValidators.keys()]).toEqual(["get_day", "list_stores"])
    expect([...registry.outputValidators.keys()]).toEqual(["get_day", "list_stores"])
  })

  it("refuses a handler for a tool the contract does not list", () => {
    expect(() => buildRegistry(contract, { not_a_tool: noop })).toThrow(/not_a_tool/)
  })

  it("serves nothing when no handler is registered", () => {
    expect(buildRegistry(contract, {}).catalog).toEqual([])
  })

  it("compiles every contract schema (strict Ajv) for the registered handlers", () => {
    const all = Object.fromEntries(contract.map((t) => [t.name, noop]))
    expect(buildRegistry(contract, all).catalog).toHaveLength(contract.length)
  })

  it("rejects a schema strict Ajv does not accept", () => {
    const bad = { ...entry("bad"), inputSchema: { type: "object", bogusKeyword: 1 } }
    expect(() => buildRegistry([bad], { bad: noop })).toThrow()
  })

  it("validates calls and results with the compiled validators", () => {
    const registry = buildRegistry(contract, { get_day: noop })
    expect(registry.inputValidators.get("get_day")?.({})).toBe(true)
    expect(registry.inputValidators.get("get_day")?.({ extra: 1 })).toBe(false)
    expect(registry.outputValidators.get("get_day")?.({ ok: true })).toBe(true)
    expect(registry.outputValidators.get("get_day")?.({ ok: "yes" })).toBe(false)
  })

  it("serves what has a handler by default, even when the contract lists more", () => {
    expect(buildRegistry(contract, { get_day: noop }).catalog).toHaveLength(1)
  })

  it("throws naming the missing tool when requireAllHandlers is set", () => {
    expect(() =>
      buildRegistry(contract, { get_day: noop, list_stores: noop }, { requireAllHandlers: true }),
    ).toThrow(/get_recipe/)
  })

  it("passes requireAllHandlers when every contract tool has a handler", () => {
    const all = Object.fromEntries(contract.map((t) => [t.name, noop]))
    expect(buildRegistry(contract, all, { requireAllHandlers: true }).catalog).toHaveLength(3)
  })

  it("accepts handlers of any shape, such as (principal, args, signal)", () => {
    const handler = async (_principal: string, _args: object, _signal: AbortSignal) => ({})
    const registry = buildRegistry(contract, { get_day: handler })
    expect(registry.handlers.get("get_day")).toBe(handler)
  })

  it("accepts handlers typed with a server's own context", () => {
    const handler = async (_args: Record<string, unknown>, ctx: { sub: string }) => ctx.sub
    expect(buildRegistry(contract, { get_day: handler }).catalog).toHaveLength(1)
  })
})

describe("loadContractTools", () => {
  it("reads the tools array from the given file", () => {
    const file = join(mkdtempSync(join(tmpdir(), "kit-")), "tools.json")
    writeFileSync(file, JSON.stringify({ contractVersion: 1, tools: contract }))
    expect(loadContractTools(file)).toEqual(contract)
  })
})

describe("ToolError and ToolResult", () => {
  it("carries a code, message and optional result", () => {
    const e = new ToolError("DUPLICATE", "seen", { id: 1 })
    expect(e).toBeInstanceOf(Error)
    expect([e.code, e.message, e.result]).toEqual(["DUPLICATE", "seen", { id: 1 }])
  })

  it("withContent pairs structured output with image blocks", () => {
    const image = { type: "image" as const, data: "AAAA", mimeType: "image/png" }
    const r = withContent({ ok: true }, [image])
    expect(r).toBeInstanceOf(ToolResult)
    expect([r.output, r.content]).toEqual([{ ok: true }, [image]])
  })
})
