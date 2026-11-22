export function buildV2BoxSubscriptionLink(
  subscriptionUrl: string | null | undefined,
  username: string | undefined,
): string | null {
  const name = username?.trim();
  if (!subscriptionUrl || !name) return null;

  try {
    const url = new URL(subscriptionUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  } catch {
    return null;
  }

  // The #name form is supported on Android and iOS. The name query parameter is iOS-only.
  return `v2box://install-sub?url=${encodeURIComponent(subscriptionUrl)}#${encodeURIComponent(name)}`;
}
