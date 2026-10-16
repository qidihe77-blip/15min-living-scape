// Current BMapGL sets native XHR.timeout=10000 on its large style response.
// Raise that short timeout for this single SDK endpoint using standard XHR APIs.
// Parameters, signatures, headers, cancellation and other endpoints stay with the SDK.
const INSTALLATION = Symbol.for('life-circle.style-request-timeout');
export function installBaiduStyleTimeout(windowRef = window, { timeoutMs = 25000, localStyleEndpoint = null } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10000 || timeoutMs > 30000) throw new RangeError('Style timeout must be 10–30 seconds.');
  if (windowRef[INSTALLATION]) return windowRef[INSTALLATION];
  const proto = windowRef.XMLHttpRequest?.prototype;
  const originalOpen = proto?.open;
  const timeout = proto && Object.getOwnPropertyDescriptor(proto, 'timeout');
  if (!originalOpen || !timeout?.get || !timeout?.set || !timeout.configurable) return { installed:false, dispose(){} };
  const requests = new WeakMap();
  function open(method, url, ...rest) {
    let isStyle = false;
    try {
      const target = new URL(String(url), windowRef.location?.href ?? 'http://localhost/');
      isStyle = String(method).toUpperCase() === 'POST' && target.hostname === 'api.map.baidu.com'
        && target.pathname === '/custom/v2/mapstyle' && ['http:','https:'].includes(target.protocol);
    } catch { /* Native open keeps its normal validation and errors. */ }
    const previous = requests.get(this);
    const requested = previous?.isStyle ? previous.requested : timeout.get.call(this);
    const result = originalOpen.call(this, method, isStyle && localStyleEndpoint ? localStyleEndpoint : url, ...rest);
    requests.set(this, { isStyle, requested });
    // A reused XHR must not carry the adjusted style timeout into Place/Route.
    if (!isStyle && previous?.isStyle) timeout.set.call(this, requested);
    return result;
  }
  function setTimeoutValue(value) {
    const request = requests.get(this);
    if (request) request.requested = value;
    const adjusted = request?.isStyle && typeof value === 'number' && value > 0 && value < timeoutMs ? timeoutMs : value;
    timeout.set.call(this, adjusted);
  }
  proto.open = open;
  Object.defineProperty(proto, 'timeout', { ...timeout, set:setTimeoutValue });
  const installation = { installed:true, timeoutMs, dispose() {
    if (proto.open === open) proto.open = originalOpen;
    if (Object.getOwnPropertyDescriptor(proto, 'timeout')?.set === setTimeoutValue) Object.defineProperty(proto, 'timeout', timeout);
    if (windowRef[INSTALLATION] === installation) delete windowRef[INSTALLATION];
  } };
  windowRef[INSTALLATION] = installation;
  return installation;
}
