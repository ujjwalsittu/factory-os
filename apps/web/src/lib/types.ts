export interface Me {
  user: { id: string; email: string; name: string };
  platformAdmin: 'superadmin' | 'support' | null;
  tenants: { id: string; name: string; slug: string; status: string; isOwner: boolean }[];
  canCreateTenant: boolean;
}

export interface TenantContextData {
  tenantId: string;
  isOwner: boolean;
  allEntities: boolean;
  activeEntityId: string | null;
  entities: { id: string; shortName: string; legalName: string; code: string; parentEntityId: string | null }[];
  permissions: string[];
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  stateCode: string;
  pincode: string;
}

export interface GstRegistration {
  id: string;
  gstin: string;
  stateCode: string;
  type: string;
  tradeName: string | null;
  einvoiceApplicableFrom: string | null;
  irpProvider: string;
  ewbProvider: string;
  returnsProvider: string;
}

export interface Plant {
  id: string;
  name: string;
  code: string;
}

export interface LegalEntity {
  id: string;
  legalName: string;
  shortName: string;
  code: string;
  pan: string | null;
  cin: string | null;
  parentEntityId: string | null;
  fyStartMonth: number;
  isActive: boolean;
  gstRegistrations: GstRegistration[];
  plants: Plant[];
}

export interface Role {
  id: string;
  systemKey: string | null;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  memberCount: number;
}

export interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  twoFactorEnabled: boolean | null;
  status: 'active' | 'disabled';
  isOwner: boolean;
  roles: { roleId: string; roleName: string; entityIds: string[] | null }[];
}

export interface Invitation {
  id: string;
  email: string;
  status: string;
  roles: { roleId: string; entityIds: string[] | null }[];
  expiresAt: string;
}

export interface AuditEvent {
  seq: number;
  occurredAt: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  hash: string;
  prevHash: string | null;
}

export interface ResourceDef {
  module: string;
  resource: string;
  label: string;
  actions: string[];
}
