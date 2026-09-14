import { headers } from "next/headers";
import { getPortalData } from "@/lib/user-portal";
import { PortalClient } from "./portal-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "اشتراک من",
  icons: { icon: "/logo.webp" },
};

export default async function SubPortalPage({ params }: { params: Promise<{ subId: string }> }) {
  const { subId } = await params;
  const h = await headers();
  const requestHost = (h.get("x-forwarded-host") || h.get("host") || "").split(",")[0].trim().split(":")[0];
  const data = await getPortalData(subId, requestHost);
  return <PortalClient data={data} />;
}
