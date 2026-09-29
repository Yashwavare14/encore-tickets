import { describe, it, expect, beforeEach } from 'vitest';
import sql from '../src/db/client';
import { seedDatabase } from '../src/db/seed';
import { HoldsService } from '../src/services/holds.service';
import { InventoryService } from '../src/services/inventory.service';

describe('Concurrency Control Under High Contention', () => {
  beforeEach(async () => {
    await seedDatabase({ resetAll: true });
    // Set tier_002_b total inventory to exactly 1
    await sql`UPDATE tiers SET total_inventory = 1 WHERE id = 'tier_002_b'`;
  });

  it('guarantees exactly 1 successful reservation for a single remaining ticket', async () => {
    const tierId = 'tier_002_b';

    const requests = Array.from({ length: 6 }, () =>
      HoldsService.createHold(tierId, 1)
        .then((res) => ({ success: true, res }))
        .catch((err) => ({ success: false, err }))
    );

    const outcomes = await Promise.all(requests);
    const successes = outcomes.filter((o) => o.success);
    const failures = outcomes.filter((o) => !o.success);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(5);

    const event = await InventoryService.getEventWithInventory('evt_002');
    const tier = event.tiers.find((t) => t.id === tierId);
    expect(tier?.available_inventory).toBe(0);
  });
});
