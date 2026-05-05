import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Body of `POST /dev/simulate-webhook` (gated to NODE_ENV !== production
 * by the controller). The frontend uses this from its mock-checkout page
 * to drive the public payment flow end-to-end without hitting MercadoPago.
 *
 * `status` accepts the lower-case MP-style values the frontend already
 * knows from the real webhook contract; we map them to our domain enum
 * inside the controller so callers don't have to learn a second vocabulary.
 */
export class SimulateWebhookDto {
  @IsString()
  @MinLength(1)
  paymentId!: string;

  @IsIn(['approved', 'rejected', 'pending'])
  status!: 'approved' | 'rejected' | 'pending';

  @IsOptional()
  @IsEmail({}, { message: 'payerEmail must be a valid email if provided' })
  payerEmail?: string;
}
