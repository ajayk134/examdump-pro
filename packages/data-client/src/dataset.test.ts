import { describe, expect, it, vi } from 'vitest';
import { DatasetClient, DatasetError } from './dataset.js';

const index = {
  cisco: { file: 'cisco', title: 'Cisco' },
  amazon: { file: 'amazon', title: 'Amazon Web Services (AWS)' },
};

const ciscoExams = {
  cisco: {
    '200-301': 1375,
    '100-890': 1,
  },
};

const exam200 = {
  '200-301': {
    'Question #: 1': {
      Question: { content: [{ type: 'text', value: 'Pick one.' }] },
      Choices: {
        A: { content: [{ type: 'text', value: 'A. Yes' }] },
        B: { content: [{ type: 'text', value: 'B. No' }] },
      },
      Answer: { content: [{ type: 'text', value: 'Suggested Answer: A' }] },
      Explanation: { content: [] },
      Vote_count: [{ voted_answers: 'A', vote_count: 4, is_most_voted: true }],
    },
    'Question #: 2': {
      Question: { content: [{ type: 'text', value: 'Pick two.' }] },
      Choices: {
        A: { content: [{ type: 'text', value: 'A. One' }] },
        B: { content: [{ type: 'text', value: 'B. Two' }] },
        C: { content: [{ type: 'text', value: 'C. Three' }] },
      },
      Answer: { content: [{ type: 'text', value: 'Suggested Answer: AB' }] },
      Vote_count: [],
    },
  },
};

function makeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const relative = url.replace('https://test.local/', '');
    const decoder = decodeURIComponent(relative);
    const body = routes[decoder];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('DatasetClient', () => {
  const routes: Record<string, unknown> = {
    'data/index.json': index,
    'data/cisco/exams.json': ciscoExams,
    'data/cisco/200-301.json': exam200,
  };

  const client = new DatasetClient({
    owner: 'o',
    repo: 'r',
    branch: 'main',
    baseUrl: 'https://test.local',
    fetchImpl: makeFetch(routes),
  });

  it('lists and sorts providers', async () => {
    const providers = await client.getProviders();
    expect(providers.map((p) => p.title)).toEqual(['Amazon Web Services (AWS)', 'Cisco']);
    expect(providers[1]).toMatchObject({ id: 'cisco', file: 'cisco', slug: 'cisco' });
  });

  it('resolves a provider by slug', async () => {
    const provider = await client.getProvider('cisco');
    expect(provider.title).toBe('Cisco');
  });

  it('lists exams with counts', async () => {
    const { exams } = await client.getProviderExams('cisco');
    expect(exams).toHaveLength(2);
    expect(exams.find((e) => e.code === '200-301')?.questionCount).toBe(1375);
  });

  it('normalises exam questions in numeric order', async () => {
    const { questions } = await client.getExamQuestions('cisco', '200-301');
    expect(questions).toHaveLength(2);
    expect(questions[0]?.id).toBe('Question #: 1');
    expect(questions[1]?.answer).toBe('AB');
  });

  it('throws a typed error for unknown exams', async () => {
    await expect(client.getExamQuestions('cisco', '999-999')).rejects.toBeInstanceOf(DatasetError);
  });

  it('supports masked keys (code__hash)', async () => {
    const maskedRoutes: Record<string, unknown> = {
      'data/index.json': { abc: { file: 'abc', title: 'Cisco' } },
      'data/abc/exams.json': { abc: { '200-301__deadbeef': 2 } },
      'data/abc/200-301__deadbeef.json': {
        '200-301__deadbeef': exam200['200-301'],
      },
    };
    const masked = new DatasetClient({
      owner: 'o',
      repo: 'r',
      branch: 'masked_main',
      baseUrl: 'https://test.local',
      fetchImpl: makeFetch(maskedRoutes),
    });
    const { exams } = await masked.getProviderExams('abc');
    expect(exams[0]).toMatchObject({ key: '200-301__deadbeef', code: '200-301', title: '200-301' });
    const result = await masked.getExamQuestions('abc', '200-301__deadbeef');
    expect(result.questions).toHaveLength(2);
  });

  it('caches repeated upstream reads', async () => {
    const fetchImpl = makeFetch(routes);
    const c = new DatasetClient({
      owner: 'o',
      repo: 'r',
      branch: 'main',
      baseUrl: 'https://test.local',
      fetchImpl,
    });
    await c.getProviders();
    const callsAfterFirst = (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await c.getProviders();
    const callsAfterSecond = (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(callsAfterSecond).toBe(callsAfterFirst);
  });
});