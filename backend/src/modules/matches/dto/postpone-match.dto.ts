import { IsDateString } from 'class-validator';

/**
 * Body of `POST /admin/matches/:id/postpone`. The new kickoff must be a
 * valid ISO 8601 timestamp; the service rejects values that are not
 * strictly in the future.
 */
export class PostponeMatchDto {
  @IsDateString()
  newKickoffAt!: string;
}
