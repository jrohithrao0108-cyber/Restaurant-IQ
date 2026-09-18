// Optional bridge to QZ Tray (https://qz.io) — a small free desktop agent
// that lets a browser print HTML directly to a NAMED installed printer, with
// no print dialog and no manual "pick a printer" step. This is what makes
// "KOT always to the kitchen printer, Bill always to the counter printer"
// possible: plain `window.print()` (see kotPrinter.ts / receiptPrinter.ts's
// popup fallback) can only ever open the OS print dialog for a human to
// choose from — it has no way to target a specific printer by name.
//
// Entirely OPTIONAL. If QZ Tray isn't installed/running on this PC, or no
// printer name has been configured in Settings, every function below fails
// fast and the caller (kotPrinter.ts / receiptPrinter.ts) falls back to the
// exact popup + window.print() flow this app always used. Nothing breaks
// for a restaurant that never sets this up.
//
// Uses QZ Tray's "unsigned" mode (no certificate/signing server) — the
// simplest setup for a single restaurant's own printers. The first print
// after QZ Tray starts (and periodically after) shows a one-time "An
// unsigned application (Chrome) wants to print/access X. Allow?" prompt
// inside the QZ Tray app itself, with a "remember this decision" checkbox.
// That prompt is QZ Tray's, not this app's — nothing we can suppress from
// here without moving to certificate-based signing later.

let qzModulePromise: Promise<any> | null = null;
let securityConfigured = false;

async function loadQz(): Promise<any> {
  if (typeof window === "undefined") {
    throw new Error("QZ Tray is only available in the browser.");
  }
  if (!qzModulePromise) {
    qzModulePromise = import("qz-tray").then((mod) => {
      const qz = (mod as any).default || mod;

      if (!securityConfigured) {
        // Unsigned mode: resolving with no cert/signature is QZ Tray's
        // documented pattern for "don't use certificate signing." Every
        // print/connect still requires the user to have clicked "Allow" in
        // the QZ Tray app at least once (see file header).
        qz.security.setCertificatePromise((resolve: () => void) => resolve());
        qz.security.setSignaturePromise(() => (resolve: () => void) => resolve());
        securityConfigured = true;
      }

      return qz;
    });
  }
  return qzModulePromise;
}

/** Resolves once connected, or rejects quickly if QZ Tray isn't running — never hangs forever. */
async function ensureConnected(timeoutMs = 3000): Promise<any> {
  const qz = await loadQz();

  if (!qz.websocket.isActive()) {
    await Promise.race([
      qz.websocket.connect({ retries: 0 }),
      new Promise((_, reject) =>
        window.setTimeout(
          () => reject(new Error("Timed out connecting to QZ Tray. Is it installed and running?")),
          timeoutMs
        )
      ),
    ]);
  }

  return qz;
}

/** True if QZ Tray is installed, running, and reachable right now. Never throws. */
export async function isQzTrayConnected(): Promise<boolean> {
  try {
    await ensureConnected(2000);
    return true;
  } catch {
    return false;
  }
}

/** Every printer name Windows currently has installed, as QZ Tray sees them. */
export async function listQzPrinters(): Promise<string[]> {
  const qz = await ensureConnected();
  const found = await qz.printers.find();
  // qz.printers.find() with no argument returns a single string if there's
  // only one printer installed, or a string[] if there's more than one —
  // normalize to an array either way.
  return Array.isArray(found) ? found : [found].filter(Boolean);
}

/**
 * Prints a full HTML document to a specific named printer, silently — no
 * popup window, no print dialog. Throws on any failure (QZ Tray not
 * running, printer name not found, print rejected) so the caller can fall
 * back to the popup flow.
 */
export async function printHtmlToPrinter(printerName: string, html: string): Promise<void> {
  if (!printerName || !printerName.trim()) {
    throw new Error("No printer name configured.");
  }
  const qz = await ensureConnected();
  const config = qz.configs.create(printerName.trim());
  const data = [
    {
      type: "pixel",
      format: "html",
      flavor: "plain",
      data: html,
    },
  ];
  await qz.print(config, data);
}
