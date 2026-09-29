# Encore Tickets Inventory & Concurrency API

Production-grade real-time ticketing inventory engine built with **TypeScript (Strict)**, **Next.js Route Handlers**, and **Neon Serverless PostgreSQL**.

Designed to handle high-stakes ticketing demand under concurrent conditions with mathematical precision:
- **Zero Overselling**: Row-level pessimistic locking (`SELECT ... FOR UPDATE`) serializes hold attempts for contested tiers without blocking unrelated events.
- **Webhook Idempotency**: Atomic deduplication via PostgreSQL constraints (`ON CONFLICT (id) DO NOTHING`) prevents duplicate payment deductions.
- **Out-of-Order Delivery Reconciliation**: Handles network anomalies where `order.refunded` arrives prior to `order.paid`.
- **Zero-Window Hold Expiration**: Real-time on-read availability math ensures expired holds release inventory instantly without waiting for background cron workers.
- **Interactive Workbench**: Visual dashboard on `/` to test live inventory, create holds, trigger webhooks, and launch 10-bid concurrency stress tests.

---

## Architecture & Technology Stack

| Component | Technology | Rationale |
| :--- | :--- | :--- |
| **Runtime & Framework** | Next.js 16 (App Router) + TypeScript | Modern HTTP route handlers, standard Web API `Request`/`Response`, zero cold-start latency. |
| **Database Engine** | Neon Serverless PostgreSQL | ACID compliance, instant branching, connection pooling, and sub-millisecond query execution. |
| **SQL Client** | `postgres` (Postgres.js) | High-performance direct SQL client enabling explicit multi-statement transactions and row locks without ORM abstraction overhead. |
| **Validation** | `zod` | Runtime schema validation and static TypeScript type inference for request bodies and webhooks. |
| **Testing** | `vitest` + `tsx` | Fast integration tests and standalone script runners for concurrency hammering and scenario demonstrations. |

---

## Mathematical Invariant for Available Inventory

At any point in time $t$, available inventory for tier $T$ is deterministically calculated as:

$$\text{Available Inventory}(T) = \text{Total Inventory}(T) - \text{Active Holds}(T) - \text{Paid Orders}(T)$$

Where:
* $\text{Total Inventory}(T) = \text{tiers.total\_inventory}$
* $\text{Active Holds}(T) = \sum \text{quantity WHERE tier\_id} = T \land \text{status} = \text{'active'} \land \text{expires\_at} > \text{NOW()}$
* $\text{Paid Orders}(T) = \sum \text{quantity WHERE tier\_id} = T \land \text{status} = \text{'paid'}$

*(Note: Holds with `status = 'expired'` or `expires_at <= NOW()` are excluded. Holds transition to `status = 'converted'` upon payment confirmation so they are not double-counted with paid orders).*

---

## Database Schema & Indexes

```sql
-- 1. Events Table
CREATE TABLE IF NOT EXISTS events (
    id VARCHAR(64) PRIMARY KEY,
    title TEXT NOT NULL,
    venue TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Tiers Table
CREATE TABLE IF NOT EXISTS tiers (
    id VARCHAR(64) PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0), -- Minor units (cents)
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    total_inventory INTEGER NOT NULL CHECK (total_inventory >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tiers_event_id ON tiers(event_id);

-- 3. Holds Table
CREATE TABLE IF NOT EXISTS holds (
    id VARCHAR(64) PRIMARY KEY,
    tier_id VARCHAR(64) NOT NULL REFERENCES tiers(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    expires_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'expired', 'converted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_holds_active_inventory ON holds(tier_id, quantity) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_holds_expires_at ON holds(expires_at) WHERE status = 'active';

-- 4. Orders Table
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(64) PRIMARY KEY, -- Processor's order_id (e.g., ord_xxxxx)
    tier_id VARCHAR(64) REFERENCES tiers(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    amount_total INTEGER NOT NULL DEFAULT 0 CHECK (amount_total >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    status VARCHAR(30) NOT NULL CHECK (status IN ('paid', 'refunded', 'partially_refunded', 'refund_pending')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_paid_inventory ON orders(tier_id, quantity) WHERE status = 'paid';

-- 5. Webhook Events Table (Idempotency Store)
CREATE TABLE IF NOT EXISTS webhook_events (
    id VARCHAR(64) PRIMARY KEY, -- Processor's event_id
    event_type VARCHAR(64) NOT NULL,
    order_id VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_order_id ON webhook_events(order_id);
```

---

## Concurrency & Locking Strategy

### Why Pessimistic Row Locking (`SELECT ... FOR UPDATE`)?
Under high concurrency (e.g. 100 buyers racing for the last 2 tickets), standard read-modify-write queries suffer from race conditions. 

