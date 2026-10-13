import { NextRequest, NextResponse } from "next/server";
import { requireReseller } from "@/lib/session";
import { getResellerWithAccess } from "@/lib/reseller-helpers";
import { activeExtension, jobSummary, previewExtension, startExtension, runExtensionStep, ExtensionError } from "@/lib/bulk-extension";

export const maxDuration = 120;
async function actor() {
  const session = await requireReseller();
  if (!session) throw new ExtensionError("دسترسی غیرمجاز", 401);
  const reseller = await getResellerWithAccess(session.uid);
  if (!reseller) throw new ExtensionError("حساب شما فعال نیست", 403);
  return reseller;
}
export async function GET(req: NextRequest) {
  try {
    const reseller = await actor();
    const jobId = req.nextUrl.searchParams.get("jobId");
    return NextResponse.json({ job: jobId ? await jobSummary(jobId, reseller.id) : await activeExtension(reseller.id) });
  } catch (e) { return failure(e); }
}
export async function POST(req: NextRequest) {
  try {
    const reseller = await actor();
    const body = await req.json();
    if (body.mode === "run" && typeof body.jobId === "string") return NextResponse.json({ job: await runExtensionStep(body.jobId, reseller.id) });
    const input = { trafficGB: body.trafficGB, days: body.days };
    if (body.mode === "preview") return NextResponse.json({ preview: await previewExtension(reseller.id, input) });
    if (body.mode === "start" && typeof body.hash === "string" && typeof body.requestId === "string") return NextResponse.json({ job: await startExtension(reseller.id, input, body.hash, body.requestId, reseller.username, "RESELLER") });
    return NextResponse.json({ error: "درخواست نامعتبر است" }, { status: 400 });
  } catch (e) { return failure(e); }
}
function failure(e: unknown) {
  if (e instanceof ExtensionError) return NextResponse.json({ error: e.message }, { status: e.status });
  return NextResponse.json({ error: e instanceof Error ? e.message : "خطا در افزایش گروهی" }, { status: 400 });
}
