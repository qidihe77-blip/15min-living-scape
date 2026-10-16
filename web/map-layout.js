// Resize the existing map after container reflow; never change view, evidence or requests.
export function observeMapLayout({ map, container, onResize = () => {}, host = window }) {
  let frame = 0, disposed = false, last = '';
  const measure = () => {
    const rect = container.getBoundingClientRect();
    return { width: rect.width, height: rect.height, dpr: host.devicePixelRatio || 1,
      innerWidth: host.innerWidth, innerHeight: host.innerHeight };
  };
  function flush() {
    frame = 0;
    if (disposed) return;
    const size = measure();
    if (size.width <= 0 || size.height <= 0) return;
    const key = [size.width.toFixed(2), size.height.toFixed(2), size.dpr].join('|');
    if (key === last) return;
    last = key;
    map.resize?.();
    onResize(size);
  }
  function schedule() {
    if (!disposed && !frame) frame = host.requestAnimationFrame(flush);
  }
  const observer = new host.ResizeObserver(schedule);
  observer.observe(container);
  host.addEventListener('resize', schedule);
  host.visualViewport?.addEventListener('resize', schedule);
  let resolution;
  function watchResolution() {
    resolution?.removeEventListener('change', resolutionChanged);
    resolution = host.matchMedia(`(resolution: ${host.devicePixelRatio || 1}dppx)`);
    resolution.addEventListener('change', resolutionChanged);
  }
  function resolutionChanged() { watchResolution(); schedule(); }
  watchResolution();
  schedule();
  return { schedule, dispose() {
    disposed = true;
    host.cancelAnimationFrame(frame);
    observer.disconnect();
    host.removeEventListener('resize', schedule);
    host.visualViewport?.removeEventListener('resize', schedule);
    resolution?.removeEventListener('change', resolutionChanged);
  } };
}
