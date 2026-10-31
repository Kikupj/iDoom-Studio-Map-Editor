const fs = require('fs');
const path = require('path');
const { compileProject, buildUdmfWadBuffer } = require('./udmf-compiler');
const { clone, validateProject } = require('./project-session');
const { analyzeMap, validatePlayableProject } = require('./map-check');
const { safeProjectName, writeAtomically } = require('./project-storage');

// profile (optional, src/game-profile.js): with map.writeZMapInfo false the WAD carries no ZMAPINFO (the mod's own
// MAPINFO defines its maps), and with map.exportToMod an export also lands in the mod's maps folder as <LUMP>.wad
// when the project's map lump matches map.lumpPattern.
function makeProjectPipeline({ storage, mapsDir, wadPath, wadCatalog, launchPlaytest, profile = null }) {
    if (!storage) throw new Error('A project storage service is required.');
    const mapSettings = profile?.map || {};

    function wadBuffer(compiled) {
        const zmapinfo = mapSettings.writeZMapInfo === false ? '' : compiled.zmapinfo;
        return buildUdmfWadBuffer(compiled.textmap, compiled.mapLump || 'MAP01', zmapinfo);
    }

    // the mod's maps folder, for a lump the profile accepts there
    function modExportPath(lump) {
        if (!mapSettings.exportToMod || !profile?.modDir) return null;
        if (mapSettings.lumpPattern && !new RegExp(mapSettings.lumpPattern).test(lump)) return null;
        return path.join(profile.modDir, mapSettings.exportSubdir || 'maps', `${lump}.wad`);
    }

    function validateDraft(project) {
        return validateProject(clone(project || {}), { requireRoom: false, wadCatalog });
    }

    function check(project) {
        return analyzeMap(project, { wadCatalog });
    }

    function compilePlayable(project) {
        const contractFindings = validatePlayableProject(project, { wadCatalog });
        const diagnostics = check(project);
        const blockers = [...contractFindings, ...diagnostics.diagnostics.filter(item => item.severity === 'error')];
        if (blockers.length) {
            const error = new Error(blockers.map(item => item.message).join(' '));
            error.statusCode = 400;
            error.diagnostics = [...new Map(blockers.map(item => [item.code, item])).values()];
            error.validationErrors = error.diagnostics.map(item => item.message);
            throw error;
        }
        const compiled = compileProject(project);
        return { compiled, diagnostics };
    }

    function saveNamed(project, options = {}) {
        const errors = validateDraft(project);
        if (errors.length) {
            const error = new Error(`Project validation failed: ${errors.join(' ')}`);
            error.statusCode = 400;
            error.validationErrors = errors;
            throw error;
        }
        const saved = storage.saveNamed(project, options);
        let stats = null;
        if ((project.rooms || []).length > 0) {
            try {
                const compiled = compileProject(project);
                writeAtomically(path.join(mapsDir, `${saved.name}.wad`), wadBuffer(compiled));
                stats = compiled.stats;
            } catch (error) {
                // A JSON draft remains saved even if it is not yet compilable as playable geometry.
                try { fs.unlinkSync(path.join(mapsDir, `${saved.name}.wad`)); } catch { }
                stats = null;
            }
        } else try { fs.unlinkSync(path.join(mapsDir, `${saved.name}.wad`)); } catch { }
        return { ok: true, ...saved, projectPath: `maps/${saved.name}.json`, wadPath: stats ? `maps/${saved.name}.wad` : null, stats, diagnostics: check(project) };
    }

    function exportWad(project, name) {
        const { compiled, diagnostics } = compilePlayable(project);
        const safeName = safeProjectName(name || project.name, 'custom_map');
        const buffer = wadBuffer(compiled);
        const filePath = path.join(mapsDir, `${safeName}.wad`);
        writeAtomically(filePath, buffer);
        const result = { buffer, filePath, wadPath: `maps/${safeName}.wad`, mapLump: compiled.mapLump, stats: compiled.stats, diagnostics };
        const modPath = modExportPath(compiled.mapLump);
        if (modPath) {
            fs.mkdirSync(path.dirname(modPath), { recursive: true });
            writeAtomically(modPath, buffer);
            result.modPath = modPath;
            // the mod's MAPINFO needs an entry for a new map (the WAD has no ZMAPINFO of its own)
            if (mapSettings.writeZMapInfo === false) result.mapinfo = compiled.mapinfo;
        }
        return result;
    }

    async function playtest(project, options = {}) {
        const playProject = clone(project);
        if (options.spawnAt && Number.isFinite(options.spawnAt.x) && Number.isFinite(options.spawnAt.y)) {
            playProject.things = (playProject.things || []).filter(thing => thing.type !== 1);
            playProject.things.unshift({
                id: 'th_cursor_spawn', type: 1,
                x: Math.round(options.spawnAt.x), y: Math.round(options.spawnAt.y),
                angle: Math.round(options.spawnAt.angle || 0)
            });
        }
        const { compiled, diagnostics } = compilePlayable(playProject);
        const buffer = wadBuffer(compiled);
        writeAtomically(wadPath, buffer);
        if (typeof launchPlaytest !== 'function') throw new Error('Playtest is not available on this host.');
        const launch = await launchPlaytest({ ...options, mapLump: compiled.mapLump });
        return { ok: true, launched: true, wadPath: 'maps/live_playtest.wad', mapLump: compiled.mapLump, command: launch?.command, stats: compiled.stats, diagnostics };
    }

    return { check, validateDraft, saveNamed, exportWad, playtest, compilePlayable };
}

module.exports = { makeProjectPipeline };
