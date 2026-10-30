# @rackbops/mcp-kit

The tool registry and dispatcher a remote MCP server needs, so each Rackbops MCP server does not carry
its own copy. Companion to [`@rackbops/mcp-oauth`](https://github.com/Rackbops/rackbops-mcp-oauth).

**Status: scaffold.** No code is exported yet. The first extraction moves Meals for Two's
`registry.ts` and `tools.ts` here, with hooks for a per-call authorize check, an error mapper and a
context builder, so discord-mcp, Meals for Two and tracker-mcp can share one dispatcher. See
[`docs/PURPOSE.md`](docs/PURPOSE.md) for what it is and is not.

## Develop

```bash
just install
just check   # biome, tsc --noEmit, vitest, build
```

MIT licensed.
