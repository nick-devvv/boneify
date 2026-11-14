import { errorResponse, json, options } from "../../../lib/api";
import { listSamples } from "../../../lib/samples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const samples = await listSamples();
    return json({
      samples: samples.map((s) => ({ id: s.id, title: s.title, description: s.description, sourceName: s.sourceName, hasPdf: Boolean(s.pdfFile) })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export const OPTIONS = options;
