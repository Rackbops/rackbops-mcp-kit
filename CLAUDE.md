# rackbops-mcp-kit -- Claude Instructions

`@rackbops/mcp-kit`: the shared tool registry and dispatcher for Rackbops MCP servers, to be extracted
from `Rackbops/meals-for-two` `src/mcp/registry.ts` and `tools.ts` (the design Meals, tracker-mcp and
discord-mcp already share). What it is for and what it is not: [`docs/PURPOSE.md`](docs/PURPOSE.md).
My personal `~/.claude/CLAUDE.md` governs how I work; this covers only this repo.

- **Behaviour-preserving extraction.** The consuming servers' live clients (claude.ai, ChatGPT) see the
  tool catalog and results; a change to either needs a reason in the PR.
- **Hooks, not branches.** Per-server behaviour (a per-call authorize check, an error mapper, a
  context builder) is an option the server passes in, never a branch on which server is calling.
- **`registerTool` stays unused.** The dispatcher owns `tools/call` so every failure, including an
  unexpected throw, is a `{code, message}` tool result.
- **Public repo, public npm**: no hostnames, secrets or household data.
- `just check` mirrors CI. Public repo, so all workflows run on GitHub-hosted runners (private repos use
  the self-hosted pool).
- Release flow and publish auth are the same as `rackbops-mcp-oauth` (OIDC; `NPM_TOKEN` is the
  break-glass for the first publish; `RELEASE_TOKEN` unset makes release.yml inert).
