/**
 * Production & Staging E2E Smoke Test Script
 *
 * Validates full-stack end-to-end functionality against a live Vercel deployment.
 *
 * Requirements:
 *   - TARGET_URL must be specified (must use https:// unless ALLOW_LOCAL_TARGET=true)
 *   - Non-local targets require dedicated SMOKE_USERNAME and SMOKE_PASSWORD to prevent orphaned accounts
 *   - Verifies health endpoint, auth, device binding, water record ingestion/dedup, list, and stats
 *   - Best-effort cleanup in try/finally to remove device bindings and water records
 *
 * Usage:
 *   SMOKE_USERNAME=myuser SMOKE_PASSWORD=mypass TARGET_URL=https://smart-water-tracker.vercel.app npm run test:smoke
 *   ALLOW_LOCAL_TARGET=true TARGET_URL=http://localhost:3000 npm run test:smoke
 *   ALLOW_EPHEMERAL_USER=true TARGET_URL=https://preview.vercel.app npm run test:smoke
 */

const rawTarget = process.env.TARGET_URL;
const allowLocal = process.env.ALLOW_LOCAL_TARGET === 'true' || process.argv.includes('--allow-local');

if (!rawTarget) {
  console.error('\x1b[31m[FATAL] TARGET_URL environment variable is required.\x1b[0m');
  console.error('Example: SMOKE_USERNAME=smoke_user SMOKE_PASSWORD=Secret123! TARGET_URL=https://smart-water-tracker.vercel.app npm run test:smoke');
  console.error('For local dev testing, explicitly specify ALLOW_LOCAL_TARGET=true:');
  console.error('  ALLOW_LOCAL_TARGET=true TARGET_URL=http://localhost:3000 npm run test:smoke');
  process.exit(1);
}

const targetUrl = rawTarget.replace(/\/$/, '');

// Enforce HTTPS for non-local targets
const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(targetUrl);
if (!isLocalhost && !targetUrl.startsWith('https://')) {
  console.error(`\x1b[31m[FATAL] Production smoke test target must use HTTPS. Received: ${targetUrl}\x1b[0m`);
  process.exit(1);
}

if (isLocalhost && !allowLocal) {
  console.error('\x1b[31m[FATAL] Targeting localhost requires ALLOW_LOCAL_TARGET=true to prevent accidental local verification.\x1b[0m');
  process.exit(1);
}

// Guard against polluting non-local databases with orphaned ephemeral user accounts
const hasDedicatedAccount = Boolean(process.env.SMOKE_USERNAME && process.env.SMOKE_PASSWORD);
const allowEphemeral = process.env.ALLOW_EPHEMERAL_USER === 'true';

if (!isLocalhost && !hasDedicatedAccount && !allowEphemeral) {
  console.error('\x1b[31m[FATAL] Non-local targets (Preview / Staging / Production) require dedicated smoke credentials.\x1b[0m');
  console.error('Provide SMOKE_USERNAME and SMOKE_PASSWORD to avoid accumulating ephemeral user accounts in the database.');
  console.error('Example:');
  console.error('  SMOKE_USERNAME="dedicated_smoke" SMOKE_PASSWORD="StrongSmokePass123!" TARGET_URL="https://..." npm run test:smoke');
  console.error('If testing an ephemeral preview database where orphan user retention is acceptable, pass ALLOW_EPHEMERAL_USER=true.');
  process.exit(1);
}

// Registry for tracked resources to ensure best-effort cleanup
const cleanupRegistry = {
  userToken: '',
  deviceIds: [] as string[],
  recordIds: [] as string[],
};

