# MCP integration locked to pi-mcp-adapter

Amended by [ADR-0005](0005-subprocess-host-with-generated-settings.md): the lock below stands, but the integration transport is no longer in-process host calls. pi-profile runs inside Pi as an extension and coordinates with the adapter over the `pi.events` event bus.
Amended again (ticket 10): the assumed adapter "profile-scoped state store" does not exist (pi-mcp-adapter@2.33.0 exposes only the register/snapshot event pair — no allowlist, no profile-state API, no enable/disable/reload event). The profile's `mcp` array in its owning catalog IS the profile-scoped persistent store; `/mcp enable|disable` edit it via ProfileCatalogStore and take effect through the standard rewrite-settings-and-reload path, with the allowlist republished at session_start over the coordination channel. The lock's intent stands: connection parameters, OAuth, and tokens remain adapter-managed; pi-profile never writes them.
Amended again (removal of `/mcp enable|disable`): `/mcp enable|disable` was removed. Registering `/mcp` in pi-profile collided with and hijacked `pi-mcp-adapter`'s native `/mcp` command namespace (TUI setup, status, tools, reconnect, etc.). Profile-scoped MCP selections are declared statically in `profiles.json` (`mcps` array) and enforced via runtime allowlisting. All `/mcp` commands are returned entirely to `pi-mcp-adapter`.

MCP support is delegated entirely to the optional `pi-mcp-adapter` package. `profiles.json` never stores MCP connection parameters or credentials; server commands, addresses, OAuth, and tokens stay in adapter-managed configuration.

Considered alternative: pi-profile manages MCP configuration itself. Rejected because it would fork server management away from the adapter's single implementation and pull credentials into profile catalogs.

Consequence: a profile that declares `mcp` fails to activate when the adapter is not installed; profiles without `mcp` work fine without it.
