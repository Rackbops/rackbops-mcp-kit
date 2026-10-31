# @rackbops/mcp-kit

The tool registry and dispatcher a remote MCP server needs, so each Rackbops MCP server does not carry
its own copy. Companion to [`@rackbops/mcp-oauth`](https://github.com/Rackbops/rackbops-mcp-oauth).

**Status: registry and contract lint.** The dispatcher (`tools/call`) comes in a later release; see
[`docs/PURPOSE.md`](docs/PURPOSE.md) for what the kit is and is not.

## What it exports

From `@rackbops/mcp-kit`:

- `loadContractTools(file)`: reads the `tools` array of a contract file (the path is required).
- `buildRegistry(contractTools, handlers, { requireAllHandlers? })`: compiles every served tool's input
  and output schema under strict Ajv 2020, refuses a handler whose name is not in the contract, and
  serves the contract entries that have a handler, in contract order. `requireAllHandlers: true` also
  fails boot, naming the tool, when a contract tool has no handler. Handlers may take any parameters
  (`(args, ctx)`, `(principal, args, signal)`); `ToolHandler<Ctx>` is the `(args, ctx)` shape.
- `ToolError(code, message, result?)`, `ToolResult` and `withContent(output, imageBlocks)`.

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
