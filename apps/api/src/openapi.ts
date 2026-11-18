/**
 * Hand-maintained OpenAPI document. It intentionally covers the public and
 * admin surface so the generated Swagger UI is a usable API reference.
 */
const ok = (description: string) => ({ description, content: { 'application/json': { schema: { type: 'object' } } } });
const err = (description: string) => ({ description });

const bearer = [{ cookieAuth: [] }, { bearerAuth: [] }];

export function buildOpenApi(publicWebUrl: string) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'ExamDump Pro API',
      version: '1.0.0',
      description:
        'Premium exam-preparation platform API. Exam questions are served from a private GitHub dataset and are never persisted in MongoDB.',
    },
    servers: [{ url: '/api', description: 'Same-origin API' }],
    tags: [
      { name: 'Health' },
      { name: 'Auth' },
      { name: 'Users' },
      { name: 'Exams' },
      { name: 'Attempts' },
      { name: 'Progress' },
      { name: 'Bookmarks' },
      { name: 'Notes' },
      { name: 'Subscriptions' },
      { name: 'Coupons' },
      { name: 'Referrals' },
      { name: 'Notifications' },
      { name: 'Leaderboard' },
      { name: 'AI' },
      { name: 'Admin' },
    ],
    components: {
      securitySchemes: {
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'ed_access' },
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    paths: {
      '/health': { get: { tags: ['Health'], summary: 'Service health', responses: { 200: ok('Service health') } } },
      '/health/ready': { get: { tags: ['Health'], summary: 'Readiness probe', responses: { 200: ok('Ready'), 503: err('Not ready') } } },
      '/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Register an account',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'email', 'password', 'acceptTerms'],
                  properties: {
                    name: { type: 'string' },
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string', minLength: 8 },
                    referralCode: { type: 'string' },
                    acceptTerms: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: { 201: ok('Account created'), 409: err('Email already registered') },
        },
      },
      '/auth/login': { post: { tags: ['Auth'], summary: 'Sign in', responses: { 200: ok('Signed in'), 401: err('Invalid credentials'), 429: err('Rate limited') } } },
      '/auth/google': { post: { tags: ['Auth'], summary: 'Sign in with Google ID token', responses: { 200: ok('Signed in'), 503: err('Google not configured') } } },
      '/auth/refresh': { post: { tags: ['Auth'], summary: 'Rotate refresh token', responses: { 200: ok('New access token'), 401: err('Session expired') } } },
      '/auth/logout': { post: { tags: ['Auth'], summary: 'Sign out', responses: { 200: ok('Signed out') } } },
      '/auth/me': { get: { tags: ['Auth'], security: bearer, summary: 'Current user', responses: { 200: ok('Current user'), 401: err('Unauthorized') } } },
      '/auth/verify-email': { post: { tags: ['Auth'], summary: 'Verify email', responses: { 200: ok('Verified'), 401: err('Invalid token') } } },
      '/auth/forgot-password': { post: { tags: ['Auth'], summary: 'Request password reset', responses: { 200: ok('Reset requested') } } },
      '/auth/reset-password': { post: { tags: ['Auth'], summary: 'Reset password', responses: { 200: ok('Password reset'), 401: err('Invalid token') } } },
      '/auth/change-password': { post: { tags: ['Auth'], security: bearer, summary: 'Change password', responses: { 200: ok('Password changed'), 401: err('Wrong current password') } } },
      '/users/me': { get: { tags: ['Users'], security: bearer, summary: 'Get profile', responses: { 200: ok('Profile') } }, patch: { tags: ['Users'], security: bearer, summary: 'Update profile', responses: { 200: ok('Profile updated') } } },
      '/users/me/preferences': { patch: { tags: ['Users'], security: bearer, summary: 'Update preferences', responses: { 200: ok('Preferences updated') } } },
      '/users/me/export': { get: { tags: ['Users'], security: bearer, summary: 'Export personal data', responses: { 200: ok('Data export') } } },
      '/exams/providers': { get: { tags: ['Exams'], summary: 'List providers', responses: { 200: ok('Providers') } } },
      '/exams/search': { get: { tags: ['Exams'], summary: 'Search exams', parameters: [{ in: 'query', name: 'q', schema: { type: 'string' } }, { in: 'query', name: 'provider', schema: { type: 'string' } }, { in: 'query', name: 'sort', schema: { type: 'string', enum: ['popular', 'title', 'questions', 'newest'] } }], responses: { 200: ok('Search results') } } },
      '/exams/{providerId}': { get: { tags: ['Exams'], summary: 'Provider detail with exams', parameters: [{ in: 'path', name: 'providerId', required: true, schema: { type: 'string' } }], responses: { 200: ok('Provider'), 404: err('Not found') } } },
      '/exams/{providerId}/{examKey}': { get: { tags: ['Exams'], summary: 'Exam metadata and entitlement', parameters: [{ in: 'path', name: 'providerId', required: true, schema: { type: 'string' } }, { in: 'path', name: 'examKey', required: true, schema: { type: 'string' } }], responses: { 200: ok('Exam'), 404: err('Not found') } } },
      '/exams/{providerId}/{examKey}/questions': {
        get: {
          tags: ['Exams'],
          summary: 'Questions (server-enforced free/premium limits)',
          parameters: [
            { in: 'path', name: 'providerId', required: true, schema: { type: 'string' } },
            { in: 'path', name: 'examKey', required: true, schema: { type: 'string' } },
            { in: 'query', name: 'mode', schema: { type: 'string', enum: ['practice', 'mock', 'timed', 'random'] } },
            { in: 'query', name: 'limit', schema: { type: 'integer' } },
            { in: 'query', name: 'offset', schema: { type: 'integer' } },
          ],
          responses: { 200: ok('Questions'), 403: err('Quota exceeded') },
        },
      },
      '/exams/{providerId}/{examKey}/questions.pdf': {
        get: {
          tags: ['Exams'],
          summary: 'Download the full question bank as a PDF (full access required)',
          security: bearer,
          parameters: [
            { in: 'path', name: 'providerId', required: true, schema: { type: 'string' } },
            { in: 'path', name: 'examKey', required: true, schema: { type: 'string' } },
          ],
          responses: { 200: ok('PDF'), 401: err('Authentication required'), 403: err('Full exam access required') },
        },
      },
      '/attempts': { get: { tags: ['Attempts'], security: bearer, summary: 'List attempts', responses: { 200: ok('Attempts') } }, post: { tags: ['Attempts'], security: bearer, summary: 'Start attempt', responses: { 201: ok('Attempt started'), 403: err('Quota exceeded') } } },
      '/attempts/{id}': { get: { tags: ['Attempts'], security: bearer, summary: 'Attempt detail', responses: { 200: ok('Attempt'), 404: err('Not found') } } },
      '/attempts/{id}/complete': { post: { tags: ['Attempts'], security: bearer, summary: 'Submit and grade attempt', responses: { 200: ok('Results') } } },
      '/analytics/dashboard': { get: { tags: ['Progress'], security: bearer, summary: 'Dashboard aggregate', responses: { 200: ok('Dashboard') } } },
      '/analytics/weak-topics': { get: { tags: ['Progress'], security: bearer, summary: 'Weak topics', responses: { 200: ok('Weak topics') } } },
      '/analytics/performance': { get: { tags: ['Progress'], security: bearer, summary: 'Performance series', responses: { 200: ok('Series') } } },
      '/bookmarks': { get: { tags: ['Bookmarks'], security: bearer, summary: 'List bookmarks', responses: { 200: ok('Bookmarks') } }, post: { tags: ['Bookmarks'], security: bearer, summary: 'Add bookmark', responses: { 201: ok('Bookmarked') } } },
      '/notes': { get: { tags: ['Notes'], security: bearer, summary: 'List notes', responses: { 200: ok('Notes') } }, post: { tags: ['Notes'], security: bearer, summary: 'Upsert note', responses: { 201: ok('Note saved') } } },
      '/community/votes': { get: { tags: ['Community'], security: bearer, summary: 'Question vote totals', responses: { 200: ok('Vote summary') } }, post: { tags: ['Community'], security: bearer, summary: 'Cast or change a vote', responses: { 200: ok('Vote summary'), 400: err('Invalid option') } } },
      '/community/discussions': { get: { tags: ['Community'], security: bearer, summary: 'List threaded question comments', responses: { 200: ok('Comments') } }, post: { tags: ['Community'], security: bearer, summary: 'Post a comment or reply', responses: { 201: ok('Comment') } } },
      '/community/discussions/{id}': { patch: { tags: ['Community'], security: bearer, summary: 'Edit your comment', responses: { 200: ok('Comment'), 403: err('Forbidden') } }, delete: { tags: ['Community'], security: bearer, summary: 'Delete your comment', responses: { 200: ok('Deleted'), 403: err('Forbidden') } } },
      '/subscriptions/plans': { get: { tags: ['Subscriptions'], summary: 'Available plans', responses: { 200: ok('Plans') } } },
      '/subscriptions/me': { get: { tags: ['Subscriptions'], security: bearer, summary: 'Current subscription', responses: { 200: ok('Subscription') } } },
      '/subscriptions': { post: { tags: ['Subscriptions'], security: bearer, summary: 'Create subscription (mock checkout)', responses: { 201: ok('Subscribed'), 503: err('Payments disabled') } } },
      '/coupons/validate': { post: { tags: ['Coupons'], summary: 'Validate a coupon', responses: { 200: ok('Validation') } } },
      '/referrals/me': { get: { tags: ['Referrals'], security: bearer, summary: 'Referral stats', responses: { 200: ok('Referral stats') } } },
      '/notifications': { get: { tags: ['Notifications'], security: bearer, summary: 'List notifications', responses: { 200: ok('Notifications') } } },
      '/notifications/read': { post: { tags: ['Notifications'], security: bearer, summary: 'Mark notifications read', responses: { 200: ok('Updated') } } },
      '/leaderboard': { get: { tags: ['Leaderboard'], summary: 'Global leaderboard', responses: { 200: ok('Leaderboard') } } },
      '/ai/explain': { post: { tags: ['AI'], security: bearer, summary: 'AI explanation (premium)', responses: { 200: ok('Explanation'), 403: err('Premium required') } } },
      '/admin/stats': { get: { tags: ['Admin'], security: bearer, summary: 'Admin statistics', responses: { 200: ok('Stats'), 403: err('Forbidden') } } },
      '/admin/users': { get: { tags: ['Admin'], security: bearer, summary: 'List users', responses: { 200: ok('Users') } } },
      '/admin/settings': { get: { tags: ['Admin'], security: bearer, summary: 'Get settings', responses: { 200: ok('Settings') } }, patch: { tags: ['Admin'], security: bearer, summary: 'Update settings', responses: { 200: ok('Settings updated') } } },
      '/admin/dataset/sync': { post: { tags: ['Admin'], security: bearer, summary: 'Sync dataset catalog from GitHub', responses: { 200: ok('Sync result') } } },
      '/admin/catalog/providers': { get: { tags: ['Admin'], security: bearer, summary: 'List providers with visibility state', responses: { 200: ok('Providers') } } },
      '/admin/catalog/providers/{providerId}/exams': { get: { tags: ['Admin'], security: bearer, summary: 'List a provider\'s exams with visibility state', responses: { 200: ok('Exams') } } },
      '/admin/catalog/providers/{providerId}': { patch: { tags: ['Admin'], security: bearer, summary: 'Enable or disable an entire provider', responses: { 200: ok('Provider'), 404: err('Not found') } } },
      '/admin/catalog/exams/{providerId}/{examKey}': { patch: { tags: ['Admin'], security: bearer, summary: 'Enable or disable one exam', responses: { 200: ok('Exam'), 404: err('Not found') } } },
    },
    externalDocs: { url: `${publicWebUrl}/api/docs`, description: 'Full documentation' },
  };
}