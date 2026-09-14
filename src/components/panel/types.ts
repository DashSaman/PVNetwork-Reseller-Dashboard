export type Session = { role: "ADMIN" | "RESELLER"; username: string; uid: string };

export type InboundInfo = {
  inboundId: number;
  panelId: string;
  panelName: string;
  tag: string;
  remark: string;
  protocol: string;
  port: number;
  clientsCount?: number;
  unavailable?: boolean;
};

export type InboundRefForm = { panelId: string; inboundId: number };

export type ResellerInfo = {
  id: string;
  username: string;
  name: string | null;
  active: boolean;
  multiLocation: boolean;
  trafficPoolGB: number;
  allocatedGB: number;
  allowIpLimit: boolean;
  allowWhitelabel: boolean;
  brandName: string | null;
  customDomain: string | null;
  domainVerified: boolean;
  inbounds: { panelId: string; inboundId: number; inboundTag: string; protocol: string; port: number; remark: string | null }[];
  usersCount: number;
  createdAt: string;
};

export type ResellerUserRow = {
  email: string;
  name: string | null;
  inboundTags: string[];
  protocol: string;
  totalGB: number;
  usedGB: number;
  expiryTime: number;
  enable: boolean;
  subId: string | null;
  subLink: string | null;
  trafficGB: number;
  createdAt?: string;
};

export type ResellerPermissions = {
  multiLocation: boolean;
  allowIpLimit: boolean;
  trafficPoolGB: number;
  allocatedGB: number;
  remainingGB: number;
};

export type PanelInfo = {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  hasPassword: boolean;
  hasApiToken?: boolean;
  subBase: string;
  subPath: string;
  active: boolean;
  sortOrder: number;
  inboundsAssigned: number;
  updatedAt: string;
};

export type ActivityLogRow = {
  id: string;
  actorType: string;
  actorName: string;
  action: string;
  detail: string | null;
  createdAt: string;
};

/** سازگاری با کد قدیمی */
export type PanelConfigData = PanelInfo;
