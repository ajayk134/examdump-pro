import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestContext, loginAdmin, registerVerifiedUser, type TestContext } from './helpers.js';

let ctx: TestContext;
let app: FastifyInstance;

beforeAll(async () => {
  ctx = await createTestContext();
  app = ctx.app;
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

describe('subscriptions, coupons and payments', () => {
  it('lists plans and indicates mock payment mode', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/subscriptions/plans' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { plans: unknown[]; paymentsEnabled: boolean; mockPayments: boolean };
    expect(body.plans).toHaveLength(2);
    expect(body.paymentsEnabled).toBe(false);
    expect(body.mockPayments).toBe(true);
  });

  it('rejects invalid coupons', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/coupons/validate',
      payload: { code: 'NOPE', planId: 'premium-monthly' },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { valid: boolean }).valid).toBe(false);
  });

  it('applies a coupon, activates premium and records a payment', async () => {
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
      payload: { code: 'SAVE25', planId: 'premium-monthly' },
    });
    expect((validate.json() as { valid: boolean; percentOff: number }).valid).toBe(true);
    expect((validate.json() as { percentOff: number }).percentOff).toBe(25);

    const subscribe = await app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: { cookie: user.cookie },
      payload: { planId: 'premium-monthly', billingCycle: 'monthly', couponCode: 'SAVE25' },
    });
    expect(subscribe.statusCode).toBe(201);
    const body = subscribe.json() as {
      subscription: { status: string; discountPercent: number };
      payment: { amount: number; discount: number; status: string };
      user: { plan: string; premiumActive: boolean };
    };
    expect(body.subscription.status).toBe('active');
    expect(body.subscription.discountPercent).toBe(25);
    expect(body.payment.amount).toBe(9);
    expect(body.payment.discount).toBe(3);
    expect(body.user).toMatchObject({ plan: 'premium', premiumActive: true });

    const me = await app.inject({
      method: 'GET',
      url: '/api/subscriptions/me',
      headers: { cookie: user.cookie },
    });
    const meBody = me.json() as { subscription: { _id: string }; payments: unknown[] };
    expect(meBody.subscription).toBeTruthy();
    expect(meBody.payments).toHaveLength(1);

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/subscriptions/${meBody.subscription._id}/cancel`,
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
    const first = await app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: { cookie: user.cookie },
      payload: { planId: 'premium-monthly', billingCycle: 'monthly', couponCode: 'ONCE' },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/coupons/validate',
      headers: { cookie: user.cookie },
      payload: { code: 'ONCE', planId: 'premium-monthly' },
    });
    expect((second.json() as { valid: boolean }).valid).toBe(false);
  });
});