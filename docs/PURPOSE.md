# Purpose

`@rackbops/mcp-kit` is the part of a remote MCP server that every Rackbops MCP server writes the
same way: load `contracts/tools.json`, validate every call's input and output against it, dispatch to
a handler, and answer every failure as a `{code, message}` tool result. It sits beside
[`@rackbops/mcp-oauth`](https://github.com/Rackbops/rackbops-mcp-oauth), which does the same for
sign-in, so that Meals for Two, tracker-mcp and discord-mcp stop carrying three copies.

## Who it is for

The maintainers of Rackbops MCP servers. It is a library, not a service.

## Non-goals

- Not a web framework: it does not route HTTP, guard Host/Origin or verify bearer tokens.
- Not an authorization server (that is `@rackbops/mcp-oauth`).
- Not a business-logic layer: handlers, their error codes and the contract stay in each server.
- No hostnames, secrets or household data: this is a public repository and a public npm package.
