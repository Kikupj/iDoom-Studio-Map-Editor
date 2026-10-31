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

## Game profiles: New Bricks City by default

The editor builds maps for a mod, described by a game profile in `profiles/`. The default is **New Bricks City** (`profiles/new-bricks-city.json`); `IDOOM_PROFILE=freedoom` (or `"profile": "freedoom"` in `studio.config.json`) gives the plain Freedoom editor.

- **The mod folder** is found from, in order: the `IDOOM_MOD_DIR` environment variable, `"modDir"` in `studio.config.json` (copy `studio.config.example.json`; it isn't in git), then the profile's `modDirCandidates`, relative to the editor folder (`../New-Bricks-City/nbc` and similar). The server logs where it looked when it can't find it, and the browser says so too; the editor then falls back to Freedoom only.
- **Assets are read live from the mod**: every texture and flat under `textures/`, `flats/` and `patches/` (PNG or Doom patch; in UZDoom any texture works as a flat), and sprites under `sprites/`, over the Freedoom IWAD. The texture browser has a tab per source (New Bricks City, City, Props, Corpo Wars, Freedoom).
- **Map things are read from the mod**: every editor number in its MAPINFO `DoomEdNums` blocks (and included files) and numbered DECORATE actors, with each class's name (`//$Title`, `Tag`, or the class name), size (`Radius`/`Height`, or a furniture `Footprint`) and first Spawn frame, inheriting from parent classes. Things drawn as 3D models (MODELDEF) or voxels show a labelled marker. The profile sorts them into palette categories (Raid markers, Precinct, Bricks, Furniture, Decor, Vehicles) and keeps a few Doom things up front, renamed for the mod (a Zombieman spot is a **gang member spot**: a raid clears it and stands one of the holding gang there). Every other Doom thing stays valid, under "Freedoom", so older maps still load.
- **Raid markers** (New Bricks City's `nbc/zscript/nbc/raidmarks.zs`): invisible things that tell a raid about the map. Gang spots by role: ground (26023), perch, up high (26024), reinforcements, at the edges (26025), off guard (26026); the leader's place (26027), the extraction point at the exit (26028), the rooftop insertion (26020). **Precinct** things for Checkpoint 9: a room marker (26030, its room number in `args[0]`), the motor pool's parking bays (26031, `args[0]` 1 for the helipad), officer spots, the raid board, the Evidence Locker, the squad room, the captain and the pilot.
- **Thing arguments**: a thing's `args` (up to five integers) are written as UDMF `arg0`-`arg4`.
- **Wrapped mid textures**: a window with `midWrap: true` repeats its `midTexture` up the whole opening (UDMF `wrapmidtex`), for a chain-link cage or cell bars from floor to ceiling.
- **Door texture scale**: a door's `textureScaleX` / `textureScaleY` (UDMF `scalex_top` / `scaley_top` on its faces) fit a door texture to its doorway, e.g. a 64 x 128 door texture on a 56-wide door that opens 72 high: 64/56 and 128/72. A door behind a doorway header (a window in front of it) shows its own texture.
- **The skyline**: the profile's skies are 3D skyboxes in the "city" style: rings of towers round the SkyViewpoint (nearer lower and wider, farther taller and thinner, some with stepped tops) in the mod's lit-window facades, seeded by the map's name. Their rings, heights, widths and textures are the sky preset's `diorama` settings.
- **Things at a height**: a thing's `z` is its height above the floor (UDMF `height`), for wall decor up a facade.
- **Themes, skies and scale**: twelve Bricks material themes (tenement, flat, stairwell, street, yard, rooftop, basement, warehouse, precinct, lobby, subway, storm drain) built from the mod's textures, its three skies, room heights and doors at the mod's scale (a person is 56 units: ceilings 72-128, doors 68 high and 48 wide), and two starter maps (`nbc_block`, `nbc_blank`). A door between spaces of different heights opens to the lower ceiling and shows its texture up the taller side: give it a doorway room at door height (72) on the tall side, like `nbc_block`'s stoop.
- **Map lumps, export and playtest**: a project's `mapLump` (the title bar field, or `idoom_set_project_settings`) names the map, e.g. `NBC_HUB`; empty uses the profile default `NBC_MAP`. Under New Bricks City the WAD carries no ZMAPINFO (the mod's MAPINFO defines its maps), and **Export .WAD** also writes `<mod>/maps/<LUMP>.wad` for an `NBC_*` lump (up to 8 characters), returning the MAPINFO entry to add for a new map. **Play in UZDoom** loads the IWAD, the mod folder and the map, on its own lump.

## Agent workflow

1. Call `idoom_get_project` and record its `revision`.
2. Call `idoom_get_catalog` to inspect the game profile (mod, scale, map naming), themes, map thing types (the mod's included), textures and flats with their source groups, door lock metadata, and starter maps.
3. Use `idoom_create_project` or edit the current project with `idoom_add_object`, `idoom_update_object`, `idoom_delete_object`, `idoom_link_objects`, or `idoom_attach_room`. Combine related edits with `idoom_apply_batch` for one all-or-nothing revision. Supply the most recent revision on every write. A successful edit is pushed to an open browser editor immediately.
4. Call `idoom_validate_project` with the latest revision for schema/compiler validation and `idoom_map_check` for structured playability guidance. Map Check reports errors, warnings, informational notes, affected IDs, suggestions, and its analysis limits. Missing starts/exits, actor clearance, connectivity, and key progression findings are guidance, not a guarantee of gameplay behavior.
5. Call `idoom_save_project` to save the named JSON project and refresh its WAD when playable geometry compiles. Structurally valid unfinished drafts can be saved as JSON. Autosave recovery copies are kept separate. Call `idoom_export_wad` to write playable output; defined contract errors block export/playtest, while warnings require human judgment.
6. Call `idoom_playtest` only when intentionally launching UZDoom.

The `doom://project/current` and `doom://catalog` resources expose the same live project and catalog information. Tool responses are JSON in both text and structured content. Mutation failures are atomic. Browser and MCP project operations share storage, validation, save/export/playtest, and Map Check services. A revision conflict means a person or another agent changed the map first: call `idoom_get_project`, inspect/reconcile, and retry against the new revision instead of replaying a stale full map.

The editor and shared session keep bounded undo/redo history. Use `idoom_undo` or `idoom_redo` with the current revision to revert a committed change. When an agent update arrives while the browser has uncommitted local edits or an active drag, the editor preserves those edits and reports the conflict; reload the editor to review the latest server revision before continuing.

## Tools

- `idoom_get_project`, `idoom_get_catalog`
- `idoom_create_project`, `idoom_attach_room`, `idoom_set_project_settings` (name, skybox, map lump)
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
