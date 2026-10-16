// Required custom styles may start before tiles and never expose the SDK default.
// Legacy callers retain optional style behavior. Retries are explicit only.
export function createMapThemeRuntime(map, { styleIds, onState = () => {}, onTilesReady = () => {},
  styleTimeoutMs = 30000, baseTimeoutMs = 25000, waitForBasemap = true, fallbackToDefault = true,
  setTimer = globalThis.setTimeout.bind(globalThis), clearTimer = globalThis.clearTimeout.bind(globalThis) } = {}) {
  if (!map?.setMapStyleV2 || !map?.addEventListener || !styleIds?.dark || !styleIds?.light) {
    throw new TypeError('A BMapGL map and existing dark/light style IDs are required.');
  }
  let rendered = false, desired = null, pending = null, generation = 0, disposed = false;
  let status = 'loading_basemap', styleApplied = false;
  const publish = (value, reason = null) => { status = value; onState({ status, theme: desired, reason, basemapRendered: rendered,styleApplied }); };
  const baseTimer = setTimer(() => { if (!rendered && !disposed) publish('basemap_timeout', 'tile_load_timeout'); }, baseTimeoutMs);
  function fallback(token, reason) {
    if (!pending || pending.token !== token || disposed) return;
    clearTimer(pending.timer); pending = null;
    try {
      // SDK built-in default style; preserve the original instance, origin and overlays.
      if(fallbackToDefault){map.setMapStyleV2('default');publish('fallback',reason);}
      else publish('style_error',reason);
    } catch { publish('style_error', 'default_style_unavailable'); }
  }
  function apply() {
    if ((waitForBasemap && !rendered) || !desired || disposed) return;
    styleApplied=false;
    const token = ++generation;
    if (pending) clearTimer(pending.timer);
    pending = { token, timer: setTimer(() => fallback(token, 'style_load_timeout'), styleTimeoutMs) };
    publish('loading_style');
    try { map.setMapStyleV2({ styleId: styleIds[desired] }); }
    catch { fallback(token, 'style_apply_failed'); }
  }
  const tilesReady = () => {
    if (disposed || rendered) return;
    rendered = true; clearTimer(baseTimer); onTilesReady();
    if(styleApplied)publish('applied');
    else if(!pending){publish('basemap_ready');apply();}
  };
  const styleReady = () => {
    if (disposed || !pending) return;
    clearTimer(pending.timer); pending = null; styleApplied=true;publish(rendered?'applied':'waiting_for_styled_tiles');
  };
  map.addEventListener('tilesloaded', tilesReady);
  map.addEventListener('style_loaded', styleReady);
  function select(theme, { retry = false } = {}) {
    if (!['dark','light'].includes(theme)) throw new RangeError('Unknown map theme.');
    if (disposed) return false;
    if (desired === theme && !retry) return true;
    desired = theme;
    if (pending) { clearTimer(pending.timer); pending = null; }
    if(rendered||!waitForBasemap)apply();else publish('waiting_for_basemap');
    return true;
  }
  return { select, retry: () => desired ? select(desired, { retry: true }) : false,
    getState: () => ({ status, theme: desired, basemapRendered: rendered }),
    dispose() { disposed = true; clearTimer(baseTimer); if (pending) clearTimer(pending.timer); pending = null;
      map.removeEventListener?.('tilesloaded', tilesReady); map.removeEventListener?.('style_loaded', styleReady); } };
}
