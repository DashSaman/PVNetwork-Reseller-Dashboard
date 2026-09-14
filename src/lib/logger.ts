import { db } from "@/lib/db";

export async function logActivity(params: {
  actorType: "ADMIN" | "RESELLER";
  actorName: string;
  action: string;
  detail?: string;
  resellerId?: string | null;
}): Promise<void> {
  try {
    await db.activityLog.create({
      data: {
        actorType: params.actorType,
        actorName: params.actorName,
        action: params.action,
        detail: params.detail ?? null,
        resellerId: params.resellerId ?? null,
      },
    });
  } catch (e) {
    console.error("log failed:", (e as Error).message);
  }
}
