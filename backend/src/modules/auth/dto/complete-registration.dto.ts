import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { normalizeArgentinePhone } from '../../../shared/utils/normalize-phone.js';

/**
 * Body of `POST /auth/complete-registration`. Validates with class-validator
 * exactly the constraints listed in spec section 6.1 step 9 + 8.4:
 *   - DNI: 7-8 digits, no separators
 *   - whatsapp: 10-15 digits (E.164-ish, no leading +)
 *   - password: min 8 chars and contains at least one digit
 */
export class CompleteRegistrationDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

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
   * Min length 8 + must contain at least one digit. Stronger checks
   * (uppercase, symbols, breached-password lookup) are out of scope for
   * MVP — the cliente has explicitly opted for the lower bar.
   */
  @IsString()
  @MinLength(8)
  @Matches(/\d/, { message: 'password must contain at least one digit' })
  password!: string;
}
