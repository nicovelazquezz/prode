import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body de `PATCH /users/me`. Todos los campos son opcionales — el user
 * puede mandar solo lo que quiere cambiar. Validaciones:
 *
 *   - firstName / lastName: letras + espacios + tildes + ñ (es-AR + ES + PT
 *     americanos), apóstrofes (D'Angelo) y guiones (García-López).
 *     Mín 2 chars (excluyendo trim), máx 100. Trim lo aplica el service.
 *   - whatsapp: 10-15 dígitos (E.164-ish, sin "+" ni separadores).
 *     Igual al patrón de complete-registration.
 *   - whatsappOptIn: bool simple.
 *
 * Campos NO editables por el user (DNI, status, role, password):
 *   - DNI: identidad fiscal, requiere flow admin.
 *   - status / role: solo admin via PATCH /admin/users/:id.
 *   - password: flow propio en /auth/change-password.
 */
const NAME_REGEX = /^[A-Za-zÁÉÍÓÚáéíóúñÑüÜ' -]+$/;

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'firstName debe tener al menos 2 caracteres' })
  @MaxLength(100)
  @Matches(NAME_REGEX, {
    message:
      'firstName solo puede contener letras, espacios, tildes, ñ, apóstrofes y guiones',
  })
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'lastName debe tener al menos 2 caracteres' })
  @MaxLength(100)
  @Matches(NAME_REGEX, {
    message:
      'lastName solo puede contener letras, espacios, tildes, ñ, apóstrofes y guiones',
  })
  lastName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10,15}$/, {
    message: 'whatsapp debe ser 10-15 dígitos sin signos',
  })
  whatsapp?: string;

  @IsOptional()
  @IsBoolean()
  whatsappOptIn?: boolean;
}
