import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PrimaryUser, PrimaryUserDocument } from '../schemas';
import { Model } from 'mongoose';
import * as argon2 from 'argon2';
import { IResponse } from 'src/interfaces';
import {
  CreatePrimaryUserDto,
  UpdatePrimaryUserDto,
  searchUserDto,
} from '../dto';
import { welcomeMail } from 'src/templates/mails';
import { DospacesService } from 'src/dospaces/dospaces.service';
import { Throttle } from '@nestjs/throttler';
import { HelperFn } from 'src/common/helpers/helper-fn';

@Throttle({ default: { limit: 5, ttl: 60000 } })
@Injectable()
export class PrimaryUserService {
  private readonly logger = new Logger(PrimaryUserService.name);
  constructor(
    @InjectModel(PrimaryUser.name)
    private primaryUserModel: Model<PrimaryUserDocument>,
    private readonly doSpacesService: DospacesService,
  ) {}

  async findUserByEmail(email: string): Promise<IResponse> {
    this.logger.log(`lookup user with email: [${email}]...`);
    let response: IResponse;

    try {
      const user = await this.primaryUserModel.findOne({ email });

      if (!user) {
        return (response = {
          statusCode: 404,
          message: `no user found with email`,
          data: null,
          error: {
            code: 'user_not_found',
            message: `user with email ${email} not found`,
          },
        });
      } else {
        return (response = {
          statusCode: 200,
          message: `user fetched successfully`,
          data: user,
          error: null,
        });
      }
    } catch (err) {
      this.logger.error(
        `an error occur fetching user with email: [${email}]` +
          JSON.stringify(err, null, 2),
      );

      return (response = {
        statusCode: 400,
        message: `error fetching user with email: [${email}]`,
        data: null,
        error: {
          code: 'user_by_email_fetch_failed',
          message:
            `an unexpected error occurred while processing the request: error ` +
            JSON.stringify(err, null, 2),
        },
      });
    }
  }

  async getUserById(userId: any): Promise<IResponse> {
    this.logger.log(`lookup user with id: [${userId}]...`);
    let response: IResponse;

    try {
      const user = await this.primaryUserModel.findOne({ _id: userId });

      if (!user) {
        return (response = {
          statusCode: 404,
          message: `invalid id: user does not exist`,
          data: null,
          error: {
            code: 'user_not_found',
            message: `user with id ${userId} not found`,
          },
        });
      } else {
        user.password = null;
        return (response = {
          statusCode: 200,
          message: `user fetched successfully`,
          data: user,
          error: null,
        });
      }
    } catch (err) {
      console.log(err);

      this.logger.error(
        `an error occur fetching user with id: [${userId}]` +
          JSON.stringify(err, null, 2),
      );

      return (response = {
        statusCode: 400,
        message: `error fetching user with id: [${userId}]`,
        data: null,
        error: {
          code: 'user_by_id_fetch_failed',
          message:
            `an unexpected error occurred while processing the request: error ` +
            JSON.stringify(err, null, 2),
        },
      });
    }
  }

  async searchUser(searchUserDto: searchUserDto) {
    const { searchText } = searchUserDto;

    try {
      const user = await this.primaryUserModel.find({
        $or: [{ email: searchText }, { userName: searchText }],
      });

      if (user.length === 0) {
        return <IResponse>{
          statusCode: 404,
          message: `no user found with this record: ${searchText}`,
          data: null,
          error: {
            code: 'user_not_found',
            message: `user with [${searchText}] not found`,
          },
        };
      }

      const { _id, fullName, userName, profilePic, phone } = user[0];
      const safeUser = { _id, fullName, userName, profilePic, phone };
      return <IResponse>{
        statusCode: 200,
        message: `user with [${searchText}] retrived successfully`,
        data: safeUser,
        error: null,
      };
    } catch (err) {
      console.log(err);

      this.logger.error(
        `an error occur searching user` + JSON.stringify(err, null, 2),
      );

      return <IResponse>{
        statusCode: 400,
        message: `error searching user`,
        data: null,
        error: {
          code: 'user_search_failed',
          message:
            `an unexpected error occurred while processing the request: error ` +
            JSON.stringify(err, null, 2),
        },
      };
    }
  }

  async signup(createPrimaryUserDto: CreatePrimaryUserDto): Promise<IResponse> {
    const { email, password, fullName } = createPrimaryUserDto;

    let isUniquePhone = false;
    if (createPrimaryUserDto.phone) {
      const userWithPhone = await this.validatePhone(
        createPrimaryUserDto.phone,
      );

      isUniquePhone = userWithPhone.data;
    }
    console.log('IS_UNIQUE_PHONE', isUniquePhone);

    if (!isUniquePhone) {
      return <IResponse>{
        statusCode: 400,
        message: `user with this phone number already exist`,
        data: null,
        error: {
          code: 'phone_already_exist',
          message: `user with phone ${createPrimaryUserDto.phone} already exist`,
        },
      };
    } else {
      // TODO: Generate OTP and send via mail or SMS (if this is enabled, then stop login token generation)

      try {
        this.logger.log(`creating new user...`);
        const newUser = await this.primaryUserModel.create({
          ...createPrimaryUserDto,
          password: await argon2.hash(password),
        });

        await welcomeMail.mail(email, fullName);
        const tokens = HelperFn.signJwtToken(newUser._id);

        newUser.password = undefined;
        return <IResponse>{
          statusCode: 201,
          message: 'user created successfully',
          data: tokens,
          error: null,
        };
      } catch (err) {
        console.log(err);

        this.logger.error(
          `error creating new user: ` + JSON.stringify(err, null, 2),
        );

        return <IResponse>{
          statusCode: 400,
          message: 'user creation failed',
          data: null,
          error: {
            code: 'user_create_failed',
            message:
              `an unexpected error occurred while processing the request: error ` +
              JSON.stringify(err, null, 2),
          },
        };
      }
    }
  }

