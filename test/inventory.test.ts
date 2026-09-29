import { describe, it, expect, beforeEach } from 'vitest';
import { seedDatabase } from '../src/db/seed';
import { InventoryService } from '../src/services/inventory.service';
import { HoldsService } from '../src/services/holds.service';
import { WebhookService } from '../src/services/webhook.service';

describe('Inventory Calculation & Lifecycle', () => {
  beforeEach(async () => {
    await seedDatabase({ resetAll: true });
  });

  it('correctly reports initial available inventory matching total inventory', async () => {
    const event = await InventoryService.getEventWithInventory('evt_001');
    expect(event.tiers).toHaveLength(3);

    const stalls = event.tiers.find((t) => t.id === 'tier_001_a');
    expect(stalls?.total_inventory).toBe(50);
    expect(stalls?.available_inventory).toBe(50);
  });

  it('reduces available inventory during active hold and restores on cancel', async () => {
    const hold = await HoldsService.createHold('tier_001_a', 2);
    expect(hold.quantity).toBe(2);

    const event = await InventoryService.getEventWithInventory('evt_001');
    const stalls = event.tiers.find((t) => t.id === 'tier_001_a');
    expect(stalls?.available_inventory).toBe(48);

    // Clean up
    await HoldsService.cancelOrExpireHold(hold.hold_id);
    const eventRestored = await InventoryService.getEventWithInventory('evt_001');
    const stallsRestored = eventRestored.tiers.find((t) => t.id === 'tier_001_a');
    expect(stallsRestored?.available_inventory).toBe(50);
  });

  it('permanently deducts inventory after order.paid webhook', async () => {
    await HoldsService.createHold('tier_001_a', 3);

    await WebhookService.processWebhook({
      event_id: 'evt_test_paid_1',
      type: 'order.paid',
      order_id: 'ord_test_001',
      tier_id: 'tier_001_a',
      quantity: 3,
      amount_total: 25500,
      currency: 'EUR',
      occurred_at: new Date().toISOString(),
    });

    const event = await InventoryService.getEventWithInventory('evt_001');
    const stalls = event.tiers.find((t) => t.id === 'tier_001_a');
    expect(stalls?.available_inventory).toBe(47);
  });
});
