import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/, { message: 'to must be E.164 (8–15 digits)' })
  to!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  message!: string;
}
