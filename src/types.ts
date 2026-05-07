export interface CsvItem {
  status: string;
  itemId: string;
  itemName: string;
  isMissing: boolean; // boolean from "Em Falta"
  quantityTotal: number; // "Qtd. Total"
  quantityPending: number; // "Qtd Pend"
}

export interface ShortageReport {
  id?: string;
  itemId: string;
  itemName: string;
  reportedQuantity: number;
  reportedAt: Date | string; // Firebase Timestamp or ISO
  userId: string;
  status: 'pending' | 'resolved';
  notes?: string;
  actionTaken?: string;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
  };
}
