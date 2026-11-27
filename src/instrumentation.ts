export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeInboundGrantRecovery } = await import('./lib/inbound-revocation');
    initializeInboundGrantRecovery();
    const { initializeCustomerRenewal } = await import('./lib/auto-renewal');
    initializeCustomerRenewal();
    const { initializeEventWebhooks } = await import('./lib/event-webhooks');
    initializeEventWebhooks();
  }
}
