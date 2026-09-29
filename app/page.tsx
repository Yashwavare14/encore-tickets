'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface Tier {
  id: string;
  name: string;
  price: number;
  currency: string;
  total_inventory: number;
  available_inventory: number;
}

interface EventData {
  id: string;
  title: string;
  venue: string;
  starts_at: string;
  tiers: Tier[];
}

interface LogEntry {
  id: string;
  time: string;
  type: 'info' | 'success' | 'warn' | 'error';
  title: string;
  details?: any;
}

export default function Home() {
  const [events, setEvents] = useState<EventData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Form states
  const [selectedTier, setSelectedTier] = useState<string>('tier_001_a');
  const [selectedEventId, setSelectedEventId] = useState<string>('evt_001');
  const [quantity, setQuantity] = useState<number>(1);
  const [cancelIdInput, setCancelIdInput] = useState<string>('');
  const [webhookOrderId, setWebhookOrderId] = useState<string>('ord_1001');
  const [webhookEventId, setWebhookEventId] = useState<string>('evt_wh_live_01');

  // Stress test states
  const [stressRunning, setStressRunning] = useState<boolean>(false);
  const [stressResults, setStressResults] = useState<{
    total: number;
    winners: number;
    rejected: number;
  } | null>(null);

  const addLog = useCallback(
    (type: LogEntry['type'], title: string, details?: any) => {
      setLogs((prev) => [
        {
          id: Math.random().toString(36).substring(7),
          time: new Date().toLocaleTimeString(),
          type,
          title,
          details,
        },
        ...prev.slice(0, 49),
      ]);
    },
    []
  );

  const fetchEvents = useCallback(async () => {
    try {
      const [res1, res2] = await Promise.all([
        fetch('/events/evt_001'),
        fetch('/events/evt_002'),
      ]);
      const data1 = await res1.json();
      const data2 = await res2.json();
      setEvents([data1, data2].filter((d) => !d.error));
    } catch (err: any) {
      addLog('error', 'Failed to fetch events', err.message);
    } finally {
      setLoading(false);
    }
  }, [addLog]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // 1. Create Hold
  const handleCreateHold = async () => {
    try {
      addLog('info', `Requesting hold: ${quantity} ticket(s) on ${selectedTier}...`);
      const res = await fetch(`/events/${selectedEventId}/holds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier_id: selectedTier, quantity: Number(quantity) }),
      });
      const data = await res.json();
      if (res.ok) {
        addLog('success', `Hold Created! ID: ${data.hold_id}`, data);
        setCancelIdInput(data.hold_id);
      } else {
        addLog('warn', `Hold Rejected: [${data.error?.code}] ${data.error?.message}`, data);
      }
      fetchEvents();
    } catch (err: any) {
      addLog('error', 'Hold creation failed', err.message);
    }
  };

  // 2. Cancel / Expire Hold
  const handleCancelHold = async () => {
    if (!cancelIdInput.trim()) return;
    try {
      addLog('info', `Expiring hold ${cancelIdInput}...`);
      const res = await fetch(`/orders/${cancelIdInput}/cancel-hold`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        addLog('success', `Hold Expired: ${data.hold_id}`, data);
      } else {
        addLog('warn', `Failed to expire hold: ${data.error?.message}`, data);
      }
      fetchEvents();
    } catch (err: any) {
      addLog('error', 'Cancel hold failed', err.message);
    }
  };

  // 3. Send Webhook (Paid)
  const handleSendPaidWebhook = async () => {
    try {
      addLog('info', `Sending order.paid webhook: ${webhookEventId}...`);
      const payload = {
        event_id: webhookEventId,
        type: 'order.paid',
        order_id: webhookOrderId,
        tier_id: selectedTier,
        quantity: Number(quantity),
        amount_total: 8500,
        currency: 'EUR',
        occurred_at: new Date().toISOString(),
      };
      const res = await fetch('/webhooks/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.status === 'already_processed') {
          addLog('warn', `Idempotent duplicate recognized: ${data.event_id}`, data);
        } else {
          addLog('success', `Payment finalized: ${data.event_id}`, data);
        }
      } else {
        addLog('error', `Webhook error: ${data.error?.message}`, data);
      }
      fetchEvents();
    } catch (err: any) {
      addLog('error', 'Webhook failed', err.message);
    }
  };

  // 4. Send Webhook (Refunded)
  const handleSendRefundWebhook = async () => {
    try {
      addLog('info', `Sending order.refunded webhook for ${webhookOrderId}...`);
      const payload = {
        event_id: `evt_wh_ref_${Date.now()}`,
        type: 'order.refunded',
        order_id: webhookOrderId,
        amount_refunded: 8500,
        currency: 'EUR',
        occurred_at: new Date().toISOString(),
      };
      const res = await fetch('/webhooks/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        addLog('success', `Refund processed for ${webhookOrderId}`, data);
      } else {
        addLog('error', `Refund error: ${data.error?.message}`, data);
      }
      fetchEvents();
    } catch (err: any) {
      addLog('error', 'Refund failed', err.message);
    }
  };

  // 5. Concurrency Hammer Test from UI
  const handleRunConcurrencyHammer = async () => {
    setStressRunning(true);
    setStressResults(null);
    addLog('info', '⚡ Launching Concurrency Stress Test: 10 parallel hold attempts for 1 seat...');

    try {
      // Fire 10 parallel requests
      const promises = Array.from({ length: 10 }, (_, i) =>
        fetch('/events/evt_002/holds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tier_id: 'tier_002_b', quantity: 1 }),
        }).then(async (r) => ({
          client: `Buyer #${i + 1}`,
          status: r.status,
          data: await r.json(),
        }))
      );

      const outcomes = await Promise.all(promises);
      const winners = outcomes.filter((o) => o.status === 201);
      const oversold = outcomes.filter((o) => o.status === 409);

      setStressResults({
        total: outcomes.length,
        winners: winners.length,
        rejected: oversold.length,
      });

      addLog(
        winners.length === 1 ? 'success' : 'warn',
        `Concurrency Hammer Finished: ${winners.length} winner, ${oversold.length} rejected (409 OVERSOLD)`,
        { winners, oversold }
      );
      fetchEvents();
    } catch (err: any) {
      addLog('error', 'Stress test failed', err.message);
    } finally {
      setStressRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4 sm:px-8 max-w-7xl mx-auto">
      {/* Header */}
      <header className="mb-10 pb-6 border-b border-slate-800 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-3xl">🎟️</span>
            <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
              Encore Tickets Inventory Engine
            </h1>
          </div>
          <p className="text-slate-400 text-sm mt-1">
            Real-time Inventory • Pessimistic Row Locking • Webhook Idempotency • Out-of-Order Refund Reconciliation
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Neon Postgres Connected
          </span>
          <button
            onClick={fetchEvents}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            ↻ Refresh Data
          </button>
        </div>
      </header>

      {/* Main Grid: Events & Action Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Live Events & Tiers (7 cols) */}
        <section className="lg:col-span-7 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>🎭</span> Live Events & Inventory State
            </h2>
            <span className="text-xs text-slate-400">
              Formula: Available = Total - Active Holds - Paid
            </span>
          </div>

          {loading ? (
            <div className="p-8 rounded-xl bg-slate-900/60 border border-slate-800 text-center text-slate-400">
              Loading inventory from Neon database...
            </div>
          ) : (
            events.map((evt) => (
              <div
                key={evt.id}
                className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl backdrop-blur-sm"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <span className="text-xs font-mono text-indigo-400 uppercase tracking-wider">
                      {evt.id}
                    </span>
                    <h3 className="text-xl font-bold text-white">{evt.title}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      📍 {evt.venue} • 🗓️ {new Date(evt.starts_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  {evt.tiers.map((tier) => {
                    const pct =
                      tier.total_inventory > 0
                        ? Math.round((tier.available_inventory / tier.total_inventory) * 100)
                        : 0;

                    return (
                      <div
                        key={tier.id}
                        className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition"
                      >
                        <div className="flex items-center justify-between text-sm mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-200">{tier.name}</span>
                            <span className="text-xs font-mono text-slate-500">
                              ({tier.id})
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-xs text-slate-400 mr-2">
                              {(tier.price / 100).toFixed(2)} {tier.currency}
                            </span>
                            <span
                              className={`text-sm font-bold font-mono ${
                                tier.available_inventory === 0
                                  ? 'text-rose-400'
                                  : tier.available_inventory < 5
                                  ? 'text-amber-400'
                                  : 'text-emerald-400'
                              }`}
                            >
                              {tier.available_inventory} / {tier.total_inventory} left
                            </span>
                          </div>
                        </div>

                        {/* Inventory Progress Bar */}
                        <div className="w-full bg-slate-800/80 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              pct === 0
                                ? 'bg-rose-500'
                                : pct < 20
                                ? 'bg-amber-500'
                                : 'bg-gradient-to-r from-indigo-500 to-emerald-400'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          {/* Concurrency Hammer Demonstration Box */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-indigo-950/40 via-purple-950/20 to-slate-900 border border-indigo-500/30 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-indigo-300 flex items-center gap-2">
                  <span>⚡</span> Concurrency Hammer Test (Scenario C)
                </h3>
                <p className="text-xs text-slate-400 mt-1 max-w-md">
                  Sends 10 parallel hold requests at the exact same millisecond against{' '}
                  <span className="text-slate-200 font-mono">tier_002_b</span>. Demonstrates pessimistic row lock serializing requests with zero overselling.
                </p>
              </div>
              <button
                onClick={handleRunConcurrencyHammer}
                disabled={stressRunning}
                className="px-5 py-2.5 rounded-xl font-semibold text-xs tracking-wide bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-600/30 disabled:opacity-50 transition"
              >
                {stressRunning ? 'Hammering...' : 'Run Hammer (10 Bids)'}
              </button>
            </div>

            {stressResults && (
              <div className="mt-4 p-3.5 rounded-xl bg-slate-950/80 border border-indigo-500/30 grid grid-cols-3 text-center">
                <div>
                  <div className="text-xs text-slate-400">Total Bids</div>
                  <div className="text-lg font-mono font-bold text-white">
                    {stressResults.total}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Holds Granted</div>
                  <div className="text-lg font-mono font-bold text-emerald-400">
                    {stressResults.winners}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Rejected (409)</div>
                  <div className="text-lg font-mono font-bold text-rose-400">
                    {stressResults.rejected}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right Column: Interactive Testing Workbench & Live Logs (5 cols) */}
        <section className="lg:col-span-5 space-y-6">
          <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-5">
            <h2 className="text-base font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
              <span>🛠️</span> Interactive Control Workbench
            </h2>

            {/* Hold Creation Form */}
            <div className="space-y-3">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">
                1. Create Ticket Hold (10-min TTL)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={selectedTier}
                  onChange={(e) => {
                    setSelectedTier(e.target.value);
                    if (e.target.value.startsWith('tier_001')) setSelectedEventId('evt_001');
                    else setSelectedEventId('evt_002');
                  }}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="tier_001_a">Front Stalls (evt_001)</option>
                  <option value="tier_001_b">General Standing (evt_001)</option>
                  <option value="tier_001_c">Balcony (evt_001)</option>
                  <option value="tier_002_a">Early Bird (evt_002)</option>
                  <option value="tier_002_b">General Adm. (evt_002)</option>
                </select>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    className="w-16 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={handleCreateHold}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold py-2 transition"
                  >
                    Reserve Hold
                  </button>
                </div>
              </div>
            </div>

            {/* Cancel Hold Form */}
            <div className="space-y-3 pt-3 border-t border-slate-800/80">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">
                2. Cancel / Expire Hold
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Hold ID (e.g., hld_...)"
                  value={cancelIdInput}
                  onChange={(e) => setCancelIdInput(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={handleCancelHold}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold px-4 py-2 transition"
                >
                  Expire Now
                </button>
              </div>
            </div>

            {/* Mock Webhook Form */}
            <div className="space-y-3 pt-3 border-t border-slate-800/80">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">
                3. Simulate Payment Webhooks
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Event ID"
                  value={webhookEventId}
                  onChange={(e) => setWebhookEventId(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono"
                />
                <input
                  type="text"
                  placeholder="Order ID"
                  value={webhookOrderId}
                  onChange={(e) => setWebhookOrderId(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleSendPaidWebhook}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold py-2 transition"
                >
                  order.paid (Finalize)
                </button>
                <button
                  onClick={handleSendRefundWebhook}
                  className="bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold py-2 transition"
                >
                  order.refunded
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Tip: Click <code>order.paid</code> twice with the same Event ID to test idempotency, or click <code>order.refunded</code> first to test out-of-order reconciliation.
              </p>
            </div>
          </div>

          {/* Live Execution Logs */}
          <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>📋</span> Real-time Event Feed
              </h2>
              {logs.length > 0 && (
                <button
                  onClick={() => setLogs([])}
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="h-64 overflow-y-auto space-y-2 font-mono text-xs pr-1">
              {logs.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-600 text-center">
                  Perform an action above to see real-time database transactions.
                </div>
              ) : (
                logs.map((log) => (
                  <div
                    key={log.id}
                    className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`font-semibold ${
                          log.type === 'success'
                            ? 'text-emerald-400'
                            : log.type === 'warn'
                            ? 'text-amber-400'
                            : log.type === 'error'
                            ? 'text-rose-400'
                            : 'text-indigo-400'
                        }`}
                      >
                        [{log.type.toUpperCase()}] {log.title}
                      </span>
                      <span className="text-[10px] text-slate-500">{log.time}</span>
                    </div>
                    {log.details && (
                      <pre className="text-[11px] text-slate-400 overflow-x-auto bg-slate-900/60 p-1.5 rounded">
                        {typeof log.details === 'string'
                          ? log.details
                          : JSON.stringify(log.details, null, 2)}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
