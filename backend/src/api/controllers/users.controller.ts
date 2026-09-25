import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { UserUseCases } from '../../application/use-cases/user.use-cases.js';
import { CreateUserDto } from '../dto/create-user.dto.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UserUseCases) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(@Body() input: CreateUserDto) {
    return this.users.create(input);
  }

  @Get(':id')
  getById(@Param('id', ParseIntPipe) id: number) {
    return this.users.getById(id);
  }
}
