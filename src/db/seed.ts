import sql from './client';

export interface SeedOptions {
  resetAll?: boolean;
}

export async function seedDatabase(options: SeedOptions = { resetAll: true }) {
  console.log('🌱 Seeding database...');

  await sql.begin(async (tx) => {
    if (options.resetAll) {
      console.log('  🧹 Cleaning prior holds, orders, and webhook events...');
      await tx`DELETE FROM audit_logs;`;
      await tx`DELETE FROM webhook_events;`;
      await tx`DELETE FROM orders;`;
      await tx`DELETE FROM holds;`;
      await tx`DELETE FROM tiers;`;
      await tx`DELETE FROM events;`;
    }

    // 1. Seed Events
    console.log('  🎭 Inserting events...');
    await tx`
      INSERT INTO events (id, title, venue, starts_at)
      VALUES 
        ('evt_001', 'Anoushka Shankar — Live in Lisbon', 'Coliseu dos Recreios, Lisboa', '2026-11-14T20:00:00Z'),
        ('evt_002', 'Indie Devs Meetup — Berlin', 'Betahaus, Berlin', '2026-12-05T18:30:00Z')
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        venue = EXCLUDED.venue,
        starts_at = EXCLUDED.starts_at;
    `;

    // 2. Seed Tiers
    console.log('  🎟️ Inserting tiers...');
    await tx`
      INSERT INTO tiers (id, event_id, name, price, currency, total_inventory)
      VALUES
        -- Event 1 Tiers
        ('tier_001_a', 'evt_001', 'Front Stalls', 8500, 'EUR', 50),
        ('tier_001_b', 'evt_001', 'General Standing', 4500, 'EUR', 200),
        ('tier_001_c', 'evt_001', 'Balcony', 3000, 'EUR', 100),
        -- Event 2 Tiers
        ('tier_002_a', 'evt_002', 'Early Bird', 1500, 'EUR', 30),
        ('tier_002_b', 'evt_002', 'General Admission', 2500, 'EUR', 10)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        price = EXCLUDED.price,
        currency = EXCLUDED.currency,
        total_inventory = EXCLUDED.total_inventory;
    `;
  });

  console.log('✅ Database seeded successfully!');
}
