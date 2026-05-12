import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { normalizeArgentinePhone } from '../../../shared/utils/normalize-phone.js';

/**
 * Methods accepted by the admin-manual user creation flow. MERCADOPAGO is
 * intentionally excluded — manual creation is for users who paid offline
 * (cash, bank transfer). MP-paid users go through `/payments/init` so the
 * webhook flow generates the magic link and the audit trail records the
 * MercadoPago id.
 */
export type ManualPaymentMethod = 'CASH' | 'TRANSFER';

const MANUAL_METHODS: ManualPaymentMethod[] = ['CASH', 'TRANSFER'];

/**
 * Body of `POST /admin/users`. Mirrors the constraints from
 * `complete-registration.dto.ts` so a manually-created user has the exact
 * same shape as a public-flow user — there's no second-class citizen for
 * search, leaderboard, or auth.
 */
export class CreateManualUserDto {
  @IsString()
  @Matches(/^\d{7,8}$/, { message: 'dni must be 7-8 digits' })
  dni!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @IsString()
  @Transform(({ value }) => normalizeArgentinePhone(value))
  @Matches(/^\d{10,15}$/, { message: 'whatsapp must be 10-15 digits' })
  whatsapp!: string;

  /**
   * Same min-length-8 + at-least-one-digit rule as the public flow. The
   * admin types this on the user's behalf and tells them out-of-band; the
   * user can change it via the standard reset-password flow afterwards.
   */
  @IsString()
  @MinLength(8)
  @Matches(/\d/, { message: 'password must contain at least one digit' })
  password!: string;

  @IsEnum(MANUAL_METHODS, {
    message: `paymentMethod must be one of: ${MANUAL_METHODS.join(', ')}`,
  })
  paymentMethod!: ManualPaymentMethod;

  /**
   * Inscription amount in ARS (cents-free integer; matches the seed
   * `inscripcion_precio` default of 15000). The admin can override the
   * standard amount for special cases (e.g. half-price for a co-organiser).
   */
  @IsInt()
  @IsPositive()
  amount!: number;

  /**
   * Free-text identifier of who collected the cash / received the wire
   * — written into `Payment.receivedBy` for the audit trail. Optional
   * because the admin may not always know (e.g. cash dropped at the
   * club office).
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  receivedBy?: string;

  /**
   * Free-text notes (envelope number, transfer reference, etc). Stored
   * on the Payment row for later operator lookup.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
