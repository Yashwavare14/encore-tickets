import { describe, it, expect, beforeEach } from 'vitest';
import sql from '../src/db/client';
import { seedDatabase } from '../src/db/seed';
import { InventoryService } from '../src/services/inventory.service';
import { HoldsService } from '../src/services/holds.service';
import { WebhookService } from '../src/services/webhook.service';

describe('Webhook Processing, Idempotency & Out-of-Order Handling', () => {
  beforeEach(async () => {
    await seedDatabase({ resetAll: true });
  });

  it('safely handles duplicate webhooks without double deduction', async () => {
    await HoldsService.createHold('tier_001_a', 2);

    const payload = {
      event_id: 'evt_wh_idemp_test',
      type: 'order.paid' as const,
      order_id: 'ord_idemp_001',
      tier_id: 'tier_001_a',
      quantity: 2,
      amount_total: 17000,
      currency: 'EUR',
      occurred_at: new Date().toISOString(),
    };

    // First attempt: processed
    const res1 = await WebhookService.processWebhook(payload);
    expect(res1.status).toBe('processed');

    const invAfterFirst = (await InventoryService.getEventWithInventory('evt_001'))
      .tiers.find((t) => t.id === 'tier_001_a')!.available_inventory;

    // Second attempt with same event_id: duplicate acknowledged
    const res2 = await WebhookService.processWebhook(payload);
    expect(res2.status).toBe('already_processed');

    const invAfterSecond = (await InventoryService.getEventWithInventory('evt_001'))
      .tiers.find((t) => t.id === 'tier_001_a')!.available_inventory;

    expect(invAfterSecond).toBe(invAfterFirst);
  });

  it('correctly handles out-of-order refund arriving before payment', async () => {
    const invInitial = (await InventoryService.getEventWithInventory('evt_001'))
      .tiers.find((t) => t.id === 'tier_001_b')!.available_inventory;

    // 1. Refund arrives first
    const refundRes = await WebhookService.processWebhook({
      event_id: 'evt_wh_ooo_refund',
      type: 'order.refunded',
      order_id: 'ord_ooo_999',
      amount_refunded: 4500,
      currency: 'EUR',
      occurred_at: new Date().toISOString(),
    });
    expect(refundRes.status).toBe('processed');

    // 2. Delayed payment arrives later
    const paidRes = await WebhookService.processWebhook({
      event_id: 'evt_wh_ooo_paid',
      type: 'order.paid',
      order_id: 'ord_ooo_999',
      tier_id: 'tier_001_b',
      quantity: 1,
      amount_total: 4500,
      currency: 'EUR',
      occurred_at: new Date().toISOString(),
    });
    expect(paidRes.status).toBe('processed');

    // Final order status in DB should be refunded
    const [order] = await sql`SELECT status FROM orders WHERE id = 'ord_ooo_999'`;
    expect(order.status).toBe('refunded');

    const invFinal = (await InventoryService.getEventWithInventory('evt_001'))
      .tiers.find((t) => t.id === 'tier_001_b')!.available_inventory;
    expect(invFinal).toBe(invInitial);
  });
});