async function performCleanup(): Promise<void> {
  console.log('\n🧹 Performing best-effort cleanup of smoke test resources...');
  const { userToken, deviceIds, recordIds } = cleanupRegistry;

  if (!userToken) {
    console.log('   No user session established; skipping authenticated resource cleanup.');
    return;
  }

  // 1. Delete created water records (creates tombstones in deleted_water_events scoped to smoke tenant)
  for (const recordId of recordIds) {
    try {
      const res = await fetch(`${targetUrl}/api/v1/water/records/${recordId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userToken}` },
      });
      if (res.ok) {
        console.log(`   ✔ Deleted smoke water record: ${recordId} (tombstone created for BLE sync reconciliation)`);
      } else {
        console.warn(`   ⚠ Failed to delete smoke water record ${recordId}: HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn(`   ⚠ Cleanup error for record ${recordId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Unbind created devices
  for (const deviceId of deviceIds) {
    try {
      const res = await fetch(`${targetUrl}/api/v1/devices/${deviceId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userToken}` },
      });
      if (res.ok) {
        console.log(`   ✔ Unbound smoke device: ${deviceId}`);
      } else {
        console.warn(`   ⚠ Failed to unbind smoke device ${deviceId}: HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn(`   ⚠ Cleanup error for device ${deviceId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('🧹 Cleanup completed.\n');
}

async function runStep(name: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`  ⏳ ${name}... `);
  try {
    await fn();
    console.log(`\x1b[32m✔ PASSED\x1b[0m`);
  } catch (err) {
    console.log(`\x1b[31m✘ FAILED\x1b[0m`);
    console.error(`     Error: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

async function main() {
  console.log(`\n========================================`);
  console.log(`🚀 Smart Water Tracker Production Smoke Test`);
  console.log(`🎯 Target URL: ${targetUrl}`);
  console.log(`🔒 Mode: ${isLocalhost ? 'Local Development' : 'Live Deployment'}`);
  console.log(`👤 Account: ${hasDedicatedAccount ? `Dedicated (${process.env.SMOKE_USERNAME})` : 'Ephemeral (allow-ephemeral opt-in)'}`);
  console.log(`========================================\n`);

  const uniqueSuffix = Date.now().toString(16);
  const testUsername = process.env.SMOKE_USERNAME || `smoke_${uniqueSuffix}`;
  const testPassword = process.env.SMOKE_PASSWORD || `SmokePass_${uniqueSuffix}!`;
  const isDedicatedAccount = hasDedicatedAccount;
  const testDeviceId = `smoke_cup_${uniqueSuffix}`;
  const testEventId = `evt_smoke_${uniqueSuffix}`;

  let userToken = '';
  let deviceToken = '';
  let createdRecordId = '';

  try {
    // 1. Health check & Runtime Validation
    await runStep('1. Health check & Runtime verification (/api/v1/health)', async () => {
      const res = await fetch(`${targetUrl}/api/v1/health`);
      if (!res.ok) {
        throw new Error(`Health check returned HTTP ${res.status}`);
      }
      const data = (await res.json()) as { status: string; service: string; runtime: string };
      if (data.status !== 'ok') {
        throw new Error(`Unexpected health status: ${data.status}`);
      }
      if (data.service !== 'smart-water-tracker-backend') {
        throw new Error(`Unexpected service identifier: ${data.service}`);
      }
      if (!isLocalhost && data.runtime !== 'vercel-serverless') {
        throw new Error(`Expected runtime "vercel-serverless" for production target, received "${data.runtime}"`);
      }
    });

    // 2. User Authentication (Register new or login existing)
    if (!isDedicatedAccount) {
      await runStep('2. Ephemeral User Registration (/api/v1/auth/register)', async () => {
        const res = await fetch(`${targetUrl}/api/v1/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: testUsername,
            password: testPassword,
            displayName: 'Smoke Tester',
          }),
        });

        if (res.status !== 201) {
          const err = await res.text();
          throw new Error(`Register returned HTTP ${res.status}: ${err}`);
        }

        const data = (await res.json()) as { token: string };
        if (!data.token) {
          throw new Error('No JWT token returned upon registration');
        }
        userToken = data.token;
        cleanupRegistry.userToken = userToken;
      });
    }

    // 3. User login (Case-insensitive verification)
    await runStep('3. Case-Insensitive Login (/api/v1/auth/login)', async () => {
      const res = await fetch(`${targetUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: testUsername.toUpperCase(),
          password: testPassword,
        }),
      });

      if (res.status !== 200) {
        const err = await res.text();
        throw new Error(`Login returned HTTP ${res.status}: ${err}`);
      }

      const data = (await res.json()) as { token: string };
      userToken = data.token;
      cleanupRegistry.userToken = userToken;
    });

    // 4. Authenticated Profile Query
    await runStep('4. Authenticated Profile Query (/api/v1/user/me)', async () => {
      const res = await fetch(`${targetUrl}/api/v1/user/me`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });

      if (res.status !== 200) {
        const err = await res.text();
        throw new Error(`Profile query returned HTTP ${res.status}: ${err}`);
      }

      const data = (await res.json()) as { user: { username: string } };
      if (data.user.username.toLowerCase() !== testUsername.toLowerCase()) {
        throw new Error(`Username mismatch in profile: expected ${testUsername}, got ${data.user.username}`);
      }
    });

    // 5. Hardware Device Binding
    await runStep('5. Hardware Device Binding (/api/v1/devices)', async () => {
      const res = await fetch(`${targetUrl}/api/v1/devices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({
          deviceId: testDeviceId,
          name: 'Smoke Cup',
        }),
      });

      if (res.status !== 201) {
        const err = await res.text();
        throw new Error(`Device bind returned HTTP ${res.status}: ${err}`);
      }

      cleanupRegistry.deviceIds.push(testDeviceId);

      const data = (await res.json()) as { device: { deviceToken: string } };
      deviceToken = data.device.deviceToken;
      if (!deviceToken) {
        throw new Error('Device token missing in bind response');
      }
    });

    // 6. Water Record Ingestion via Device Token
    await runStep('6. Water Record Ingestion via Device Token (/api/v1/water/records)', async () => {
      const res = await fetch(`${targetUrl}/api/v1/water/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deviceToken}`,
        },
        body: JSON.stringify({
          eventId: testEventId,
          type: 'drink',
          amountMl: 250,
          timeSynced: true,
          occurredAt: Math.floor(Date.now() / 1000),
        }),
      });

      if (res.status !== 201) {
        const err = await res.text();
        throw new Error(`Record ingestion returned HTTP ${res.status}: ${err}`);
      }

      const data = (await res.json()) as { duplicated: boolean; record: { id: string } };
      if (data.duplicated !== false) {
        throw new Error('Initial record was erroneously marked as duplicated');
      }
      if (!data.record?.id) {
        throw new Error('No record ID returned in ingestion response');
      }
      createdRecordId = data.record.id;
      cleanupRegistry.recordIds.push(createdRecordId);
    });

    // 7. Idempotent Deduplication Check
    await runStep('7. Idempotent Event Deduplication (/api/v1/water/records)', async () => {
      const res = await fetch(`${targetUrl}/api/v1/water/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deviceToken}`,
        },
        body: JSON.stringify({
          eventId: testEventId,
          type: 'drink',
          amountMl: 250,
          timeSynced: true,
          occurredAt: Math.floor(Date.now() / 1000),
        }),
      });

      if (res.status !== 200) {
        const err = await res.text();
        throw new Error(`Deduplication returned HTTP ${res.status}: ${err}`);
      }

      const data = (await res.json()) as { duplicated: boolean };
      if (data.duplicated !== true) {
        throw new Error('Duplicate event was not properly flagged as duplicated');
      }
    });

    // 8. Water Records Query (List)
    await runStep('8. Water Records Query (/api/v1/water/records)', async () => {
      const res = await fetch(`${targetUrl}/api/v1/water/records?limit=10`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });

      if (res.status !== 200) {
        const err = await res.text();
        throw new Error(`List records returned HTTP ${res.status}: ${err}`);
      }

      const data = (await res.json()) as { records: Array<{ id: string }> };
      const found = data.records?.some((r) => r.id === createdRecordId);
      if (!found) {
        throw new Error(`Created record ${createdRecordId} not found in user record list`);
      }
    });

    // 9. Daily Stats Aggregation
    await runStep('9. Water Statistics Aggregation (/api/v1/water/stats/daily)', async () => {
      const res = await fetch(`${targetUrl}/api/v1/water/stats/daily`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });

      if (res.status !== 200) {
        const err = await res.text();
        throw new Error(`Daily stats returned HTTP ${res.status}: ${err}`);
      }

      const data = (await res.json()) as { totalMl: number; drinkCount: number };
      if (data.totalMl < 250 || data.drinkCount < 1) {
        throw new Error(`Expected at least 250ml and 1 drink, received ${data.totalMl}ml and ${data.drinkCount} drinks`);
      }
    });

    console.log(`\n\x1b[32m✨ All production smoke test steps completed successfully!\x1b[0m`);
  } finally {
    // Guaranteed best-effort cleanup regardless of pass or failure
    await performCleanup();
  }
}

main().catch((err) => {
  console.error('\x1b[31m[FATAL] Smoke test suite failed:\x1b[0m', err instanceof Error ? err.message : err);
  process.exit(1);
});