  async updateUser(userId: any, updatePrimaryUserDto: UpdatePrimaryUserDto) {
    let response: IResponse;

    let validatePhoneUnique: PrimaryUserDocument;
    if (updatePrimaryUserDto.phone) {
      validatePhoneUnique = await this.primaryUserModel.findOne({
        phone: updatePrimaryUserDto.phone,
      });
    }

    if (validatePhoneUnique) {
      return (response = {
        statusCode: 400,
        message: 'phone number already exists',
        data: null,
        error: null,
      });
    }

    try {
      const user = await this.getUserById(userId);
      if (!user.data || user.data === null) {
        return (response = user);
      }

      if (updatePrimaryUserDto.password) {
        updatePrimaryUserDto.password = await argon2.hash(
          updatePrimaryUserDto.password,
        );
      }

      const updated = await this.primaryUserModel.findOneAndUpdate(
        { _id: userId },
        { $set: updatePrimaryUserDto },
        { new: true },
      );

      updated.password = null;
      return (response = {
        statusCode: 200,
        message: 'user updated successfully',
        data: updated,
        error: null,
      });
    } catch (err) {
      console.log(err);

      this.logger.error(`error updating user: ` + JSON.stringify(err, null, 2));

      return (response = {
        statusCode: 400,
        message: 'user update failed',
        data: null,
        error: {
          code: 'user_update_failed',
          message:
            `an unexpected error occurred while processing the request: error ` +
            JSON.stringify(err, null, 2),
        },
      });
    }
  }

  async validateEmail(email: string): Promise<IResponse> {
    this.logger.log(`validating email is unique: [${email}]...`);

    try {
      const isUniqueMail = await this.primaryUserModel.findOne({ email });

      if (!isUniqueMail) {
        return <IResponse>{
          statusCode: 200,
          message: `email valid`,
          data: true,
          error: null,
        };
      } else {
        return <IResponse>{
          statusCode: 409,
          message: `user with this mail already exists`,
          data: false,
          error: null,
        };
      }
    } catch (err) {
      this.logger.error(
        `an error occur validating email: [${email}]` +
          JSON.stringify(err, null, 2),
      );

      return <IResponse>{
        statusCode: 400,
        message: `error validating email: [${email}]`,
        data: null,
        error: {
          code: 'email_validation_failed',
          message: `an unexpected error occurred while processing the request`,
          error: JSON.stringify(err, null, 2),
        },
      };
    }
  }

  private async validatePhone(phone: string): Promise<IResponse> {
    this.logger.log(`validating phone is unique: [${phone}]...`);

    try {
      const isUniquePhone = await this.primaryUserModel.findOne({ phone });

      if (!isUniquePhone) {
        return <IResponse>{
          statusCode: 200,
          message: `phone valid`,
          data: true,
          error: null,
        };
      } else {
        return <IResponse>{
          statusCode: 409,
          message: `user with this phone already exists`,
          data: false,
          error: null,
        };
      }
    } catch (err) {
      this.logger.error(
        `an error occur validating phone number: [${phone}]` +
          JSON.stringify(err, null, 2),
      );

      return <IResponse>{
        statusCode: 400,
        message: `error validating phone number: [${phone}]`,
        data: null,
        error: {
          code: 'phone_validation_failed',
          message: `an unexpected error occurred while processing the request`,
          error: JSON.stringify(err, null, 2),
        },
      };
    }
  }

  async validateUserName(userName: string): Promise<IResponse> {
    let response: IResponse;

    try {
      const isValidUserName = await this.primaryUserModel.findOne({ userName });

      if (!isValidUserName) {
        return (response = {
          statusCode: 200,
          message: `username available`,
          data: true,
          error: null,
        });
      }
      return (response = {
        statusCode: 409,
        message: `username taken`,
        data: false,
        error: null,
      });
    } catch (err) {
      console.log(err);

      this.logger.error(
        `an error occur while verifying username: [${userName}]` +
          JSON.stringify(err, null, 2),
      );

      return (response = {
        statusCode: 400,
        message: `error validating username: [${userName}]`,
        data: null,
        error: {
          code: 'username_verify_failed',
          message:
            `an unexpected error occurred while processing the request: error ` +
            JSON.stringify(err, null, 2),
        },
      });
    }
  }
}
