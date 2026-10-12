// Watches every response; any that is a PDF gets recorded for its tab.
// The list lives in memory and is mirrored to storage.session so the popup
// can read it and it survives the service worker going to sleep.

const found = {}; // "tab:<id>" -> [{ url, name, size }]

const ready = chrome.storage.session.get(null).then((saved) => {
  Object.assign(found, saved);
});

function header(headers, name) {
  const h = headers?.find((x) => x.name.toLowerCase() === name);
  return h ? h.value : "";
}

// Servers sometimes send raw UTF-8 bytes in headers, which arrive as latin-1 mojibake.
function fixMojibake(s) {
  if (![...s].some((c) => c.charCodeAt(0) > 127) || [...s].some((c) => c.charCodeAt(0) > 255)) return s;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  } catch {
    return s;
  }
}

function filenameFrom(url, headers) {
  const cd = header(headers, "content-disposition");
  if (cd) {
    let m = cd.match(/filename\*\s*=\s*[\w-]*'[\w-]*'([^;]+)/i);
    if (m) {
      try { return decodeURIComponent(m[1].trim().replace(/^"|"$/g, "")); } catch {}
    }
    m = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
    if (m) {
      const raw = fixMojibake(m[1].trim());
      try { return decodeURIComponent(raw); } catch { return raw; }
    }
  }
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (seg) return decodeURIComponent(seg);
  } catch {}
  return "document.pdf";
}

function sizeFrom(statusCode, headers) {
  const range = header(headers, "content-range").match(/\/(\d+)$/);
  if (range) return Number(range[1]);
  const len = Number(header(headers, "content-length"));
  return statusCode === 200 && len ? len : null;
}

function isPdf(url, headers) {
  const type = header(headers, "content-type").toLowerCase();
  if (type.includes("application/pdf") || type.includes("application/x-pdf")) return true;
  if (/\.pdf\b/i.test(header(headers, "content-disposition"))) return true;
  let path = "";
  try { path = new URL(url).pathname; } catch {}
  return type.includes("octet-stream") && /\.pdf$/i.test(path);
}

function updateBadge(tabId) {
  const n = found[`tab:${tabId}`]?.length || 0;
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : "" }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#d93025" }).catch(() => {});
}

chrome.webRequest.onHeadersReceived.addListener(
  async (details) => {
    const { tabId, url, statusCode, responseHeaders, type } = details;
    if (tabId < 0) return;
    await ready;
    const key = `tab:${tabId}`;

    // A new top-level page means a fresh list for this tab.
    if (type === "main_frame") delete found[key];

    if ((statusCode === 200 || statusCode === 206) && isPdf(url, responseHeaders)) {
      const list = (found[key] ||= []);
      const size = sizeFrom(statusCode, responseHeaders);
      const existing = list.find((x) => x.url === url);
      if (existing) {
        existing.size ||= size;
      } else {
        list.push({ url, name: filenameFrom(url, responseHeaders), size });
      }
    }

    if (found[key]) chrome.storage.session.set({ [key]: found[key] });
    else chrome.storage.session.remove(key);
    updateBadge(tabId);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  delete found[`tab:${tabId}`];
  chrome.storage.session.remove(`tab:${tabId}`);
});
