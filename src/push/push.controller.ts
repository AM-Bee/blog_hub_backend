import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/guards/jwt-auth.guard.js';
import { dtoValidationPipe } from '../common/validation.utils.js';
import { PushDevicesService } from './push-devices.service.js';
import {
  PushDeviceResponseDto,
  RegisterPushDeviceDto,
} from './dto/push-device.dto.js';

@ApiTags('push-devices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/push-devices')
export class PushController {
  constructor(
    @Inject(PushDevicesService) private readonly devices: PushDevicesService,
  ) {}
  @Put(':deviceId')
  @ApiOperation({
    summary:
      'Register this installation and Expo token for the authenticated session',
  })
  @ApiOkResponse({ type: PushDeviceResponseDto })
  register(
    @Param('deviceId', new ParseUUIDPipe()) deviceId: string,
    @Body(dtoValidationPipe(RegisterPushDeviceDto))
    input: RegisterPushDeviceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.devices.register(
      deviceId,
      input,
      request.user.id,
      request.sessionId,
    );
  }
  @Delete(':deviceId')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Unregister this installation only from the authenticated session; repeatable',
  })
  @ApiNoContentResponse()
  unregister(
    @Param('deviceId', new ParseUUIDPipe()) deviceId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.devices.unregister(
      deviceId,
      request.user.id,
      request.sessionId,
    );
  }
}
