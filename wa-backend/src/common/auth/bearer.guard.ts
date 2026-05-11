import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { ENV_TOKEN, type Env } from '../../config/env.js';

@Injectable()
export class BearerGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(@Inject(ENV_TOKEN) env: Env) {
    this.expected = Buffer.from(env.WA_API_TOKEN, 'utf8');
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>();
    const header = req.headers.authorization;
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing or invalid Bearer token');
    }
    const token = Buffer.from(header.slice(7).trim(), 'utf8');
    if (token.length !== this.expected.length) {
      throw new UnauthorizedException('Missing or invalid Bearer token');
    }
    if (!timingSafeEqual(token, this.expected)) {
      throw new UnauthorizedException('Missing or invalid Bearer token');
    }
    return true;
  }
}
