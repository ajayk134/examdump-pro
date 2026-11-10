import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestContext, loginAdmin, registerVerifiedUser, subscribeUser, type TestContext } from './helpers.js';

let ctx: TestContext;
let app: FastifyInstance;

beforeAll(async () => {
  ctx = await createTestContext();
  app = ctx.app;
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

describe('subscriptions, coupons and payments (INR)', () => {
  it('lists the four INR plans and indicates mock payment mode', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/subscriptions/plans' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      plans: Array<{ id: string; priceMinor: number; currency: string; scope: string }>;
      mockPayments: boolean;
      currency: string;
    };
    expect(body.plans).toHaveLength(4);
    expect(body.plans.map((p) => p.id).sort()).toEqual(['all-30', 'all-365', 'single-30', 'single-30-early']);
    expect(body.plans.every((p) => p.currency === 'INR')).toBe(true);
    expect(body.plans.find((p) => p.id === 'single-30')?.priceMinor).toBe(50_000);
    expect(body.plans.find((p) => p.id === 'all-365')?.priceMinor).toBe(250_000);
    expect(body.mockPayments).toBe(true);
  });

  it('rejects invalid coupons', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/coupons/validate',
      payload: { code: 'NOPE', planId: 'all-30' },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { valid: boolean }).valid).toBe(false);
  });

  it('requires an exam for single-exam plans', async () => {
    const user = await registerVerifiedUser(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: { cookie: user.cookie },
      payload: { planId: 'single-30' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('applies a coupon, activates access and records an INR payment', async () => {
    const adminCookie = await loginAdmin(app);
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/coupons',
      headers: { cookie: adminCookie },
      payload: { code: 'SAVE25', percentOff: 25, maxRedemptions: 10, active: true, description: 'Test coupon' },
    });
    expect(create.statusCode).toBe(201);

    const user = await registerVerifiedUser(app);
    const validate = await app.inject({
      method: 'POST',
      url: '/api/coupons/validate',
      headers: { cookie: user.cookie },
      payload: { code: 'SAVE25', planId: 'all-30' },
    });
    expect((validate.json() as { valid: boolean; percentOff: number }).valid).toBe(true);
    expect((validate.json() as { percentOff: number }).percentOff).toBe(25);

    const subscribe = await app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: { cookie: user.cookie },
      payload: { planId: 'all-30', couponCode: 'SAVE25' },
    });
    expect(subscribe.statusCode).toBe(201);
    const body = subscribe.json() as {
      subscription: { status: string; discountMinor: number; priceMinor: number; scope: string };
      payment: { amountMinor: number; discountMinor: number; currency: string; status: string };
      user: { plan: string; premiumActive: boolean };
    };
    expect(body.subscription.status).toBe('active');
    expect(body.subscription.scope).toBe('all');
    expect(body.subscription.discountMinor).toBe(37_500);
    expect(body.subscription.priceMinor).toBe(112_500);
    expect(body.payment.amountMinor).toBe(112_500);
    expect(body.payment.discountMinor).toBe(37_500);
    expect(body.payment.currency).toBe('INR');
    expect(body.user).toMatchObject({ plan: 'premium', premiumActive: true });

    const me = await app.inject({ method: 'GET', url: '/api/subscriptions/me', headers: { cookie: user.cookie } });
    const meBody = me.json() as { subscription: { id: string }; payments: unknown[]; entitlements: { allAccess: boolean } };
    expect(meBody.subscription).toBeTruthy();
    expect(meBody.payments).toHaveLength(1);
    expect(meBody.entitlements.allAccess).toBe(true);

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/subscriptions/${meBody.subscription.id}/cancel`,
      headers: { cookie: user.cookie },
    });
    expect(cancel.statusCode).toBe(200);
    expect((cancel.json() as { subscription: { cancelAtPeriodEnd: boolean } }).subscription.cancelAtPeriodEnd).toBe(true);
  });

  it('prevents reusing the same coupon', async () => {
    const adminCookie = await loginAdmin(app);
    await app.inject({
      method: 'POST',
      url: '/api/admin/coupons',
      headers: { cookie: adminCookie },
      payload: { code: 'ONCE', percentOff: 10, maxRedemptions: 0, active: true },
    });
    const user = await registerVerifiedUser(app);
    await subscribeUser(app, user.cookie, 'all-30');
    const couponAgainst = await app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: { cookie: user.cookie },
      payload: { planId: 'all-30', couponCode: 'ONCE' },
    });
    expect(couponAgainst.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/coupons/validate',
      headers: { cookie: user.cookie },
      payload: { code: 'ONCE', planId: 'all-30' },
    });
    expect((second.json() as { valid: boolean }).valid).toBe(false);
  });

  it('supports admin refunds which revoke access', async () => {
    const adminCookie = await loginAdmin(app);
    const user = await registerVerifiedUser(app);
    await subscribeUser(app, user.cookie, 'all-30');

    const adminUser = await app.inject({
      method: 'GET',
      url: `/api/admin/users/${user.userId}`,
      headers: { cookie: adminCookie },
    });
    const payments = (adminUser.json() as { payments: Array<{ id: string; amountMinor: number }> }).payments;
    expect(payments).toHaveLength(1);

    const refund = await app.inject({
      method: 'POST',
      url: `/api/admin/payments/${payments[0]!.id}/refund`,
      headers: { cookie: adminCookie },
      payload: { reason: 'Customer request' },
    });
    expect(refund.statusCode).toBe(201);

    const me = await app.inject({ method: 'GET', url: '/api/subscriptions/me', headers: { cookie: user.cookie } });
    const meBody = me.json() as { entitlements: { allAccess: boolean } };
    expect(meBody.entitlements.allAccess).toBe(false);
  });
});
