const $ = (s) => document.querySelector(s);
const status = (msg) => ($("#status").textContent = msg);

let tab;
let items = [];

function safeName(name) {
  let n = (name || "document").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/[. ]+$/, "").trim();
  if (!/\.pdf$/i.test(n)) n += ".pdf";
  if (n.length > 150) n = n.slice(0, 146) + ".pdf";
  return "PDF Grabber/" + n;
}

function fmtSize(bytes) {
  if (!bytes) return "size unknown";
  return bytes > 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.ceil(bytes / 1024) + " KB";
}

function download(url, name) {
  return chrome.downloads.download({ url, filename: safeName(name), conflictAction: "uniquify" });
}

function render() {
  const list = $("#list");
  list.innerHTML = "";
  $("#empty").hidden = items.length > 0;
  $("#all").disabled = items.length === 0;
  for (const item of items) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="info"><div class="name"></div><div class="meta"></div></div><button>Save</button>`;
    li.querySelector(".name").textContent = item.name;
    li.querySelector(".name").title = item.url;
    li.querySelector(".meta").textContent = fmtSize(item.size);
    li.querySelector("button").onclick = async () => {
      try {
        await download(item.url, item.name);
        status(`Saving ${item.name}…`);
      } catch (e) {
        status(`Failed: ${e.message}. Try "Grab from viewer".`);
      }
    };
    list.append(li);
  }
}

async function load() {
  const key = `tab:${tab.id}`;
  items = (await chrome.storage.session.get(key))[key] || [];
  render();
}

// Runs inside each frame of the page (MAIN world) to read PDF.js's loaded document.
async function grabFromPdfJs() {
  const app = window.PDFViewerApplication;
  if (!app || !app.pdfDocument) return null;
  const data = await app.pdfDocument.getData();
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(new Blob([data], { type: "application/pdf" }));
  });
  let name = "";
  try { name = app._docFilename || ""; } catch {}
  if (!name) {
    try { name = decodeURIComponent(new URL(app.url, location.href).pathname.split("/").pop()); } catch {}
  }
  if (!name || !/\.pdf$/i.test(name)) name = app._title || document.title || "document";
  return { name, dataUrl };
}

$("#all").onclick = async () => {
  let ok = 0;
  for (const item of items) {
    try { await download(item.url, item.name); ok++; } catch {}
  }
  status(`Started ${ok} of ${items.length} downloads.`);
};

$("#viewer").onclick = async () => {
  status("Looking for a PDF viewer on this page…");
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: "MAIN",
      func: grabFromPdfJs,
    });
    const hits = results.map((r) => r.result).filter(Boolean);
    if (!hits.length) return status("No PDF.js viewer with a loaded document found on this page.");
    for (const h of hits) await download(h.dataUrl, h.name);
    status(`Saved ${hits.length} PDF(s) from the viewer.`);
  } catch (e) {
    status(`Failed: ${e.message}`);
  }
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[`tab:${tab?.id}`]) load();
});

chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
  tab = t;
  load();
});
