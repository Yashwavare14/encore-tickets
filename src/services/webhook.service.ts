import sql from '../db/client';
import {
  WebhookPayload,
  WebhookResponse,
  OrderPaidPayload,
  OrderRefundedPayload,
} from '../types/api.types';
import { logger } from '../utils/logger';

export class WebhookService {
  /**
   * Processes incoming payment and refund webhooks with strict idempotency and out-of-order reconciliation.
   */
  static async processWebhook(payload: WebhookPayload): Promise<WebhookResponse> {
    return await sql.begin(async (tx) => {
      // 1. Webhook Idempotency Store Guard (INSERT ON CONFLICT DO NOTHING)
      const recorded = await tx`
        INSERT INTO webhook_events (id, event_type, order_id, payload, processed_at)
        VALUES (
          ${payload.event_id},
          ${payload.type},
          ${payload.order_id},
          ${sql.json(payload as any)},
          NOW()
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id;
      `;

      if (recorded.length === 0) {
        logger.info('Duplicate webhook detected and ignored', {
          eventId: payload.event_id,
          type: payload.type,
          orderId: payload.order_id,
        });

        return {
          success: true,
          event_id: payload.event_id,
          status: 'already_processed',
          message: 'Duplicate webhook received and safely acknowledged.',
        };
      }

      // 2. Dispatch event processing based on event type
      if (payload.type === 'order.paid') {
        await this.handleOrderPaid(payload, tx);
      } else if (payload.type === 'order.refunded') {
        await this.handleOrderRefunded(payload, tx);
      }

      return {
        success: true,
        event_id: payload.event_id,
        status: 'processed',
      };
    });
  }

  private static async handleOrderPaid(
    payload: OrderPaidPayload,
    tx: any
  ): Promise<void> {
    // Check if an order placeholder already exists (e.g. out-of-order early refund)
    const existingOrders = await tx`
      SELECT id, status 
      FROM orders 
      WHERE id = ${payload.order_id} 
      FOR UPDATE;
    `;

    if (existingOrders.length > 0) {
      const order = existingOrders[0];
      if (order.status === 'refund_pending') {
        // Out-of-order reconciliation: Refund arrived BEFORE payment
        logger.info('Reconciling out-of-order paid event after early refund', {
          orderId: payload.order_id,
        });

        await tx`
          UPDATE orders
          SET tier_id = ${payload.tier_id},
              quantity = ${payload.quantity},
              amount_total = ${payload.amount_total},
              currency = ${payload.currency},
              status = 'refunded',
              updated_at = NOW()
          WHERE id = ${payload.order_id};
        `;

        // Mark any matching active hold as converted/released so it doesn't hold inventory
        await tx`
          UPDATE holds
          SET status = 'converted', updated_at = NOW()
          WHERE id = (
            SELECT id FROM holds
            WHERE tier_id = ${payload.tier_id} AND status = 'active'
            ORDER BY created_at ASC
            LIMIT 1
          );
        `;

        await tx`
          INSERT INTO audit_logs (order_id, action, details)
          VALUES (
            ${payload.order_id},
            'order_reconciled_after_early_refund',
            ${sql.json({ payload })}
          );
        `;
        return;
      }
    }

    // Standard flow: create paid order
    await tx`
      INSERT INTO orders (id, tier_id, quantity, amount_total, currency, status)
      VALUES (
        ${payload.order_id},
        ${payload.tier_id},
        ${payload.quantity},
        ${payload.amount_total},
        ${payload.currency},
        'paid'
      )
      ON CONFLICT (id) DO UPDATE SET
        tier_id = EXCLUDED.tier_id,
        quantity = EXCLUDED.quantity,
        amount_total = EXCLUDED.amount_total,
        currency = EXCLUDED.currency,
        status = 'paid',
        updated_at = NOW();
    `;

    // Convert matching active hold so it is not double-counted in inventory deduction
    await tx`
      UPDATE holds
      SET status = 'converted', updated_at = NOW()
      WHERE id = (
        SELECT id FROM holds
        WHERE tier_id = ${payload.tier_id} AND status = 'active'
        ORDER BY created_at ASC
        LIMIT 1
      );
    `;

    await tx`
      INSERT INTO audit_logs (order_id, action, details)
      VALUES (
        ${payload.order_id},
        'order_paid',
        ${sql.json({ payload })}
      );
    `;

    logger.info('Order marked as paid and inventory finalized', {
      orderId: payload.order_id,
      tierId: payload.tier_id,
      quantity: payload.quantity,
    });
  }

  private static async handleOrderRefunded(
    payload: OrderRefundedPayload,
    tx: any
  ): Promise<void> {
    const existingOrders = await tx`
      SELECT id, status 
      FROM orders 
      WHERE id = ${payload.order_id} 
      FOR UPDATE;
    `;

    if (existingOrders.length === 0) {
      // Out-of-order delivery: Refund arrived BEFORE order.paid
      logger.info('Early refund arrived before order.paid - recording refund_pending', {
        orderId: payload.order_id,
      });

      await tx`
        INSERT INTO orders (id, tier_id, quantity, amount_total, currency, status)
        VALUES (
          ${payload.order_id},
          NULL,
          0,
          ${payload.amount_refunded},
          ${payload.currency},
          'refund_pending'
        );
      `;

      await tx`
        INSERT INTO audit_logs (order_id, action, details)
        VALUES (
          ${payload.order_id},
          'early_refund_pending_payment',
          ${sql.json({ payload })}
        );
      `;
      return;
    }

    // Standard flow: update order status to refunded
    await tx`
      UPDATE orders
      SET status = 'refunded', updated_at = NOW()
      WHERE id = ${payload.order_id};
    `;

    await tx`
      INSERT INTO audit_logs (order_id, action, details)
      VALUES (
        ${payload.order_id},
        'order_refunded',
        ${sql.json({ payload })}
      );
    `;

    logger.info('Order marked as refunded and inventory restored', {
      orderId: payload.order_id,
    });
  }
}
