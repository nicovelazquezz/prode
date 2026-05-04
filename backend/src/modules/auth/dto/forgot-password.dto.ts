import { Matches } from 'class-validator';

/**
 * Body of `POST /auth/forgot-password`. Only the DNI is required —
 * the user's WhatsApp number is fetched from the database.
 */
export class ForgotPasswordDto {
  @Matches(/^\d{7,8}$/, { message: 'dni must be 7 or 8 digits' })
  dni!: string;
}
