import { Ajv2020 } from "ajv/dist/2020.js"

// A lint over a parsed contract (`{ tools: [...] }`). It returns problems instead of asserting, so
// each server's own test runner wraps it: `expect(lintContract(contract)).toEqual([])`.

// Keywords outside the portable JSON Schema subset that hosted clients accept. Matched as keys of
// schema objects only: a property that happens to be called "not" or "if" is a name, not a keyword,
// so the keys of a `properties` map are skipped (their values are still walked).
const NON_PORTABLE = new Set([
  "$ref",
  "$defs",
  "definitions",
  "$anchor",
  "$dynamicRef",
  "$dynamicAnchor",
  "$recursiveRef",
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
])

const ANNOTATIONS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const

const LOOKAROUND = /\(\?<?[=!]/

function scan(node: unknown, at: string, out: string[], inPropertyMap = false): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      scan(item, `${at}[${i}]`, out)
    })
    return
  }
  if (!node || typeof node !== "object") return
  for (const [key, value] of Object.entries(node)) {
    if (!inPropertyMap) {
      if (NON_PORTABLE.has(key)) out.push(`${at}.${key} is outside the portable subset`)
      if (key === "pattern" && typeof value === "string" && LOOKAROUND.test(value))
        out.push(`${at}.pattern uses regex lookaround: ${value}`)
    }
    scan(value, `${at}.${key}`, out, !inPropertyMap && key === "properties")
  }
}

/** Returns one human-readable problem per failed check; an empty list means the contract is clean. */
export function lintContract(contract: { tools?: readonly unknown[] }): string[] {
  const problems: string[] = []
  if (!Array.isArray(contract.tools)) return ["contract has no tools array"]
  for (const raw of contract.tools) {
    const tool = (raw ?? {}) as Record<string, unknown>
    const name = typeof tool.name === "string" ? tool.name : "(unnamed)"
    for (const side of ["inputSchema", "outputSchema"] as const) {
      const schema = tool[side]
      if (schema === undefined || schema === null || typeof schema !== "object") {
        problems.push(`${name}: missing ${side}`)
        continue
      }
      try {
        new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true }).compile(
          schema as object,
        )
      } catch (e) {
        problems.push(`${name}.${side} does not compile under strict Ajv: ${(e as Error).message}`)
      }
      const found: string[] = []
      scan(schema, `${name}.${side}`, found)
      problems.push(...found)
    }
    const annotations = tool.annotations as Record<string, unknown> | undefined
    for (const hint of ANNOTATIONS) {
      if (typeof annotations?.[hint] !== "boolean")
        problems.push(`${name}: annotation ${hint} is not declared as a boolean`)
    }
  }
  return problems
}
