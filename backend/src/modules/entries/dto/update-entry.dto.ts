import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body of `PATCH /entries/:id`. Only `alias` is mutable in v1.1; any
 * other field would either invalidate scoring (entryId) or be a
 * privileged operation (status / position).
 *
 * Pass `alias: null` to clear the alias.
 */
export class UpdateEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  alias?: string | null;
}
