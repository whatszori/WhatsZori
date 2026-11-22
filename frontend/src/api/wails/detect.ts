// The native side injects its message bridge before any page script runs: WebView2 exposes
// chrome.webview, WebKitGTK and WKWebView expose webkit.messageHandlers.external. That's the
// same check @wailsio/runtime does, without importing it (it logs a warning in a browser).
export function hasWailsRuntime(w: Window = window): boolean {
  const anyWin = w as unknown as {
    chrome?: { webview?: { postMessage?: unknown } };
    webkit?: { messageHandlers?: { external?: { postMessage?: unknown } } };
  };
  return (
    typeof anyWin.chrome?.webview?.postMessage === 'function' ||
    typeof anyWin.webkit?.messageHandlers?.external?.postMessage === 'function'
  );
}

export type BackendChoice = 'wails' | 'mock';

export function chooseBackend(search: string, wailsPresent: boolean): BackendChoice {
  const forced = new URLSearchParams(search).get('backend');
  if (forced === 'mock') return 'mock';
  return wailsPresent ? 'wails' : 'mock';
}
