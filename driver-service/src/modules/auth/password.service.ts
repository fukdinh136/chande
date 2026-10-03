import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { compare, hash } from 'bcryptjs';

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    if (Buffer.byteLength(password, 'utf8') > 72) {
      throw new BadRequestException(
        'Password must not exceed 72 bytes',
      );
    }

    return hash(password, 12);
  }

  async verify(
    password: string,
    passwordHash: string,
  ): Promise<boolean> {
    if (Buffer.byteLength(password, 'utf8') > 72) {
      return false;
    }

    return compare(password, passwordHash);
  }
}