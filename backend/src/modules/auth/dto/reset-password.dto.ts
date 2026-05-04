import { IsString, Matches, MinLength } from 'class-validator';

/**
 * Body of `POST /auth/reset-password`.
 *
 * `token` is the plain value the user clicked on (we hash and look up).
 * `newPassword` enforces the same minimum quality as the public
 * registration flow: 8+ chars, must contain at least one digit.
 */
export class ResetPasswordDto {
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, {
    message: 'token must be a 64-character hex string',
  })
  token!: string;

  @IsString()
  @MinLength(8, { message: 'newPassword must be at least 8 characters' })
  @Matches(/\d/, { message: 'newPassword must contain at least one digit' })
  newPassword!: string;
}
