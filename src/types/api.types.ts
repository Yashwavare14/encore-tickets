import { z } from 'zod';

// ==========================================
// 1. Event & Tier Query Types
// ==========================================

export interface TierDetail {
  id: string;
  name: string;
  price: number;
  currency: string;
  total_inventory: number;
  available_inventory: number;
}

export interface EventResponse {
  id: string;
  title: string;
  venue: string;
  starts_at: string;
  tiers: TierDetail[];
}

// ==========================================
// 2. Hold Request & Response Types
// ==========================================

export const CreateHoldSchema = z.object({
  tier_id: z.string().min(1, 'tier_id is required'),
  quantity: z.number().int().positive('quantity must be a positive integer'),
});

export type CreateHoldRequest = z.infer<typeof CreateHoldSchema>;

export interface CreateHoldResponse {
  hold_id: string;
  tier_id: string;
  quantity: number;
  expires_at: string;
}

// ==========================================
// 3. Cancel Hold Response
// ==========================================

export interface CancelHoldResponse {
  success: boolean;
  hold_id: string;
  status: string;
  message: string;
}

// ==========================================
// 4. Webhook Event Types & Schemas
// ==========================================

export const OrderPaidPayloadSchema = z.object({
  event_id: z.string().min(1),
  type: z.literal('order.paid'),
  order_id: z.string().min(1),
  tier_id: z.string().min(1),
  quantity: z.number().int().positive(),
  amount_total: z.number().int().nonnegative(),
  currency: z.string().length(3).default('EUR'),
  occurred_at: z.string(),
});

export type OrderPaidPayload = z.infer<typeof OrderPaidPayloadSchema>;

export const OrderRefundedPayloadSchema = z.object({
  event_id: z.string().min(1),
  type: z.literal('order.refunded'),
  order_id: z.string().min(1),
  amount_refunded: z.number().int().nonnegative(),
  currency: z.string().length(3).default('EUR'),
  occurred_at: z.string(),
});

export type OrderRefundedPayload = z.infer<typeof OrderRefundedPayloadSchema>;

export const WebhookPayloadSchema = z.discriminatedUnion('type', [
  OrderPaidPayloadSchema,
  OrderRefundedPayloadSchema,
]);

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

export interface WebhookResponse {
  success: boolean;
  event_id: string;
  status: 'processed' | 'already_processed';
  message?: string;
}
