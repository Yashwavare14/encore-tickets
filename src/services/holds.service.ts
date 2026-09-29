import { nanoid } from 'nanoid';
import sql from '../db/client';
import { InventoryService } from './inventory.service';
import { CreateHoldResponse, CancelHoldResponse } from '../types/api.types';
import { NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

export class HoldsService {
  /**
   * Reserves tickets under a 10-minute hold.
   * Atomically locks the tier row to prevent overselling under high concurrency.
   */
  static async createHold(
    tierId: string,
    quantity: number
  ): Promise<CreateHoldResponse> {
    return await sql.begin(async (tx) => {
      // 1. Lock tier and verify availability
      await InventoryService.lockAndVerifyAvailability(tierId, quantity, tx);

      // 2. Generate collision-resistant hold ID
      const holdId = `hld_${nanoid(12)}`;

      // 3. Insert hold with 10-minute TTL
      const [hold] = await tx`
        INSERT INTO holds (id, tier_id, quantity, expires_at, status)
        VALUES (${holdId}, ${tierId}, ${quantity}, NOW() + INTERVAL '10 minutes', 'active')
        RETURNING id, tier_id, quantity, expires_at;
      `;

      logger.info('Hold created successfully', {
        holdId: hold.id,
        tierId: hold.tier_id,
        quantity: hold.quantity,
        expiresAt: hold.expires_at,
      });

      return {
        hold_id: hold.id,
        tier_id: hold.tier_id,
        quantity: Number(hold.quantity),
        expires_at: new Date(hold.expires_at).toISOString(),
      };
    });
  }

  /**
   * Convenience method to cancel or manually expire an active hold.
   * Accepts hold ID or order ID.
   */
  static async cancelOrExpireHold(identifier: string): Promise<CancelHoldResponse> {
    const updated = await sql`
      UPDATE holds
      SET status = 'expired', updated_at = NOW()
      WHERE id = ${identifier} AND status = 'active'
      RETURNING id;
    `;

    if (updated.length === 0) {
      // Check if it exists at all
      const existing = await sql`
        SELECT id, status FROM holds WHERE id = ${identifier} LIMIT 1;
      `;

      if (existing.length === 0) {
        throw new NotFoundError('Hold', identifier);
      }

      return {
        success: true,
        hold_id: existing[0].id,
        status: existing[0].status,
        message: `Hold was already ${existing[0].status}.`,
      };
    }

    logger.info('Hold manually cancelled/expired', { holdId: identifier });

    return {
      success: true,
      hold_id: identifier,
      status: 'expired',
      message: 'Hold has been manually expired.',
    };
  }

  /**
   * Sweeper query to update all overdue active holds to expired.
   */
  static async expireOverdueHolds(): Promise<number> {
    const result = await sql`
      UPDATE holds
      SET status = 'expired', updated_at = NOW()
      WHERE status = 'active' AND expires_at <= NOW()
      RETURNING id;
    `;

    if (result.length > 0) {
      logger.info('Expired overdue holds', { count: result.length });
    }

    return result.length;
  }
}
