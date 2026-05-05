import { IsString, Matches, MinLength } from 'class-validator';

/**
 * Body of `POST /auth/change-password` (auth required).
 *
 * `newPassword` enforces the same minimum quality as the public
 * registration and reset flows: 8+ characters, must contain at least one
 * digit. The current password is just a non-empty string — the service
 * validates it against the stored bcrypt hash; explicit length / digit
 * checks would only leak whether an account ever had a strong password.
 */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'currentPassword must not be empty' })
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: 'newPassword must be at least 8 characters' })
  @Matches(/\d/, { message: 'newPassword must contain at least one digit' })
  newPassword!: string;
}
