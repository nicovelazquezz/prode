import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { normalizeArgentinePhone } from '../../../shared/utils/normalize-phone.js';

/**
 * Body de `PATCH /admin/users/:id`. Todos los campos son opcionales —
 * el admin puede actualizar uno o varios. Las validaciones espejan
 * `CreateManualUserDto` y `complete-registration.dto.ts` para que un
 * user editado por el admin termine en el mismo shape que un user
 * creado por flujo público.
 *
 * `dni` y `password` no se editan acá:
 *   - DNI: cambiarlo rompería el audit trail e identidad. Si hay que
 *     migrarlo, hacer en SQL con auditoría manual.
 *   - Password: hay un endpoint dedicado (`POST /admin/users/:id/reset-password`)
 *     que devuelve la nueva al admin para comunicársela al user.
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10,15}$/, { message: 'whatsapp must be 10-15 digits' })
  whatsapp?: string;

  @IsOptional()
  @IsEnum(['ACTIVE', 'INACTIVE', 'BANNED'], {
    message: 'status must be ACTIVE, INACTIVE, or BANNED',
  })
  status?: 'ACTIVE' | 'INACTIVE' | 'BANNED';

  @IsOptional()
  @IsEnum(['USER', 'ADMIN'], { message: 'role must be USER or ADMIN' })
  role?: 'USER' | 'ADMIN';
}
