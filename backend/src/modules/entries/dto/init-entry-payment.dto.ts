import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body of `POST /entries/init-payment` (logged-in flow). Spec §3.2.
 *
 * `alias` is the optional human label for the new entry ("Mi prode
 * optimista"). Persisted on the Payment row until the webhook promotes
 * it into the created Entry.
 */
export class InitEntryPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  alias?: string;
}
