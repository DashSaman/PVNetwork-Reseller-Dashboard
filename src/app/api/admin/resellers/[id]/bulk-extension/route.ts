import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { activeExtension, jobSummary, previewExtension, startExtension, runExtensionStep, ExtensionError } from "@/lib/bulk-extension";

export const maxDuration = 120;
type Ctx = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, ctx: Ctx) {
  if (!await requireAdmin()) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const jobId = req.nextUrl.searchParams.get("jobId");
    return NextResponse.json({ job: jobId ? await jobSummary(jobId, id) : await activeExtension(id) });
  } catch (e) { return failure(e); }
}
export async function POST(req: NextRequest, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const body = await req.json();
    if (body.mode === "run" && typeof body.jobId === "string") return NextResponse.json({ job: await runExtensionStep(body.jobId, id) });
    const input = { trafficGB: body.trafficGB, days: body.days };
    if (body.mode === "preview") return NextResponse.json({ preview: await previewExtension(id, input) });
    if (body.mode === "start" && typeof body.hash === "string" && typeof body.requestId === "string") {
      return NextResponse.json({ job: await startExtension(id, input, body.hash, body.requestId, admin.username) });
    }
    return NextResponse.json({ error: "درخواست نامعتبر است" }, { status: 400 });
  } catch (e) { return failure(e); }
}
function failure(e: unknown) {
  if (e instanceof ExtensionError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof SyntaxError) return NextResponse.json({ error: "درخواست نامعتبر است" }, { status: 400 });
  console.error("bulk extension failed", e);
  return NextResponse.json({ error: e instanceof Error ? e.message : "خطا در افزایش گروهی" }, { status: 400 });
}