In our solution:
1. `BEGIN;`
2. `SELECT total_inventory FROM tiers WHERE id = $1 FOR UPDATE;`
   - Exclusively locks **only the row for that specific tier**.
   - Other tiers and events remain completely unblocked and run concurrently.
3. Computes active unexpired holds and paid orders within the lock boundary.
4. If $\text{remaining} < \text{requested}$, transaction is aborted with `ROLLBACK` and returns HTTP `409 Conflict` with error code `OVERSOLD`.
5. If $\text{remaining} \ge \text{requested}$, inserts hold with 10-minute TTL and commits (`COMMIT`).

---

## Out-of-Order Webhook Reconciliation

Network jitter can cause `order.refunded` to arrive at the API **before** `order.paid`.

```
                    ┌─────────────────────────┐
                    │ Incoming Webhook Event  │
                    └───────────┬─────────────┘
                                │
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
       [Type: order.refunded]         [Type: order.paid]
                 │                             │
    Does order exist in DB?         Does order exist with
          /            \            status = 'refund_pending'?
       YES              NO                    /          \
        │                │                  YES           NO
        ▼                ▼                   │             │
  UPDATE orders    INSERT placeholder        ▼             ▼
  SET status =     status = 'refund_pending' UPDATE orders  INSERT order
  'refunded'       Awaiting order.paid       SET status =   SET status =
  (Restores                                  'refunded'     'paid'
   inventory)                                (Release hold, (Convert hold,
                                              zero deduct)   deduct inv)
```

---

## Getting Started

### 1. Prerequisites
- Node.js v20+
- A Neon PostgreSQL project (or local Postgres instance)

### 2. Configure Environment
Set `DATABASE_URL` in `.env.local`:
```env
DATABASE_URL="postgresql://[user]:[password]@[endpoint].neon.tech/neondb?sslmode=require"
```

### 3. Run Migrations & Seed Mock Data
```bash
# Execute schema DDL & indexes
npm run migrate

# Seed events (evt_001 Lisbon, evt_002 Berlin) and tiers
npm run seed
```

### 4. Run the Full Test Suite (Vitest)
```bash
npm test
```

### 5. Run the Concurrency Hammer (10 Bids for 1 Seat)
```bash
npm run test:concurrency
```

### 6. Run the 30-Second Scenario Demo Script
Runs Scenarios A, B, C, D and TTL release with colored terminal output:
```bash
npm run demo
```

### 7. Start the Web App & Interactive Dashboard
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the live dashboard.

---

## REST API Reference

### 1. `GET /events/:event_id`
Returns event details, tiers, and real-time inventory counts.
```bash
curl -X GET http://localhost:3000/events/evt_001
```

### 2. `POST /events/:event_id/holds`
Creates a 10-minute reservation hold.
```bash
curl -X POST http://localhost:3000/events/evt_001/holds \
  -H "Content-Type: application/json" \
  -d '{"tier_id": "tier_001_a", "quantity": 2}'
```
* **Success (201 Created):**
```json
{
  "hold_id": "hld_ODdOwFjR7FJq",
  "tier_id": "tier_001_a",
  "quantity": 2,
  "expires_at": "2026-09-29T17:30:04.121Z"
}
```
* **Oversold (409 Conflict):**
```json
{
  "error": {
    "code": "OVERSOLD",
    "message": "Only 0 ticket(s) remaining for tier tier_001_a, requested 2.",
    "details": {
      "requested": 2,
      "available": 0,
      "tier_id": "tier_001_a"
    }
  }
}
```

### 3. `POST /orders/:order_id/cancel-hold`
Manually cancels/expires a hold without waiting for the 10-minute TTL.
```bash
curl -X POST http://localhost:3000/orders/hld_ODdOwFjR7FJq/cancel-hold
```

### 4. `POST /webhooks/payments`
Payment processor webhook endpoint.
```bash
# Order Paid
curl -X POST http://localhost:3000/webhooks/payments \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "evt_wh_001",
    "type": "order.paid",
    "order_id": "ord_9901",
    "tier_id": "tier_001_a",
    "quantity": 2,
    "amount_total": 17000,
    "currency": "EUR",
    "occurred_at": "2026-06-25T11:32:14Z"
  }'

# Duplicate Retry (Returns 200 already_processed without double deduction)
curl -X POST http://localhost:3000/webhooks/payments \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "evt_wh_001",
    "type": "order.paid",
    "order_id": "ord_9901",
    "tier_id": "tier_001_a",
    "quantity": 2,
    "amount_total": 17000,
    "currency": "EUR",
    "occurred_at": "2026-06-25T11:32:14Z"
  }'

# Order Refunded
curl -X POST http://localhost:3000/webhooks/payments \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "evt_wh_002",
    "type": "order.refunded",
    "order_id": "ord_9901",
    "amount_refunded": 17000,
    "currency": "EUR",
    "occurred_at": "2026-06-25T14:08:51Z"
  }'
```
