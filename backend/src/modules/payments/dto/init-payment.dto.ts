import { IsOptional, IsString } from 'class-validator';

/**
 * Body of `POST /payments/init`. The Turnstile token is optional for now
 * (the real verifier lands in Phase 12); kept in the DTO so the contract
 * is stable from Phase 5 onward.
 */
export class InitPaymentDto {
  @IsOptional()
  @IsString()
  turnstileToken?: string;
}
