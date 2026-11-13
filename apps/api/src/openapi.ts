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
      { name: 'UPI' },
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
      '/attempts': { get: { tags: ['Attempts'], security: bearer, summary: 'List attempts', responses: { 200: ok('Attempts') } }, post: { tags: ['Attempts'], security: bearer, summary: 'Start attempt', responses: { 201: ok('Attempt started'), 403: err('Quota exceeded') } } },
      '/attempts/{id}': { get: { tags: ['Attempts'], security: bearer, summary: 'Attempt detail', responses: { 200: ok('Attempt'), 404: err('Not found') } } },
      '/attempts/{id}/complete': { post: { tags: ['Attempts'], security: bearer, summary: 'Submit and grade attempt', responses: { 200: ok('Results') } } },
      '/analytics/dashboard': { get: { tags: ['Progress'], security: bearer, summary: 'Dashboard aggregate', responses: { 200: ok('Dashboard') } } },
      '/analytics/weak-topics': { get: { tags: ['Progress'], security: bearer, summary: 'Weak topics', responses: { 200: ok('Weak topics') } } },
      '/analytics/performance': { get: { tags: ['Progress'], security: bearer, summary: 'Performance series', responses: { 200: ok('Series') } } },
      '/bookmarks': { get: { tags: ['Bookmarks'], security: bearer, summary: 'List bookmarks', responses: { 200: ok('Bookmarks') } }, post: { tags: ['Bookmarks'], security: bearer, summary: 'Add bookmark', responses: { 201: ok('Bookmarked') } } },
      '/notes': { get: { tags: ['Notes'], security: bearer, summary: 'List notes', responses: { 200: ok('Notes') } }, post: { tags: ['Notes'], security: bearer, summary: 'Upsert note', responses: { 201: ok('Note saved') } } },
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
      /*
       * UPI. These are documented because the checkout and the SMS bridge are
       * external consumers: the browser polls the order status and a handset
       * posts notifications, so both need a stable, published contract.
       */
      '/upi/status': {
        get: {
          tags: ['UPI'],
          summary: 'Is UPI collection configured, and how are payments confirmed',
          responses: { 200: ok('UPI availability') },
        },
      },
      '/upi/orders': {
        post: {
          tags: ['UPI'],
          security: bearer,
          summary: 'Start a UPI checkout and receive a QR for a unique amount',
          responses: {
            200: ok('Order with server-rendered QR and app intents'),
            400: err('UPI unavailable or the plan has no amount due'),
            401: err('Unauthorized'),
          },
        },
      },
      '/upi/orders/active': {
        get: {
          tags: ['UPI'],
          security: bearer,
          summary: "The caller's live order, if any",
          responses: { 200: ok('Order or null'), 401: err('Unauthorized') },
        },
      },
      '/upi/orders/{id}': {
        get: {
          tags: ['UPI'],
          security: bearer,
          summary: 'Poll one order',
          description:
            '`status` is customer-facing: pending, processing, paid, expired or cancelled. ' +
            '`processing` means a matching credit was seen and is being verified.',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: ok('Order'), 401: err('Unauthorized'), 404: err('Not found') },
        },
      },
      '/upi/orders/{id}/cancel': {
        post: {
          tags: ['UPI'],
          security: bearer,
          summary: 'Abandon an order',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: ok('Cancelled'), 401: err('Unauthorized'), 404: err('Not found') },
        },
      },
      '/upi/ingest/sms': {
        post: {
          tags: ['UPI'],
          summary: 'SMS bridge ingest',
          description:
            'Authenticated by `X-UPI-Signature`, an HMAC-SHA256 over the raw request body ' +
            'bound to the `X-UPI-Timestamp` header. Never authenticates a request without ' +
            'the exact signed bytes. Cannot mark an order paid directly.',
          responses: {
            200: ok('Accepted (whether it matched is not disclosed)'),
            400: err('Oversized body or unusable timestamp'),
            401: err('Not configured or signature verification failed'),
          },
        },
      },
      '/upi/ingest/notification': {
        post: {
          tags: ['UPI'],
          summary: 'Generic notification relay ingest',
          description: 'Same authentication and matching rules as `/upi/ingest/sms`.',
          responses: {
            200: ok('Accepted'),
            400: err('Oversized body or unusable timestamp'),
            401: err('Not configured or signature verification failed'),
          },
        },
      },
      '/admin-ops/upi/config': {
        get: {
          tags: ['UPI'],
          summary: 'Read UPI gateway settings',
          description:
            'Requires `payments.read`. Returns the payee, the three switches, Gmail connection state and the source of each value (`db`, `env` or `unset`). No credential is ever returned; presence is reported as booleans.',
          responses: { 200: ok('Current configuration'), 401: err('Unauthorized'), 403: err('Missing payments.read') },
        },
        patch: {
          tags: ['UPI'],
          summary: 'Update the merchant UPI ID',
          description: 'Requires `payments.manage`. Rejects a malformed UPI ID with a message the UI can show directly.',
          responses: { 200: ok('Saved'), 400: err('Invalid UPI ID'), 403: err('Missing payments.manage') },
        },
      },
      '/admin-ops/upi/config/switches': {
        patch: {
          tags: ['UPI'],
          summary: 'Toggle payment acceptance, the observer, or automatic approval',
          description:
            'Requires `payments.manage`. Payment collection is refused while no valid payee is configured; the observer cannot be enabled without a stored Gmail connection; `autoApprove: true` additionally requires `confirm: "CONFIRM"` and a connected observer.',
          responses: {
            200: ok('Saved'),
            400: err('Payee, connection or confirmation requirement not met'),
            403: err('Missing payments.manage'),
          },
        },
      },
      '/admin-ops/upi/config/payee/validate': {
        post: {
          tags: ['UPI'],
          summary: 'Check a UPI ID without saving it',
          description:
            'Requires `payments.manage`. Format validation only: confirming that money reaches a UPI ID needs a real transfer, which this deliberately does not attempt.',
          responses: { 200: ok('{valid, message}'), 403: err('Missing payments.manage') },
        },
      },
      '/admin-ops/upi/config/gmail/start': {
        post: {
          tags: ['UPI'],
          summary: 'Begin the Gmail OAuth handshake',
          description:
            'Requires `payments.manage`. Returns the Google consent URL for scope `gmail.readonly` plus the exact redirect URI that must be registered on the OAuth client. Refused when `UPI_SECRETS_KEY` is not configured, because the result could not be stored securely.',
          responses: { 200: ok('{url, redirectUri, scope}'), 400: err('Credential storage unavailable'), 403: err('Missing payments.manage') },
        },
      },
      '/admin-ops/upi/config/gmail/callback': {
        get: {
          tags: ['UPI'],
          summary: 'Google OAuth redirect target',
          description:
            'Reached by the browser, so it does not require an admin session. Security is the single-use, admin-bound `state` parameter (32 random bytes, ten minute expiry). Always redirects to the dashboard with `?gmail=connected|denied|bad_state|failed`.',
          responses: { 302: { description: 'Redirect to the admin dashboard with an outcome' } },
        },
      },
      '/admin-ops/upi/config/gmail/test': {
        post: {
          tags: ['UPI'],
          summary: 'Verify the stored Gmail credentials',
          description:
            'Requires `payments.manage`. Mints an access token and lists one message, which proves the granted scope is sufficient rather than merely that the token exists.',
          responses: { 200: ok('{ok, message, email}'), 400: err('No connection stored'), 403: err('Missing payments.manage') },
        },
      },
      '/admin-ops/upi/config/gmail': {
        delete: {
          tags: ['UPI'],
          summary: 'Disconnect the payment mailbox',
          description:
            'Requires `payments.manage`. Revokes the refresh token at Google, then clears the stored credentials and the observer and automatic-approval switches.',
          responses: { 200: ok('{ok, revokedAtGoogle, message}'), 403: err('Missing payments.manage') },
        },
      },
    },
    externalDocs: { url: `${publicWebUrl}/api/docs`, description: 'Full documentation' },
  };
}