import sql from '../db/client';
import postgres from 'postgres';
import { EventResponse, TierDetail } from '../types/api.types';
import { NotFoundError, OversoldError } from '../utils/errors';

export class InventoryService {
  /**
   * Retrieves an event by ID along with real-time calculated available inventory for each tier.
   * Invariant: Available = Total - Active Holds - Paid Orders
   */
  static async getEventWithInventory(eventId: string): Promise<EventResponse> {
    const events = await sql`
      SELECT id, title, venue, starts_at, created_at
      FROM events
      WHERE id = ${eventId}
      LIMIT 1;
    `;

    if (events.length === 0) {
      throw new NotFoundError('Event', eventId);
    }

    const event = events[0];

    // Compute tier inventories in a single efficient SQL query
    const tiers = await sql<TierDetail[]>`
      SELECT 
        t.id,
        t.name,
        t.price,
        t.currency,
        t.total_inventory,
        GREATEST(0, (
          t.total_inventory 
          - COALESCE((
              SELECT SUM(h.quantity) 
              FROM holds h 
              WHERE h.tier_id = t.id 
                AND h.status = 'active' 
                AND h.expires_at > NOW()
            ), 0)
          - COALESCE((
              SELECT SUM(o.quantity) 
              FROM orders o 
              WHERE o.tier_id = t.id 
                AND o.status = 'paid'
            ), 0)
        ))::integer AS available_inventory
      FROM tiers t
      WHERE t.event_id = ${eventId}
      ORDER BY t.created_at ASC;
    `;

    return {
      id: event.id,
      title: event.title,
      venue: event.venue,
      starts_at: new Date(event.starts_at).toISOString(),
      tiers: tiers.map((t) => ({
        id: t.id,
        name: t.name,
        price: t.price,
        currency: t.currency,
        total_inventory: Number(t.total_inventory),
        available_inventory: Number(t.available_inventory),
      })),
    };
  }

  /**
   * Acquires an exclusive row lock on the tier row and validates that requested quantity is available.
   * Throws OversoldError if remaining < requested.
   */
  static async lockAndVerifyAvailability(
    tierId: string,
    requestedQuantity: number,
    tx: postgres.TransactionSql
  ): Promise<{ available: number; totalInventory: number }> {
    // 1. Pessimistic Row Lock on Tier (serializes hold attempts for this tier only)
    const tierRows = await tx`
      SELECT id, total_inventory 
      FROM tiers 
      WHERE id = ${tierId} 
      FOR UPDATE;
    `;

    if (tierRows.length === 0) {
      throw new NotFoundError('Tier', tierId);
    }

    const totalInventory = Number(tierRows[0].total_inventory);

    // 2. Sum active holds for this tier (status = 'active' and unexpired)
    const activeHoldResult = await tx`
      SELECT COALESCE(SUM(quantity), 0)::integer AS active_holds
      FROM holds
      WHERE tier_id = ${tierId}
        AND status = 'active'
        AND expires_at > NOW();
    `;
    const activeHolds = Number(activeHoldResult[0].active_holds);

    // 3. Sum paid orders for this tier
    const paidOrdersResult = await tx`
      SELECT COALESCE(SUM(quantity), 0)::integer AS paid_orders
      FROM orders
      WHERE tier_id = ${tierId}
        AND status = 'paid';
    `;
    const paidOrders = Number(paidOrdersResult[0].paid_orders);

    const available = totalInventory - activeHolds - paidOrders;

    if (available < requestedQuantity) {
      throw new OversoldError(requestedQuantity, Math.max(0, available), tierId);
    }

    return { available, totalInventory };
  }
}
