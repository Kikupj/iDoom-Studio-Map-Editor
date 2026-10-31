# iDoom Studio MCP integration

iDoom Studio exposes a local Model Context Protocol server for agents. Start the editor first so the local API and its per-install token exist:

```text
Launch iDoom Studio.bat
```

Then configure an MCP client to launch `src/mcp-server.js` with Node. Example Claude Desktop configuration on this machine:

```json
{
  "mcpServers": {
    "idoom-studio": {
      "command": "node",
      "args": ["c:\\Games\\Better Doom Mapper\\src\\mcp-server.js"],
      "env": {
        "IDOOM_STUDIO_URL": "http://127.0.0.1:3456"
      }
    }
  }
}
```

Restart the MCP client after editing its configuration. The adapter reads the bearer token from `maps/.agent-token`; it does not send the token to the model or expose a token endpoint. Keep that file private. The HTTP service binds to loopback only, requires same-origin browser mutations, authenticates MCP mutations, limits JSON bodies to 5 MiB, and rejects non-loopback hosts. Do not expose the editor through a reverse proxy or change the bind host. Tests may set `IDOOM_MAPS_DIR` to an isolated temporary maps directory; normal launches use the workspace `maps/` directory.

The browser's **Project** menu provides New, Open from recent files, Save, and Save As. The top-bar status deliberately separates **Synced to editor** from **Saved to disk**. A committed browser or MCP edit is autosaved as a recovery copy after a short debounce; it never replaces a named `.json` project. On restart, the last named project opens automatically. If a newer autosave exists, the browser asks whether to recover it; recovery changes the live session only and leaves the named save untouched. Save explicitly to update the named file. Browser-local recovery drafts are offered if a failed synchronization left unsent edits.

## Agent workflow

1. Call `idoom_get_project` and record its `revision`.
2. Call `idoom_get_catalog` to inspect themes, Doom thing types, door lock metadata, and starter maps.
3. Use `idoom_create_project` or edit the current project with `idoom_add_object`, `idoom_update_object`, `idoom_delete_object`, `idoom_link_objects`, or `idoom_attach_room`. Combine related edits with `idoom_apply_batch` for one all-or-nothing revision. Supply the most recent revision on every write. A successful edit is pushed to an open browser editor immediately.
4. Call `idoom_validate_project` with the latest revision for schema/compiler validation and `idoom_map_check` for structured playability guidance. Map Check reports errors, warnings, informational notes, affected IDs, suggestions, and its analysis limits. Missing starts/exits, actor clearance, connectivity, and key progression findings are guidance, not a guarantee of gameplay behavior.
5. Call `idoom_save_project` to save the named JSON project and refresh its WAD when playable geometry compiles. Structurally valid unfinished drafts can be saved as JSON. Autosave recovery copies are kept separate. Call `idoom_export_wad` to write playable output; defined contract errors block export/playtest, while warnings require human judgment.
6. Call `idoom_playtest` only when intentionally launching UZDoom.

The `doom://project/current` and `doom://catalog` resources expose the same live project and catalog information. Tool responses are JSON in both text and structured content. Mutation failures are atomic. Browser and MCP project operations share storage, validation, save/export/playtest, and Map Check services. A revision conflict means a person or another agent changed the map first: call `idoom_get_project`, inspect/reconcile, and retry against the new revision instead of replaying a stale full map.

The editor and shared session keep bounded undo/redo history. Use `idoom_undo` or `idoom_redo` with the current revision to revert a committed change. When an agent update arrives while the browser has uncommitted local edits or an active drag, the editor preserves those edits and reports the conflict; reload the editor to review the latest server revision before continuing.

## Tools

- `idoom_get_project`, `idoom_get_catalog`
- `idoom_create_project`, `idoom_attach_room`
- `idoom_add_object`, `idoom_update_object`, `idoom_delete_object`, `idoom_link_objects`, `idoom_apply_batch`
- `idoom_undo`, `idoom_redo`
- `idoom_validate_project`, `idoom_map_check`, `idoom_save_project`, `idoom_load_project`, `idoom_export_wad`
- `idoom_playtest` (explicitly launches the game)

Room attachments check surrounding space and return a clear no-space error rather than creating an overlapping wing. `idoom_attach_room` accepts an optional cardinal direction; without it, the generator chooses the first free side.

## Map Check guarantees and limits

Map Check uses authored room footprints and approximate catalog dimensions. It can flag missing starts, missing exits, actors outside room bounds, possible vertical/wall clearance issues, suspicious door placement, disconnected-looking room groups, missing matching keycards, and uncertain dynamic-geometry/key progression cases. It does not model Doom collision, lift/stair movement, 3D-floor traversal, switch reachability, or the order in which keys can be collected. Treat warnings as review prompts and verify gameplay in UZDoom. The browser's First-Person view is a walkthrough preview without game collision; it is not a substitute for UZDoom.

## Keycard workflow

Doors support the existing `lock` values: `0` unlocked, `1` red, `2` blue, and `3` yellow. The editor exposes these as Required Keycard choices. Use **Place Matching Keycard** on a locked door, then click the desired map location; the editor never drops a pickup automatically or places it behind the lock. The Actors palette also has a Keys category. A collected color keycard is reusable across all doors requiring that color. Key-color outlines/labels in the 2D view do not replace or alter the door texture. Linked switches targeting a locked door keep that door's key requirement.

MCP edits use the same numeric `lock` field and Doom keycard thing types: red `13`, blue `5`, yellow `6`. Existing maps that omit `lock` remain unlocked. Invalid lock values fail validation. The keycard gameplay fixture can be regenerated with `node scripts/keycard-gameplay-map.js`; it writes separate test outputs and does not replace the current editor project. Automated compiler tests cover locked actions and linked-switch lock preservation; manual UZDoom confirmation of denial, matching-key opening, key reuse, and linked-switch interaction remains an explicit gameplay acceptance check.

The full smart-object engine reference fixture is generated with `node scripts/smart-object-reference-map.js` and writes `maps/smart_object_reference_test.json` plus `.wad`. Its automated compiler test covers every currently supported smart-object type, the three key locks, and the linked locked-door switch. The test proves compilation and PWAD structure, not successful interaction in UZDoom.

## Development

Requires Node.js 20 or newer. Install dependencies once with `npm install`, launch the editor with `npm start`, run the MCP stdio process with `npm run mcp` (through an MCP client, not as a standalone terminal UI), and run automated tests with `npm test`. The browser UI workflow test uses an installed Chrome or Edge through its DevTools protocol; it skips automatically when neither browser is available (or accepts `CHROME_BIN` / `EDGE_BIN` to select an executable).
