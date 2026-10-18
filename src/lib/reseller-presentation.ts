/** Display metadata only: never change connection IDs, hosts or stored settings. */
export const PUBLIC_SERVICE_NAME = "سرویس";
export const PUBLIC_SERVICE_ERROR = "دریافت اطلاعات سرویس موقتاً ممکن نیست؛ دوباره تلاش کنید.";

export function publicLocationLabel(value: string | null | undefined, panelName?: string): string {
  let label = value || "";
  if (panelName) label = label.split(panelName).join("");
  label = label.replace(/3x-ui|x-ui|ثنایی/gi, "").replace(/^[\s·|—-]+|[\s·|—-]+$/g, "").trim();
  return label || "لوکیشن";
}

export function publicPanelErrors(errors: readonly { panelId?: string; panelName?: string; msg?: string }[]) {
  return errors.map((error) => ({ panelId: error.panelId, panelName: PUBLIC_SERVICE_NAME, msg: PUBLIC_SERVICE_ERROR }));
}
