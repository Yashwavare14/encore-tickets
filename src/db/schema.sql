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
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR', -- ISO 4217
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

-- Production Index: Accelerated active hold calculation
CREATE INDEX IF NOT EXISTS idx_holds_active_inventory 
ON holds(tier_id, quantity) 
WHERE status = 'active';

-- Index for expiration queries
CREATE INDEX IF NOT EXISTS idx_holds_expires_at 
ON holds(expires_at) 
WHERE status = 'active';

-- 4. Orders Table
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(64) PRIMARY KEY, -- Source of truth: Processor's order_id (e.g., ord_xxxxx)
    tier_id VARCHAR(64) REFERENCES tiers(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    amount_total INTEGER NOT NULL DEFAULT 0 CHECK (amount_total >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    status VARCHAR(30) NOT NULL CHECK (status IN ('paid', 'refunded', 'partially_refunded', 'refund_pending')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Production Index: Accelerated paid orders aggregation
CREATE INDEX IF NOT EXISTS idx_orders_paid_inventory 
ON orders(tier_id, quantity) 
WHERE status = 'paid';

-- 5. Webhook Events Table (Idempotency Store)
CREATE TABLE IF NOT EXISTS webhook_events (
    id VARCHAR(64) PRIMARY KEY, -- Processor's event_id (e.g., evt_wh_xxxxx)
    event_type VARCHAR(64) NOT NULL,
    order_id VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_order_id ON webhook_events(order_id);

-- 6. Audit Log Table (Observability)
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    order_id VARCHAR(64),
    action VARCHAR(64) NOT NULL,
    details JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
