# Error handling

One error shape, one handler, no leaked internals.

## The envelope

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "The submitted data is invalid.",
             "details": [{ "path": "email", "message": "Invalid email" }] } }
```

`code` is stable and machine-readable; `message` is human-readable; `details` is
optional and used for field-level validation.

## Handler

`apps/api/src/app.ts:117` — `setErrorHandler`, registered **before** route plugins
so every child route inherits it. Order of matching:

| Error | Status | Code |
| --- | --- | --- |
| `AppError` | its `statusCode` | its `code` |
| `DatasetError` | 404 or 502 | dataset error code |
| `ZodError` | 400 | `VALIDATION_ERROR` + `details` |
| `statusCode === 429` | 429 | `RATE_LIMITED` |
| other 4xx | as-is | `BAD_REQUEST` by default |
| anything else | 500 | `INTERNAL_ERROR`, logged, **no stack to client** |

## Throwing

Use helpers in `apps/api/src/lib/errors.ts` — `badRequest`, `unauthorized`,
`forbidden`, `notFound`, `conflict`, `unauthorized`, etc. Never return a bare
string, never construct a response shape by hand.

```ts
import { notFound } from '../lib/errors.js';
if (!order) throw notFound('Order not found');
```

## Client-facing messages

- Never include a stack, SQL, file path or internal identifier.
- Never echo a secret-bearing value back.
- Say what the caller can do next.
- 404 rather than 403 for another user's resource, so existence is not confirmed.

## Logging

Only `INTERNAL_ERROR` logs with `request.log.error({ err }, 'unhandled_error')`.
Logging on every 4xx would be noise.

**Pino redaction is not configured globally.** Do not log request bodies on auth,
payment or UPI ingest routes — they contain credentials or bank details.

## Frontend

Client code must handle 401 by refreshing the token, and must render `error.message`.
Never show a success state on a failed request. See [UI_UX.md](UI_UX.md).

## Related

- [API](API.md)
- [Logging](docs/operations/LOGGING.md)
- [Troubleshooting](docs/operations/TROUBLESHOOTING.md)
