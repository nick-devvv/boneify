"use client";

// The real PDF, in Adobe's PDF Embed API viewer, with every receipt highlighted in its verdict colour.
// The API sends ready-made annotations (adobeAnnotations) and a stable document id (adobeDocId).
// Needs NEXT_PUBLIC_ADOBE_CLIENT_ID (a free PDF Embed API key, locked to the site's domain). Without it,
// or if Adobe's script can't load, onFail fires and the page falls back to the drawn contract page.

import { useEffect, useId, useRef } from "react";
import type { CheckResult } from "../../lib/types";

const SDK = "https://acrobatservices.adobe.com/view-sdk/viewer.js";
export const ADOBE_CLIENT_ID = process.env.NEXT_PUBLIC_ADOBE_CLIENT_ID || "";

type Ann = { id?: string; bodyValue?: string };
type AdobeViewer = {
  getAnnotationManager: () => Promise<{ addAnnotations: (a: unknown[]) => Promise<unknown>; selectAnnotation: (id: string) => Promise<unknown>; setConfig: (c: Record<string, boolean>) => Promise<unknown> }>;
  getAPIs: () => Promise<{ gotoLocation: (page: number) => Promise<unknown> }>;
};
type AdobeDC = { View: new (o: { clientId: string; divId: string }) => { previewFile: (content: unknown, opts: unknown) => Promise<AdobeViewer> } };

let sdkPromise: Promise<AdobeDC> | null = null;
function loadSdk(): Promise<AdobeDC> {
  const w = window as unknown as { AdobeDC?: AdobeDC };
  if (w.AdobeDC) return Promise.resolve(w.AdobeDC);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Adobe viewer timed out")), 12000);
    document.addEventListener("adobe_dc_view_sdk.ready", () => { window.clearTimeout(timer); if (w.AdobeDC) resolve(w.AdobeDC); else reject(new Error("no AdobeDC")); }, { once: true });
    const s = document.createElement("script");
    s.src = SDK;
    s.async = true;
    s.onerror = () => { window.clearTimeout(timer); sdkPromise = null; reject(new Error("Adobe viewer failed to load")); };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export function AdobeViewer({ result, pdf, fileName, selected, height = 640, onFail }: {
  result: CheckResult; pdf: { url: string } | { file: File }; fileName: string; selected: string | null; height?: number; onFail: () => void;
}) {
  const divId = `adobe-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const viewer = useRef<AdobeViewer | null>(null);

  useEffect(() => {
    let dead = false;
    if (!ADOBE_CLIENT_ID || !result.adobeDocId) { onFail(); return; }
    loadSdk().then((AdobeDC) => {
      if (dead) return;
      const view = new AdobeDC.View({ clientId: ADOBE_CLIENT_ID, divId });
      const content = "url" in pdf ? { location: { url: new URL(pdf.url, window.location.href).toString() } } : { promise: pdf.file.arrayBuffer() };
      return view.previewFile({ content, metaData: { fileName, id: result.adobeDocId } }, {
        // FULL_WINDOW + annotation tools left on: Adobe refuses annotation APIs otherwise ("Annotation APIs not enabled",
        // "APIs not allowed on this PDF"). Its toolbar is hidden below with setConfig instead. includePDFAnnotations:false
        // keeps our highlights out of the PDF itself, so no "unsaved changes / download" prompt appears.
        embedMode: "FULL_WINDOW", enableAnnotationAPIs: true, includePDFAnnotations: false,
        showDownloadPDF: false, showPrintPDF: false, showLeftHandPanel: false,
      }).then(async (v) => {
        if (dead) return;
        viewer.current = v;
        const m = await v.getAnnotationManager();
        await m.setConfig({ showToolbar: false, showCommentsPanel: false, showToolsOnTextSelection: false }).catch(() => {});
        await m.addAnnotations(result.adobeAnnotations);
      });
    }).catch(() => { if (!dead) onFail(); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.id]);

  // jump to the selected sentence's receipt and select its highlight
  useEffect(() => {
    const v = viewer.current;
    const c = result.claims.find((x) => x.id === selected);
    if (!v || !c) return;
    const page = c.receipt.highlight?.page ?? c.receipt.page;
    if (page) v.getAPIs().then((a) => a.gotoLocation(page)).catch(() => {});
    const ann = (result.adobeAnnotations as Ann[]).find((a) => a.bodyValue?.endsWith(c.text));
    if (ann?.id) v.getAnnotationManager().then((m) => m.selectAnnotation(ann.id!)).catch(() => {});
  }, [selected, result]);

  return <div id={divId} className="keep" style={{ width: "100%", height, background: "#fff", borderRadius: 6, overflow: "hidden" }} />;
}
