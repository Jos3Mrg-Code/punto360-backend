import { Controller, Get, Post, Body, Put, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { ActiveUser } from '../auth/decorators/active-user.decorator';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

@Controller('users')
@UseGuards(PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Permissions('users.manage')
  findAll(@ActiveUser() user: ActiveUserData) {
    return this.usersService.findAll(user);
  }

  @Post()
  @Permissions('users.manage')
  create(@Body() dto: CreateUserDto, @ActiveUser() user: ActiveUserData) {
    return this.usersService.create(dto, user);
  }

  @Put(':id')
  @Permissions('users.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @ActiveUser() user: ActiveUserData,
  ) {
    return this.usersService.update(id, dto, user);
  }

  @Delete(':id')
  @Permissions('users.manage')
  remove(@Param('id') id: string, @ActiveUser() user: ActiveUserData) {
    return this.usersService.remove(id, user);
  }

  @Get('me')
  getMe(@ActiveUser() user: ActiveUserData) {
    return this.usersService.getMe(user.sub);
  }

  @Patch('me')
  updateMe(@ActiveUser() user: ActiveUserData, @Body() dto: any) {
    return this.usersService.updateMe(user.sub, dto);
  }

  @Patch('me/password')
  changePassword(@ActiveUser() user: ActiveUserData, @Body() dto: any) {
    return this.usersService.changePassword(user.sub, dto);
  }
}
