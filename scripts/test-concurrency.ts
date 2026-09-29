import chalk from 'chalk';
import sql from '../src/db/client';
import { seedDatabase } from '../src/db/seed';
import { HoldsService } from '../src/services/holds.service';
import { InventoryService } from '../src/services/inventory.service';
import { OversoldError } from '../src/utils/errors';

async function runConcurrencyTest() {
  console.log(chalk.bold.cyan('\n======================================================'));
  console.log(chalk.bold.cyan(' 🚀 RUNNING CONCURRENCY HAMMER TEST (10 BIDS, 1 SEAT)'));
  console.log(chalk.bold.cyan('======================================================\n'));

  // 1. Reset database and set tier_002_b total inventory to exactly 1 ticket
  await seedDatabase({ resetAll: true });

  const targetTierId = 'tier_002_b';
  await sql`
    UPDATE tiers 
    SET total_inventory = 1 
    WHERE id = ${targetTierId};
  `;

  const eventBefore = await InventoryService.getEventWithInventory('evt_002');
  const tierBefore = eventBefore.tiers.find((t) => t.id === targetTierId);
  console.log(
    chalk.yellow(`Initial inventory for ${targetTierId}: `) +
      chalk.bold.green(`${tierBefore?.available_inventory} ticket available\n`)
  );

  console.log(
    chalk.magenta('💥 Firing 10 simultaneous hold requests at the exact same millisecond...')
  );

  const CONCURRENT_REQUESTS = 10;
  const holdAttempts = Array.from({ length: CONCURRENT_REQUESTS }, (_, index) => {
    return (async () => {
      const clientId = `Buyer_${String.fromCharCode(65 + index)}`;
      try {
        const result = await HoldsService.createHold(targetTierId, 1);
        return { clientId, success: true, result };
      } catch (error: any) {
        return {
          clientId,
          success: false,
          code: error.code || 'ERROR',
          message: error.message,
          isOversold: error instanceof OversoldError || error.code === 'OVERSOLD',
        };
      }
    })();
  });

  const results = await Promise.all(holdAttempts);

  const successful = results.filter((r) => r.success);
  const oversold = results.filter((r) => !r.success && r.isOversold);
  const unexpectedErrors = results.filter((r) => !r.success && !r.isOversold);

  console.log(chalk.bold('\n--- Results Breakdown ---'));
  results.forEach((r) => {
    if (r.success) {
      console.log(
        chalk.green(`  ✔ ${r.clientId}: HOLD GRANTED (${(r.result as any).hold_id})`)
      );
    } else {
      console.log(
        chalk.red(`  ✖ ${r.clientId}: REJECTED [${r.code}] - ${r.message}`)
      );
    }
  });

  console.log(chalk.bold('\n--- Verification Audit ---'));
  console.log(`Total Requests:         ${CONCURRENT_REQUESTS}`);
  console.log(
    `Successful Holds:       ${successful.length === 1 ? chalk.green('1 (EXACTLY 1 WINNER)') : chalk.red(`${successful.length}`)}`
  );
  console.log(
    `Oversold (409) Blocks:  ${oversold.length === 9 ? chalk.green('9 (PROPERLY REJECTED)') : chalk.red(`${oversold.length}`)}`
  );
  console.log(
    `Unexpected Errors:      ${unexpectedErrors.length === 0 ? chalk.green('0 (CLEAN)') : chalk.red(`${unexpectedErrors.length}`)}`
  );

  // Check inventory invariant
  const eventAfter = await InventoryService.getEventWithInventory('evt_002');
  const tierAfter = eventAfter.tiers.find((t) => t.id === targetTierId);

  console.log(
    `Remaining Inventory:    ${tierAfter?.available_inventory === 0 ? chalk.green('0 (NO OVERSELLING!)') : chalk.red(`${tierAfter?.available_inventory}`)}`
  );

  if (successful.length === 1 && oversold.length === 9 && tierAfter?.available_inventory === 0) {
    console.log(
      chalk.bold.bgGreen.black('\n ✅ PASS: Concurrency locking guarantees zero overselling! \n')
    );
  } else {
    console.error(
      chalk.bold.bgRed.white('\n ❌ FAIL: Concurrency race condition detected! \n')
    );
    throw new Error('Concurrency test failed');
  }
}

runConcurrencyTest()
  .then(async () => {
    await sql.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await sql.end();
    process.exit(1);
  });
