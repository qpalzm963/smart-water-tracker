import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { getDatabase } from '../database/db';
import { AuthenticatedRequest, Device, DeviceResponse } from '../types';

const bindDeviceSchema = z
  .object({
    deviceId: z.string().min(3, 'Device ID must be at least 3 characters').optional(),
    id: z.string().min(3, 'Device ID must be at least 3 characters').optional(),
    claimCode: z.string().optional(),
    newClaimCode: z.string().min(1, 'New claim code must not be empty').optional(),
    name: z.string().optional(),
  })
  .refine((input) => Boolean(input.deviceId || input.id), {
    path: ['deviceId'],
    message: 'Device ID must be at least 3 characters',
  });

function isDeviceOnline(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  const lastSeenTime = new Date(lastSeenAt).getTime();
  const now = Date.now();
  // Online if communicated within the last 5 minutes (300,000 ms)
  return now - lastSeenTime <= 5 * 60 * 1000;
}

function maskToken(token: string): string {
  if (!token || token.length < 8) return '****';
  return `${token.substring(0, 4)}****${token.substring(token.length - 4)}`;
}

export function bindDevice(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { deviceId: rawDeviceId, id: rawId, claimCode, newClaimCode, name } = bindDeviceSchema.parse(req.body);
    const deviceId = (rawDeviceId || rawId)!;
    const db = getDatabase();

    const existingDevice = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId) as unknown as
      | Device
      | undefined;

    if (existingDevice) {
      if (existingDevice.user_id !== userId) {
        // Device is bound to another user. Require hardware claim code to transfer ownership.
        if (existingDevice.claim_code && claimCode && existingDevice.claim_code === claimCode) {
          if (!newClaimCode) {
            res.status(400).json({
              error: 'Provide newClaimCode after rotating the claim secret on the device over BLE.',
            });
            return;
          }

          // The caller proves possession with the old secret and supplies the
          // replacement secret already persisted on the physical device.
          const newDeviceToken = `dvt_${crypto.randomBytes(24).toString('hex')}`;
          const now = new Date().toISOString();

          db.prepare(
            `UPDATE devices SET user_id = ?, device_token = ?, claim_code = ?, name = ?, created_at = ? WHERE id = ?`
          ).run(userId, newDeviceToken, newClaimCode, name || existingDevice.name || null, now, deviceId);

          const response: DeviceResponse = {
            id: deviceId,
            name: name || existingDevice.name || null,
            deviceToken: newDeviceToken,
            hasClaimCode: true,
            lastSeenAt: existingDevice.last_seen_at,
            isOnline: isDeviceOnline(existingDevice.last_seen_at),
            createdAt: now,
          };

          res.status(200).json({
            device: response,
            message: 'Device claimed successfully. Ownership transferred and the hardware-rotated claim code was saved.',
          });
          return;
        }

        res.status(409).json({
          error: 'Device is already bound to another user. Provide the current claimCode and a BLE-rotated newClaimCode to transfer ownership.',
        });
        return;
      }

      // If already bound to this user, return response with masked token
      const response: DeviceResponse = {
        id: existingDevice.id,
        name: existingDevice.name,
        deviceToken: maskToken(existingDevice.device_token),
        hasClaimCode: !!existingDevice.claim_code,
        lastSeenAt: existingDevice.last_seen_at,
        isOnline: isDeviceOnline(existingDevice.last_seen_at),
        createdAt: existingDevice.created_at,
      };
      res.status(200).json({ device: response, message: 'Device already bound to your account' });
      return;
    }

    // First-time binding of a new device
    const deviceToken = `dvt_${crypto.randomBytes(24).toString('hex')}`;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO devices (id, user_id, device_token, claim_code, name, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(deviceId, userId, deviceToken, claimCode || null, name || null, now);

    const response: DeviceResponse = {
      id: deviceId,
      name: name || null,
      deviceToken, // Full token returned ONLY on initial binding
      hasClaimCode: !!claimCode,
      lastSeenAt: null,
      isOnline: false,
      createdAt: now,
    };

    res.status(201).json({
      device: response,
      message: 'Device bound successfully. Save the deviceToken now; it will not be shown again in full.',
    });
  } catch (err) {
    next(err);
  }
}

export function listDevices(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const db = getDatabase();
    const devices = db
      .prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as unknown as Device[];

    // Return masked tokens in list view to prevent credential leakage
    const response: DeviceResponse[] = devices.map((d) => ({
      id: d.id,
      name: d.name,
      deviceToken: maskToken(d.device_token),
      hasClaimCode: !!d.claim_code,
      lastSeenAt: d.last_seen_at,
      isOnline: isDeviceOnline(d.last_seen_at),
      createdAt: d.created_at,
    }));

    res.status(200).json({ devices: response });
  } catch (err) {
    next(err);
  }
}

export function rotateDeviceToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    const userId = req.user?.id;
    const deviceId = req.params.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const db = getDatabase();
    const device = db
      .prepare('SELECT id FROM devices WHERE id = ? AND user_id = ?')
      .get(deviceId, userId) as unknown as Pick<Device, 'id'> | undefined;

    if (!device) {
      res.status(404).json({ error: 'Device not found or not owned by you' });
      return;
    }

    const newDeviceToken = `dvt_${crypto.randomBytes(24).toString('hex')}`;
    db.prepare('UPDATE devices SET device_token = ? WHERE id = ? AND user_id = ?').run(
      newDeviceToken,
      deviceId,
      userId
    );

    res.status(200).json({
      deviceId,
      deviceToken: newDeviceToken,
      message: 'Device token rotated successfully. Update your ESP32 configuration with this new token.',
    });
  } catch (err) {
    next(err);
  }
}

export function unbindDevice(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    const userId = req.user?.id;
    const deviceId = req.params.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const db = getDatabase();
    const device = db.prepare('SELECT id FROM devices WHERE id = ? AND user_id = ?').get(deviceId, userId);

    if (!device) {
      res.status(404).json({ error: 'Device not found or not owned by you' });
      return;
    }

    db.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?').run(deviceId, userId);

    res.status(200).json({ success: true, message: 'Device unbound and token revoked successfully' });
  } catch (err) {
    next(err);
  }
}

export function getDeviceStatus(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    const userId = req.user?.id;
    const deviceId = req.params.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const db = getDatabase();
    const device = db
      .prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?')
      .get(deviceId, userId) as unknown as Device | undefined;

    if (!device) {
      res.status(404).json({ error: 'Device not found or not owned by you' });
      return;
    }

    res.status(200).json({
      deviceId: device.id,
      name: device.name,
      hasClaimCode: !!device.claim_code,
      lastSeenAt: device.last_seen_at,
      isOnline: isDeviceOnline(device.last_seen_at),
    });
  } catch (err) {
    next(err);
  }
}
