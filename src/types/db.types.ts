export interface EventRow {
  id: string;
  title: string;
  venue: string;
  starts_at: Date;
  created_at: Date;
}

export interface TierRow {
  id: string;
  event_id: string;
  name: string;
  price: number;
  currency: string;
  total_inventory: number;
  created_at: Date;
}

export type HoldStatus = 'active' | 'expired' | 'converted';

export interface HoldRow {
  id: string;
  tier_id: string;
  quantity: number;
  expires_at: Date;
  status: HoldStatus;
  created_at: Date;
  updated_at: Date;
}

export type OrderStatus =
  | 'paid'
  | 'refunded'
  | 'partially_refunded'
  | 'refund_pending';

export interface OrderRow {
  id: string;
  tier_id: string | null;
  quantity: number;
  amount_total: number;
  currency: string;
  status: OrderStatus;
  created_at: Date;
  updated_at: Date;
}

export interface WebhookEventRow {
  id: string;
  event_type: string;
  order_id: string;
  payload: Record<string, unknown>;
  processed_at: Date;
}

export interface AuditLogRow {
  id: number;
  order_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: Date;
}
