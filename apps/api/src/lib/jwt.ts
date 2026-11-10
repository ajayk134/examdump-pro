import { SignJWT, jwtVerify } from 'jose';
import { unauthorized } from './errors.js';

export interface AccessTokenClaims {
  sub: string;
  role: 'user' | 'admin';
  plan: 'free' | 'premium';
  sid: string;
}

const encoder = new TextEncoder();

export async function signAccessToken(
  claims: AccessTokenClaims,
  secret: string,
  ttl: string,
): Promise<string> {
  return new SignJWT({ role: claims.role, plan: claims.plan, sid: claims.sid, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('examdump-pro')
    .setAudience('examdump-web')
    .setExpirationTime(ttl)
    .sign(encoder.encode(secret));
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), {
      issuer: 'examdump-pro',
      audience: 'examdump-web',
    });
    if (payload.typ !== 'access' || !payload.sub || !payload.sid) {
      throw new Error('invalid token payload');
    }
    return {
      sub: payload.sub,
      role: (payload.role as 'user' | 'admin') ?? 'user',
      plan: (payload.plan as 'free' | 'premium') ?? 'free',
      sid: payload.sid as string,
    };
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
}