export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeInboundGrantRecovery } = await import('./lib/inbound-revocation');
    initializeInboundGrantRecovery();
  }
}
