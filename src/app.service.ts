import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }
  getGreet(): { message: string } {
    return {'message': 'Greetings from the AppService!'};
  }
}
