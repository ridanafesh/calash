/**
 * Commerce routes — products, orders, payments, inventory, entitlements.
 *
 * ALL routes return 503 Service Unavailable unless COMMERCE_ENABLED=true.
 * This lets us ship the code safely while keeping the feature dark until
 * payment credentials and legal review are complete.
 *
 * Route map:
 *   GET    /api/commerce/products                     — list active products
 *   GET    /api/commerce/products/:id                 — product + prices
 *   POST   /api/commerce/orders                       — create an order
 *   POST   /api/commerce/payments/intent              — create payment intent
 *   POST   /api/commerce/payments/verify              — verify & capture
 *   GET    /api/commerce/inventory                    — user's inventory
 *   GET    /api/commerce/entitlements                 — user's entitlements
 *   POST   /api/commerce/webhooks/:provider           — provider webhooks (no auth)
 *
 * Admin stubs (require admin role — not yet enforced, left for Phase 2):
 *   GET    /api/commerce/admin/orders                 — all orders
 *   POST   /api/commerce/admin/refund                 — issue refund
 *   POST   /api/commerce/admin/entitlements/grant     — manual entitlement grant
 *   DELETE /api/commerce/admin/entitlements/revoke    — manual entitlement revoke
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { pool } from '../db/index.js';
import { CommerceRepository } from '../db/repositories/commerce.repository.js';
import { EntitlementsService } from '../services/entitlements.service.js';
import { getProvider, getAllProviders } from '../services/payments/index.js';
import type { PaymentPlatform } from '../services/payments/index.js';

const COMMERCE_ENABLED = process.env['COMMERCE_ENABLED'] === 'true';

function commerceGuard(_req: Request, res: Response, next: NextFunction) {
  if (!COMMERCE_ENABLED) {
    res.status(503).json({ error: 'Commerce is not enabled on this server.' });
    return;
  }
  next();
}

const router = Router();
const commerce = new CommerceRepository(pool);
const entitlements = new EntitlementsService(pool);

router.use(commerceGuard);

  // ── Products ────────────────────────────────────────────────────────────────

  router.get('/commerce/products', async (_req, res) => {
    const products = await commerce.listActiveProducts();
    res.json({ products });
  });

  router.get('/commerce/products/:id', async (req, res) => {
    const result = await commerce.getProductWithPrices(req.params['id']!);
    if (!result) { res.status(404).json({ error: 'Product not found' }); return; }
    res.json(result);
  });

  // ── Orders ──────────────────────────────────────────────────────────────────

  router.post('/commerce/orders', requireAuth, async (req: Request, res: Response) => {
    const userId = (req as Request & { userId?: string }).userId!;
    const { productId, priceId, platform } = req.body as {
      productId?: string; priceId?: string; platform?: string;
    };

    if (!productId || !priceId || !platform) {
      res.status(400).json({ error: 'productId, priceId, and platform are required' });
      return;
    }

    const productData = await commerce.getProductWithPrices(productId);
    if (!productData) { res.status(404).json({ error: 'Product not found' }); return; }

    const price = productData.prices.find((p) => p.id === priceId && p.platform === platform);
    if (!price) { res.status(404).json({ error: 'Price not found for platform' }); return; }

    const order = await commerce.createOrder({
      userId, productId, priceId, platform,
      amountCents: price.amountCents, currency: price.currency,
    });

    res.status(201).json({ order });
  });

  // ── Payment intent ──────────────────────────────────────────────────────────

  router.post('/commerce/payments/intent', requireAuth, async (req: Request, res: Response) => {
    const userId = (req as Request & { userId?: string }).userId!;
    const { orderId } = req.body as { orderId?: string };

    if (!orderId) { res.status(400).json({ error: 'orderId is required' }); return; }

    const order = await commerce.getOrder(orderId);
    if (!order || order.userId !== userId) {
      res.status(404).json({ error: 'Order not found' }); return;
    }
    if (order.status !== 'pending') {
      res.status(409).json({ error: 'Order is not in pending state' }); return;
    }

    const provider = getProvider(order.platform as PaymentPlatform);
    if (!provider) {
      res.status(503).json({ error: `Payment provider for platform '${order.platform}' is not enabled` });
      return;
    }

    const productData = await commerce.getProductWithPrices(order.productId);

    const intent = await provider.createPaymentIntent({
      orderId: order.id,
      userId,
      amountCents: order.amountCents,
      currency: order.currency,
      productId: order.productId,
      productName: productData?.product.name ?? order.productId,
    });

    const payment = await commerce.createPayment({
      orderId: order.id,
      userId,
      provider: provider.name,
      amountCents: order.amountCents,
      currency: order.currency,
    });

    res.json({ paymentId: payment.id, clientToken: intent.clientToken, providerData: intent.providerData });
  });

  // ── Verify & capture ────────────────────────────────────────────────────────

  router.post('/commerce/payments/verify', requireAuth, async (req: Request, res: Response) => {
    const userId = (req as Request & { userId?: string }).userId!;
    const { paymentId, providerTransactionId, providerReceipt } = req.body as {
      paymentId?: string; providerTransactionId?: string; providerReceipt?: unknown;
    };

    if (!paymentId) { res.status(400).json({ error: 'paymentId is required' }); return; }

    // Fetch order via payment → not directly exposed here, so use order lookup after verify
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: pmtRows } = await client.query<{
        id: string; order_id: string; user_id: string; provider: string; amount_cents: number; currency: string;
      }>(
        `SELECT id, order_id, user_id, provider, amount_cents, currency FROM payments WHERE id = $1`,
        [paymentId],
      );
      const pmt = pmtRows[0];
      if (!pmt || pmt.user_id !== userId) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Payment not found' }); return;
      }

      const order = await commerce.getOrder(pmt.order_id);
      if (!order) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Order not found' }); return;
      }

      const provider = getProvider(order.platform as PaymentPlatform);
      if (!provider) {
        await client.query('ROLLBACK');
        res.status(503).json({ error: 'Provider not enabled' }); return;
      }

      const result = await provider.verifyAndCapture({
        orderId: order.id, userId, providerTransactionId, providerReceipt,
      });

      if (!result.success) {
        await client.query('ROLLBACK');
        res.status(402).json({ error: 'Payment verification failed' }); return;
      }

      await commerce.completePayment(paymentId, result.providerTransactionId, result.rawResponse, client);

      await entitlements.grant({
        userId, productId: order.productId, source: 'purchase', paymentId,
      });

      await client.query('COMMIT');
      res.json({ success: true, providerTransactionId: result.providerTransactionId });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // ── Webhooks (no auth — signature verified by provider) ─────────────────────

  router.post('/commerce/webhooks/:provider', async (req: Request, res: Response) => {
    const providerName = req.params['provider'];
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, String(v ?? '')]),
    );

    const provider = getAllProviders().find((p) => p.name === providerName && p.enabled);
    if (!provider) {
      res.status(404).json({ error: 'Provider not found or not enabled' }); return;
    }

    const event = await provider.handleWebhook(req.body, headers);

    // TODO: dispatch event to order/subscription reconciliation logic
    console.log('[commerce] webhook event', event);

    res.json({ received: true });
  });

  // ── User inventory & entitlements ───────────────────────────────────────────

  router.get('/commerce/inventory', requireAuth, async (req: Request, res: Response) => {
    const userId = (req as Request & { userId?: string }).userId!;
    const items = await commerce.getUserInventory(userId);
    res.json({ items });
  });

  router.get('/commerce/entitlements', requireAuth, async (req: Request, res: Response) => {
    const userId = (req as Request & { userId?: string }).userId!;
    const items = await entitlements.listEntitlements(userId);
    res.json({ entitlements: items });
  });

  // ── Admin stubs (Phase 2) ────────────────────────────────────────────────────

  router.get('/commerce/admin/orders', requireAuth, async (_req, res) => {
    res.status(501).json({ error: 'Admin order listing not yet implemented' });
  });

  router.post('/commerce/admin/refund', requireAuth, async (_req, res) => {
    res.status(501).json({ error: 'Admin refund not yet implemented' });
  });

  router.post('/commerce/admin/entitlements/grant', requireAuth, async (req: Request, res: Response) => {
    const { userId: targetUserId, productId } = req.body as { userId?: string; productId?: string };
    if (!targetUserId || !productId) {
      res.status(400).json({ error: 'userId and productId are required' }); return;
    }
    const e = await entitlements.grant({ userId: targetUserId, productId, source: 'admin' });
    res.json({ entitlement: e });
  });

router.delete('/commerce/admin/entitlements/revoke', requireAuth, async (req: Request, res: Response) => {
  const { userId: targetUserId, productId } = req.body as { userId?: string; productId?: string };
  if (!targetUserId || !productId) {
    res.status(400).json({ error: 'userId and productId are required' }); return;
  }
  await entitlements.revoke(targetUserId, productId);
  res.json({ success: true });
});

export default router;
