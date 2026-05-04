import { IsString, Matches, MinLength } from 'class-validator';

/**
 * Body of `POST /auth/login`.
 *
 * `dni` is the Argentine national ID (7-8 digits, no formatting). We do
 * not check the verifier digit here; the lookup against `users.dni`
 * yields a 401 if no such user exists.
 */
export class LoginDto {
  @Matches(/^\d{7,8}$/, { message: 'dni must be 7 or 8 digits' })
  dni!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
