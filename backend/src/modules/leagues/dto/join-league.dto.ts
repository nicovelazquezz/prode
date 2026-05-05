import { IsOptional, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Body of `POST /leagues/join`. The invite code is a 6-char string drawn
 * from the unambiguous alphabet (A-HJ-NP-Z2-9). We accept lowercase from
 * forgiving clients and transform-to-uppercase up front so the regex can
 * stay simple, the service-side lookup is case-exact, and we never store
 * lowercase in audit logs.
 */
export class JoinLeagueDto {
  @IsString()
  // Trim whitespace then upper-case so "  abc123  " or "abc123" both
  // become "ABC123" before validation runs.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  // Mirrors the alphabet in `invite-code.ts` — strict so a malformed
  // code (with 0/O/1/I/L) is rejected at the DTO layer rather than
  // wasting a DB round-trip on a guaranteed miss.
  @Matches(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/, {
    message: 'inviteCode must be a 6-character code',
  })
  inviteCode!: string;

  /**
   * Multi-prode: which of the caller's entries joins the league.
   * Optional — when omitted, the service picks the caller's primary
   * ACTIVE entry. The frontend sends it explicitly when the user has
   * > 1 entry.
   */
  @IsOptional()
  @IsString()
  entryId?: string;
}
