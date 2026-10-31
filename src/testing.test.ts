import { describe, expect, it } from "vitest"
import { lintContract } from "./testing.js"

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}
const out = {
  type: "object",
  additionalProperties: false,
  properties: { ok: { type: "boolean" } },
}
const tool = (over: Record<string, unknown> = {}) => ({
  name: "t",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  outputSchema: out,
  annotations,
  ...over,
})
const lint = (over: Record<string, unknown>) => lintContract({ tools: [tool(over)] })

describe("lintContract", () => {
  it("returns nothing for a clean contract", () => {
    expect(lintContract({ tools: [tool()] })).toEqual([])
  })

  it("flags a $ref", () => {
    const p = lint({ inputSchema: { type: "object", properties: { a: { $ref: "#/x" } } } })
    expect(p.join("\n")).toMatch(/t\.inputSchema\.properties\.a\.\$ref/)
  })

  it("flags an anyOf", () => {
    const p = lint({ outputSchema: { type: "object", anyOf: [{ type: "object" }] } })
    expect(p.join("\n")).toMatch(/t\.outputSchema\.anyOf/)
  })

  it("flags a lookbehind pattern (and a lookahead)", () => {
    const schema = (pattern: string) => ({
      type: "object",
      properties: { a: { type: "string", pattern } },
    })
    expect(lint({ inputSchema: schema("(?<=a)b") }).join("\n")).toMatch(/lookaround/)
    expect(lint({ inputSchema: schema("a(?!b)") }).join("\n")).toMatch(/lookaround/)
  })

  it("flags a missing annotation", () => {
    const { openWorldHint: _omit, ...rest } = annotations
    expect(lint({ annotations: rest }).join("\n")).toMatch(/openWorldHint/)
  })

  it("flags a missing outputSchema", () => {
    expect(lint({ outputSchema: undefined }).join("\n")).toMatch(/t: missing outputSchema/)
  })

  it("flags a schema strict Ajv rejects", () => {
    expect(lint({ inputSchema: { type: "object", bogus: 1 } }).join("\n")).toMatch(/strict Ajv/)
  })

  it("treats a property named like a keyword as a name", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: { not: { type: "string" }, if: { type: "string" } },
    }
    expect(lint({ inputSchema: schema })).toEqual([])
  })

  it("reports a contract with no tools array", () => {
    expect(lintContract({})).toEqual(["contract has no tools array"])
  })
})
