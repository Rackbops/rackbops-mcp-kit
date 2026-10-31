# @rackbops/mcp-kit

The tool registry and dispatcher a remote MCP server needs, so each Rackbops MCP server does not carry
its own copy. Companion to [`@rackbops/mcp-oauth`](https://github.com/Rackbops/rackbops-mcp-oauth).

**Status: registry, contract lint and dispatcher.** See [`docs/PURPOSE.md`](docs/PURPOSE.md) for what
the kit is and is not.

## What it exports

From `@rackbops/mcp-kit`:

- `loadContractTools(file)`: reads the `tools` array of a contract file (the path is required).
- `buildRegistry(contractTools, handlers, { requireAllHandlers? })`: compiles every served tool's input
  and output schema under strict Ajv 2020, refuses a handler whose name is not in the contract, and
  serves the contract entries that have a handler, in contract order. `requireAllHandlers: true` also
  fails boot, naming the tool, when a contract tool has no handler. Handlers may take any parameters
  (`(args, ctx)`, `(principal, args, signal)`); `ToolHandler<Ctx>` is the `(args, ctx)` shape.
- `ToolError(code, message, result?)`, `ToolResult` and `withContent(output, imageBlocks)`.
- `createToolServerFactory(options)`: the `tools/list` and `tools/call` dispatcher over the SDK's
  low-level `Server` (never `registerTool`), returning an `McpServerFactory`. Unknown tool and invalid
  input answer `INVALID_INPUT` (`"<instancePath or (root)> <ajv message>"`); every failure is
  `{isError: true, content: [{type: "text", text: JSON.stringify({code, message, ...extras})}]}` with
  `message` cut to 256 characters; an unexpected throw is logged and answered generically, never with
  `err.message`; output is validated against its own `outputSchema`. A call runs in this order: unknown
  tool, `buildContext`, input validation, `authorize`, the handler, `renderResult`, output validation.
  The handler shape is `(args, ctx) => Promise<unknown>` (`ToolHandler<Ctx>`).
- The five hooks (all in the options): `buildContext({request, call})` returns the handler's context or
  a `Refusal`; `authorize(ctx, toolName)` (optional) returns a `Refusal` or throws; `mapError(err)`
  returns `{code, message, extra?}` or `undefined` for "unexpected"; `internalError` is the code for
  unexpected failures and for output failing its schema (the kit picks none: both `INTERNAL` and
  `UPSTREAM_UNAVAILABLE` are shipped identifiers); `renderResult(output, toolName)` returns
  `{structured, content}`. Also `onList(count)` and `logger(message, err?)` (default `console.error`).
- `summaryResult(output, extra?)` (text is `structuredContent.summary`) and `jsonResult(output, extra?)`
  (text is `JSON.stringify(output)`), both unwrapping a `ToolResult`'s image blocks;
  `splitToolResult(output)` for a `renderResult` that adjusts the output first.

### Two server shapes

Summary-text server with a member context and no per-call gate:

```ts
const registry = buildRegistry(loadContractTools(contractPath), HANDLERS)
export const factory = createToolServerFactory<MemberCtx>({
  info: { name: "my-server", version: "1.0.0" },
  registry,
  buildContext: ({ request }) => {
    const member = request.authInfo?.clientId
    return member ? { member, db } : new Refusal("FORBIDDEN", "Not signed in.")
  },
  mapError: (e) =>
    e instanceof ToolError
      ? { code: e.code, message: e.message, extra: { result: e.result } }
      : undefined,
  internalError: "INTERNAL",
  renderResult: (o) => summaryResult(o),
})
```

JSON-text server with a principal, a per-call gate and a retry hint:

```ts
export const factory = createToolServerFactory<{ principal: Principal; signal: AbortSignal }>({
  info: { name: "my-service", version: "1.0.0" },
  registry: buildRegistry(loadContractTools(contractPath), handlers),
  buildContext: ({ call }) => ({
    principal: lookup(call.http?.authInfo?.clientId),
    signal: call.mcpReq.signal,
  }),
  authorize: async ({ principal }) => {
    await gate.check(principal)
  }, // throws ServiceError to refuse
  mapError: (e) =>
    e instanceof ServiceError
      ? {
          code: e.code,
          message: e.message,
          extra:
            e.retryAfterSeconds === undefined
              ? undefined
              : { retry_after_seconds: e.retryAfterSeconds },
        }
      : undefined,
  internalError: "UPSTREAM_UNAVAILABLE",
  renderResult: (o) => jsonResult(o),
})
```

From `@rackbops/mcp-kit/testing`:

- `lintContract(contract)`: returns a list of problems (empty when clean) for each tool: schemas that do
  not compile under strict Ajv, keywords outside the portable subset (`$ref`, combinators,
  `if`/`then`/`else`, regex lookaround), a missing annotation (all four hints must be booleans) and a
  missing `outputSchema`. Wrap it in your test runner: `expect(lintContract(contract)).toEqual([])`.

Peer dependencies: `@modelcontextprotocol/server` (`>=2.3.1 <3`) and `ajv` (`^8.20.0`).

## Develop

```bash
just install
just check   # biome, tsc --noEmit, vitest, build
```

MIT licensed.
