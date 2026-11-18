import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestContext, DATASET, registerVerifiedUser, type TestContext } from './helpers.js';

let ctx: TestContext;
let app: FastifyInstance;

const question = { provider: 'cisco', exam: '200-301', questionId: 'Question #: 1' };
const multiQuestion = { provider: 'cisco', exam: '200-301', questionId: 'Question #: multi' };
const voteUrl = `/api/community/votes?${new URLSearchParams(question).toString()}`;
const discussionUrl = `/api/community/discussions?${new URLSearchParams({
  ...question,
  pageSize: '8',
}).toString()}`;

beforeAll(async () => {
  const exam = DATASET['data/cisco/200-301.json'] as Record<string, Record<string, unknown>>;
  const questions = exam['200-301']!;
  questions['Question #: multi'] = {
    Title: 'Multi-answer question',
    Question: { content: [{ type: 'text', value: 'Which two options apply?' }] },
    Choices: {
      A: { content: [{ type: 'text', value: 'A. First option' }] },
      B: { content: [{ type: 'text', value: 'B. Second option' }] },
      C: { content: [{ type: 'text', value: 'C. Third option' }] },
      D: { content: [{ type: 'text', value: 'D. Fourth option' }] },
    },
    Answer: { content: [{ type: 'text', value: 'Suggested Answer: AC' }] },
    Explanation: { content: [{ type: 'text', value: 'A and C are correct.' }] },
    Vote_count: [],
  };

  ctx = await createTestContext();
  app = ctx.app;
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

describe('community votes', () => {
  it('requires authentication', async () => {
    expect((await app.inject({ method: 'GET', url: voteUrl })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/community/votes',
          payload: { ...question, choice: 'A' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('returns every real option with zero counts', async () => {
    const { cookie } = await registerVerifiedUser(app);
    const res = await app.inject({ method: 'GET', url: voteUrl, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ total: 0, myVote: null });
    expect(body.counts).toEqual({ A: 0, B: 0, C: 0, D: 0 });
  });

  it('casts one vote and updates it instead of adding a duplicate', async () => {
    const first = await registerVerifiedUser(app);
    const second = await registerVerifiedUser(app);

    const voteA = await app.inject({
      method: 'POST',
      url: '/api/community/votes',
      headers: { cookie: first.cookie },
      payload: { ...question, choice: 'A' },
    });
    expect(voteA.statusCode).toBe(200);
    expect(voteA.json()).toMatchObject({ total: 1, myVote: 'A' });
    expect(voteA.json().counts.A).toBe(1);

    const change = await app.inject({
      method: 'POST',
      url: '/api/community/votes',
      headers: { cookie: first.cookie },
      payload: { ...question, choice: 'B' },
    });
    expect(change.statusCode).toBe(200);
    expect(change.json()).toMatchObject({ total: 1, myVote: 'B' });
    expect(change.json().counts).toMatchObject({ A: 0, B: 1 });

    const secondVote = await app.inject({
      method: 'POST',
      url: '/api/community/votes',
      headers: { cookie: second.cookie },
      payload: { ...question, choice: 'B' },
    });
    expect(secondVote.statusCode).toBe(200);
    expect(secondVote.json()).toMatchObject({ total: 2 });
    expect(secondVote.json().counts.B).toBe(2);
  });

  it('rejects an option that is not on the question', async () => {
    const { cookie } = await registerVerifiedUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/community/votes',
      headers: { cookie },
      payload: { ...question, choice: 'Z' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts one persisted multi-answer selection and counts each option', async () => {
    const first = await registerVerifiedUser(app);
    const second = await registerVerifiedUser(app);
    const url = `/api/community/votes?${new URLSearchParams(multiQuestion).toString()}`;

    const multi = await app.inject({
      method: 'POST',
      url: '/api/community/votes',
      headers: { cookie: first.cookie },
      payload: { ...multiQuestion, choice: 'A,C' },
    });
    expect(multi.statusCode).toBe(200);
    expect(multi.json()).toMatchObject({ total: 2, myVote: 'A,C' });
    expect(multi.json().counts).toMatchObject({ A: 1, B: 0, C: 1, D: 0 });

    const secondVote = await app.inject({
      method: 'POST',
      url: '/api/community/votes',
      headers: { cookie: second.cookie },
      payload: { ...multiQuestion, choice: 'C' },
    });
    expect(secondVote.statusCode).toBe(200);
    expect(secondVote.json()).toMatchObject({ total: 3 });
    expect(secondVote.json().counts).toMatchObject({ A: 1, C: 2 });

    const mine = await app.inject({ method: 'GET', url, headers: { cookie: first.cookie } });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().myVote).toBe('A,C');
  });

  it('rejects multiple options on a single-answer question', async () => {
    const { cookie } = await registerVerifiedUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/community/votes',
      headers: { cookie },
      payload: { ...question, choice: 'A,B' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('question discussions', () => {
  it('requires authentication', async () => {
    expect((await app.inject({ method: 'GET', url: discussionUrl })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/community/discussions',
          payload: { ...question, body: 'A comment' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('posts a comment, threads a reply, and enforces edit/delete permissions', async () => {
    const owner = await registerVerifiedUser(app, { name: 'Thread Owner' });
    const other = await registerVerifiedUser(app, { name: 'Other Learner' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/community/discussions',
      headers: { cookie: owner.cookie },
      payload: { ...question, body: 'Why does the aging timer matter here?' },
    });
    expect(created.statusCode).toBe(201);
    const rootId = created.json().comment.id as string;
    expect(created.json().comment.user.name).toBe('Thread Owner');

    const reply = await app.inject({
      method: 'POST',
      url: '/api/community/discussions',
      headers: { cookie: other.cookie },
      payload: {
        ...question,
        parentId: rootId,
        body: 'Because stale entries would keep forwarding traffic.',
      },
    });
    expect(reply.statusCode).toBe(201);
    const replyId = reply.json().comment.id as string;

    const nested = await app.inject({
      method: 'POST',
      url: '/api/community/discussions',
      headers: { cookie: owner.cookie },
      payload: {
        ...question,
        parentId: replyId,
        body: 'That makes sense — the default timer is five minutes.',
      },
    });
    expect(nested.statusCode).toBe(201);

    const list = await app.inject({ method: 'GET', url: discussionUrl, headers: { cookie: owner.cookie } });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.totalComments).toBe(3);
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]).toMatchObject({
      id: rootId,
      replyCount: 2,
    });
    expect(body.comments[0].replies[0].user.name).toBe('Other Learner');
    expect(body.comments[0].replies[0].replies[0].body).toContain('five minutes');

    const forbiddenEdit = await app.inject({
      method: 'PATCH',
      url: `/api/community/discussions/${rootId}`,
      headers: { cookie: other.cookie },
      payload: { body: 'Trying to edit someone else' },
    });
    expect(forbiddenEdit.statusCode).toBe(403);

    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/community/discussions/${rootId}`,
      headers: { cookie: owner.cookie },
      payload: { body: 'Updated: why does the aging timer matter?' },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().comment.body).toContain('Updated:');

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/community/discussions/${rootId}`,
      headers: { cookie: owner.cookie },
    });
    expect(remove.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: discussionUrl, headers: { cookie: owner.cookie } });
    expect(after.statusCode).toBe(200);
    expect(after.json().comments[0]).toMatchObject({ deleted: true, body: '' });
    expect(after.json().comments[0].replies).toHaveLength(1);
  });

  it('paginates top-level comments', async () => {
    const { cookie } = await registerVerifiedUser(app);
    for (const body of ['First top-level comment', 'Second top-level comment']) {
      await app.inject({
        method: 'POST',
        url: '/api/community/discussions',
        headers: { cookie },
        payload: { ...question, body },
      });
    }

    const page = await app.inject({
      method: 'GET',
      url: `/api/community/discussions?${new URLSearchParams({
        ...question,
        page: '1',
        pageSize: '1',
      }).toString()}`,
      headers: { cookie },
    });
    expect(page.statusCode).toBe(200);
    expect(page.json().comments).toHaveLength(1);
    expect(page.json().pagination.hasNext).toBe(true);
  });
});