export type SavedResellerPlan = {
  id: string;
  name: string;
  trafficGB: number;
  days: number;
  expiryMode: 'first-use' | 'from-now';
  ipLimit: number;
  refs: { panelId: string; inboundId: number }[];
};
