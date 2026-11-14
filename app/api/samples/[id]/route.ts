import { corsHeaders, errorResponse, json, options } from "../../../../lib/api";
import { getSample, getSamplePdf } from "../../../../lib/samples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const sample = await getSample(id);
    if (new URL(req.url).searchParams.get("format") === "pdf") {
      const pdf = await getSamplePdf(sample);
      return new Response(Buffer.from(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${sample.pdfFile}"`,
          "Cache-Control": "public, max-age=3600",
          ...corsHeaders(),
        },
      });
    }
    const { pdfFile, ...rest } = sample;
    return json({ ...rest, ...(pdfFile ? { pdfUrl: `/api/samples/${sample.id}?format=pdf` } : {}) });
  } catch (err) {
    return errorResponse(err);
  }
}

export const OPTIONS = options;
