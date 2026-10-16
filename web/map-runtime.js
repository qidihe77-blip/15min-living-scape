// SDK startup is separate from search and backend health. No AKs in timing records.
export function createMapRuntime({ windowRef = window, documentRef = document,
  onStage = () => {}, timeoutMs = 30000, searchTimeoutMs = 10000 } = {}) {
  let pending;
  let searchPending;
  const coreReady = () => Boolean(windowRef.BMapGL?.Map && windowRef.BMapGL?.Point);
  function load(ak) {
    if (!ak) return Promise.reject(new Error('缺少浏览器地图配置，请检查 VITE_BAIDU_MAP_AK。'));
    if (coreReady()) return Promise.resolve(windowRef.BMapGL);
    if (pending) return pending;
    pending = new Promise((resolve, reject) => {
      const callback = '__onLifeCircleMapCoreReady';
      const script = documentRef.createElement('script');
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        windowRef.clearTimeout(timeoutId);
        // A slow SDK can invoke its callback after a timeout. Keep a harmless callback in that case.
        windowRef[callback] = () => {};
        script.onload = null;
        script.onerror = null;
        if (error) { script.remove(); pending = null; reject(error); }
        else { onStage('sdk-core-ready'); resolve(windowRef.BMapGL); }
      };
      windowRef[callback] = () => { if (coreReady()) finish(); };
      script.src = 'https://api.map.baidu.com/api?v=1.0&type=webgl&ak='
        + encodeURIComponent(ak) + '&callback=' + callback;
      script.async = true;
      script.fetchPriority = 'high';
      script.onload = () => { if (coreReady()) finish(); };
      script.onerror = () => finish(new Error('百度地图加载失败，请检查浏览器 AK、域名白名单与网络。'));
      const timeoutId = windowRef.setTimeout(() => {
        if (coreReady()) finish();
        else finish(new Error('百度地图加载超时，请检查网络后刷新页面。'));
      }, timeoutMs);
      onStage('sdk-requested');
      documentRef.head.append(script);
    });
    return pending;
  }
  function searchReady() {
    if (windowRef.BMapGL?.LocalSearch) return Promise.resolve(windowRef.BMapGL);
    if (searchPending) return searchPending;
    searchPending = new Promise((resolve, reject) => {
      let checkId;
      const timeoutId = windowRef.setTimeout(() => {
        windowRef.clearTimeout(checkId);
        searchPending = null;
        reject(new Error('地点搜索暂不可用，请稍后重试。'));
      }, searchTimeoutMs);
      const check = () => {
        if (windowRef.BMapGL?.LocalSearch) {
          windowRef.clearTimeout(timeoutId);
          onStage('search-ready');
          resolve(windowRef.BMapGL);
        } else checkId = windowRef.setTimeout(check, 150);
      };
      check();
    });
    return searchPending;
  }
  return { load, searchReady };
}

export function startMapServices({ fetcher = fetch, runtime, onStage = () => {}, timeoutMs = 5000 }) {
  async function json(path, label) {
    const response = await fetcher(path, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (!response.ok) throw new Error(label);
    return response.json();
  }
  const health = json('/api/health', '本地分析服务暂不可用。');
  const config = json('/api/config', '无法读取地图配置，请检查本地服务。');
  const map = config.then((value) => { onStage('config-ready'); return runtime.load(value.browserMapAk); });
  return { map, health };
}
