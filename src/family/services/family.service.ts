import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import {
  Family,
  FamilyDocument,
  FamilyMember,
  FamilyMemberDocument,
} from '../schemas';
import { PrimaryUser, PrimaryUserDocument } from 'src/users/schemas';
import { PrimaryUserService } from 'src/users/services';
import {
  CreateFamilyDto,
  FamilyTypeUiqueValidateDto,
  JoinFamilyDto,
  QueryFamiliesDto,
  SearchFamilyDto,
} from '../dto';
import { IResponse } from 'src/interfaces';
import { generateJoinLink } from 'src/common/utils';
import { HelperFn } from 'src/common/helpers/helper-fn';
import { topLevelFamilyRelations } from '../types';
import { FamilyRelationshipValidateDto } from '../dto/family-relationship-validate.dto';

const expectedParentKeys = [
  'newParentRelationship',
  'newParentFullName',
  'newParentGender',
  // 'newParentDob',
];

@Injectable()
export class FamilyService {
  private readonly logger = new Logger(FamilyService.name);
  constructor(
    @InjectModel(Family.name)
    private familyModel: Model<FamilyDocument>,
    @InjectModel(PrimaryUser.name)
    private primaryUserModel: Model<PrimaryUserDocument>,
    @InjectModel(FamilyMember.name)
    private familyMemberModel: Model<FamilyMemberDocument>,
    private readonly primaryUserService: PrimaryUserService,
  ) {}

  async createFamily(createFamilyDto: CreateFamilyDto): Promise<IResponse> {
    let response: IResponse;
    let newFamily: FamilyDocument;

    const familyUserName = `${
      createFamilyDto.familyName
    }${HelperFn.generateRandomNumber(3)}`;

    if (createFamilyDto.familyCoverImage) {
      this.logger.log(`handling file upload...`);
    }

    try {
      if (createFamilyDto.root) {
        /* 
        TODO?:Edge Case:
          if creator is root in say family A, check to make sure the person they're selecting as root 
          isn't already a member of thesame family A, if so, let them know this.
          PS: should probably be the first thing to do.
        */

        this.logger.log(
          `validating user selected as root isn't already root on another family...`,
        );
        const isSelectedRootAlreadyRooted = await this.primaryUserModel
          .findOne({ _id: createFamilyDto.root, role: 'root' })
          .populate({
            path: 'familyRootedTo',
            select: 'familyName familyUsername',
          });

        if (isSelectedRootAlreadyRooted) {
          return (response = {
            statusCode: 400,
            message: `user selectd as root is already a root in ${isSelectedRootAlreadyRooted.familyRootedTo.familyName} family, consider joining the family instead`,
            data: {
              familyUserName:
                isSelectedRootAlreadyRooted.familyRootedTo.familyUsername,
            },
            error: null,
          });
        }

        // create new family members document for both root and creator
        const initFamilyMembers = await this.familyMemberModel.insertMany([
          {
            relationshipToRoot: 'root',
            familyUsername: familyUserName,
            familyType: createFamilyDto.familyType,
            user: createFamilyDto.root,
          },
          {
            relationshipToRoot: createFamilyDto.relationshipToRoot,
            familyUsername: familyUserName,
            familyType: createFamilyDto.familyType,
            user: createFamilyDto.creator,
          },
        ]);

        this.logger.log(
          `creating new family with an existing family tree user as root...`,
        );
        newFamily = await this.familyModel.create({
          ...createFamilyDto,
          familyUsername: familyUserName,
          members: [initFamilyMembers[0]._id, initFamilyMembers[1]._id],
          familyJoinLink: generateJoinLink(
            familyUserName,
            createFamilyDto.state,
          ),
        });

        // update family members with family id
        await this.familyMemberModel.updateMany(
          { familyUsername: familyUserName },
          { $set: { family: newFamily._id } },
        );

        // TODO? add family array to user model and update for both root and creator here
        this.logger.log(`updating role of user selected as root to "root"`);
        await this.primaryUserService.updateUser(createFamilyDto.root, {
          role: 'root',
          familyRootedTo: newFamily._id,
        });

        if (
          expectedParentKeys.every((element) =>
            Object.keys(createFamilyDto).includes(element),
          )
        ) {
          this.logger.log(
            `creating new inactive parent record for non-first generational family member`,
          );

          const newInActiveParent = await this.primaryUserModel.create({
            creator: new mongoose.Types.ObjectId(createFamilyDto.creator),
            fullName: createFamilyDto.newParentFullName,
            gender: createFamilyDto.newParentGender,
            userName: `${createFamilyDto.newParentFullName
              .replace(/\s+/g, '')
              .substring(0, 4)}${HelperFn.generateRandomNumber(3)}`,
            isActive: false,
          });

          await this.familyMemberModel.findOneAndUpdate(
            { user: new mongoose.Types.ObjectId(createFamilyDto.creator) },
            { $set: { parent: newInActiveParent._id } },
          );
        }

        return (response = {
          statusCode: 201,
          message: `${createFamilyDto.familyName} family created successfully`,
          data: newFamily,
          error: null,
        });
      } else {
        this.logger.log(`creating new family with a new user as root`);

        let newInActiveParent;
        if (
          expectedParentKeys.every((element) =>
            Object.keys(createFamilyDto).includes(element),
          )
        ) {
          this.logger.log(
            `creating new inactive parent record for non-first generational family member`,
          );

          newInActiveParent = await this.primaryUserModel.create({
            creator: new mongoose.Types.ObjectId(createFamilyDto.creator),
            fullName: createFamilyDto.newParentFullName,
            gender: createFamilyDto.newParentGender,
            userName: `${createFamilyDto.newParentFullName
              .replace(/\s+/g, '')
              .substring(0, 4)}${HelperFn.generateRandomNumber(3)}`,
            isActive: false,
          });

          await this.familyMemberModel.findOneAndUpdate(
            { user: new mongoose.Types.ObjectId(createFamilyDto.creator) },
            { $set: { parent: newInActiveParent._id } },
          );
        }

        this.logger.log(`creating the root...`);
        const newRoot = await this.primaryUserModel.create({
          creator: new mongoose.Types.ObjectId(createFamilyDto.creator),
          fullName: createFamilyDto.newRootFullName,
          userName: createFamilyDto.newRootUserName,
          role: 'root',
          isActive: false,
        });

        // create a new family member document
        const initFamilyMembers = await this.familyMemberModel.insertMany([
          {
            relationshipToRoot: 'root',
            familyUsername: familyUserName,
            user: newRoot._id,
          },
          {
            relationshipToRoot: createFamilyDto.relationshipToRoot,
            familyUsername: familyUserName,
            user: createFamilyDto.creator,
            parent: newInActiveParent._id,
          },
        ]);

        this.logger.log(`creating the family...`);
        newFamily = await this.familyModel.create({
          ...createFamilyDto,
          root: newRoot._id,
          familyUsername: familyUserName,
          members: [initFamilyMembers[0]._id, initFamilyMembers[1]._id],
          familyJoinLink: generateJoinLink(
            familyUserName,
            createFamilyDto.state,
          ),
        });

        // update family members with family id
        await this.familyMemberModel.updateMany(
          { familyUsername: familyUserName },
          { $set: { family: newFamily._id } },
        );

        // update newly created root with the id of the family they are root to
        await this.primaryUserService.updateUser(newRoot._id, {
          familyRootedTo: newFamily._id,
        });

        return (response = {
          statusCode: 201,
          message: `${createFamilyDto.familyName} family created successfully`,
          data: newFamily,
          error: null,
        });
      }
    } catch (err) {
      console.log(err);

      this.logger.error(
        `error creating new family: ` + JSON.stringify(err, null, 2),
      );

      return (response = {
        statusCode: 400,
        message: 'family creation failed',
        data: null,
        error: {
          code: 'family_create_failed',
          message:
            `an unexpected error occurred while processing the request: error ` +
            JSON.stringify(err, null, 2),
        },
      });
    }
  }

  async joinFamily(joinFamilyDto: JoinFamilyDto): Promise<IResponse> {
    let response: IResponse;

    // Edge case: validating family exist
    const isFamilyExist = await this.getFamilyById(joinFamilyDto.familyId);

    if (!isFamilyExist.data || isFamilyExist.data === null) {
      return (response = {
        statusCode: 404,
        message: `this family does not exist`,
        data: null,
        error: {
          code: 'family_not_found',
          message: `family with id ${joinFamilyDto.familyId} not found`,
        },
      });
    }

    const userAlreadyInFamily = await this.familyMemberModel.findOne({
      user: joinFamilyDto.user,
      familyUsername: isFamilyExist.data.familyUsername,
    });

    if (userAlreadyInFamily) {
      return (response = {
        statusCode: 400,
        message: `you're already a member of this family`,
        data: null,
        error: null,
      });
    } else {
      try {
        // create a family model record for user joining a new family
        const createFamilyMember = await this.familyMemberModel.create({
          ...joinFamilyDto,
          family: joinFamilyDto.familyId,
          familyUsername: isFamilyExist.data.familyUsername,
        });

        await this.familyModel.findByIdAndUpdate(
          { _id: joinFamilyDto.familyId },
          { $push: { members: createFamilyMember._id } },
          { new: true },
        );

        return (response = {
          statusCode: 200,
          message: `you've successfully joined ${isFamilyExist.data.familyName} family`,
          data: null,
          error: null,
        });
      } catch (err) {
        console.log(err);

        this.logger.error(
          `error adding new member to ${isFamilyExist.data.familyName} family ` +
            JSON.stringify(err, null, 3),
        );

        return (response = {
          statusCode: 400,
          message: 'family join failed',
          data: null,
          error: {
            code: 'family_join_failed',
            message:
              `an unexpected error occurred while processing the request: error ` +
              JSON.stringify(err, null, 2),
          },
        });
      }
    }
  }

  async getFamilyById(familyId: any): Promise<IResponse> {
    this.logger.log(`lookup user with id: [${familyId}]...`);
    let response: IResponse;

    try {
      const family = await this.familyModel
        .findOne({ _id: familyId })
        .populate('branches')
        .populate({
          path: 'members',
          // populate: {
          //   path: 'userId',
          //   model: 'PrimaryUser',
          // },
        });

      if (!family) {
        return (response = {
          statusCode: 404,
          message: `invalid id: family does not exist`,
          data: null,
          error: {
            code: 'family_not_found',
            message: `family with id ${familyId} not found`,
          },
        });
      } else {
        return (response = {
          statusCode: 200,
          message: `family fetched successfully`,
          data: family,
          error: null,
        });
      }
    } catch (err) {
      console.log(err);

      this.logger.error(
        `an error occur fetching family with id: [${familyId}]` +
          JSON.stringify(err, null, 2),
      );

      return (response = {
        statusCode: 400,
        message: `error fetching family with id: [${familyId}]`,
        data: null,
        error: {
          code: 'family_by_id_fetch_failed',
          message:
            `an unexpected error occurred while processing the request: error ` +
            JSON.stringify(err, null, 2),
        },
      });
    }
  }

  async validateFamilyTypeUniqueness(
    familyTypeUiqueValidateDto: FamilyTypeUiqueValidateDto,
  ) {
    let response: IResponse;

    this.logger.log(
      `validating user doesn't already belong to a family of same type [MATERNAL or PATERNAL]`,
    );
    const userFamilyTypeUnique = await this.familyMemberModel
      .findOne({
        user: familyTypeUiqueValidateDto.userId,
        familyType: {
          $regex: new RegExp(familyTypeUiqueValidateDto.familyType, 'i'),
        },
      })
      .select('relationshipToRoot')
      .populate({
        path: 'family',
        select: 'familyName',
      });

    if (!userFamilyTypeUnique) {
      return (response = {
        statusCode: 200,
        message: `user does not belong to any family of same type`,
        data: true,
      });
    }

    return (response = {
      statusCode: 400,
      message: `you already belong to [${familyTypeUiqueValidateDto.familyType} family ${userFamilyTypeUnique.family.familyName}]: to create a family of same type, first exit the one you're on first`,
      data: false,
    });
  }

  async validateRelationshipToRoot(dto: FamilyRelationshipValidateDto) {
    let response: IResponse;
    if (!topLevelFamilyRelations.includes(dto.relationshipToRoot)) {
      return (response = {
        statusCode: 200,
        message: `relationship is disconnected from root, create or select your parent who link you to the root`,
        data: false,
      });
    }

    return (response = {
      statusCode: 200,
      message: `relationship is directly related to root, skip parent create or select`,
      data: true,
    });
  }

  async searchFamily(searchFamilyDto: SearchFamilyDto) {
    let response: IResponse;
    const { searchText } = searchFamilyDto;

    try {
      const families = await this.familyModel.find({
        $or: [
          {
            familyName: { $regex: new RegExp(searchText, 'i') },
          },
          {
            familyUsername: {
              $regex: new RegExp(searchText, 'i'),
            },
          },
          { country: new RegExp(searchText, 'i') },
          { state: { $regex: new RegExp(searchText, 'i') } },
        ],
      });

      if (families.length === 0) {
        return (response = {
          statusCode: 404,
          message: `no family found with ${searchText}`,
          data: null,
          error: null,
        });
      }

      return (response = {
        statusCode: 200,
        message: `families with [${searchText}] retrieved successfully`,
        data: families,
        error: null,
      });
    } catch (err) {
      console.log(err);

      this.logger.error(
        `an error occur searching family` + JSON.stringify(err, null, 2),
      );

      return (response = {
        statusCode: 400,
        message: `error searching family`,
        data: null,
        error: {
          code: 'family_search_failed',
          message:
            `an unexpected error occurred while processing the request: error ` +
            JSON.stringify(err, null, 2),
        },
      });
    }
  }

  async queryFamilies(queryFamiliesDto: QueryFamiliesDto) {
    let response: IResponse;
    const { familyName, country, state, tribe } = queryFamiliesDto;

    try {
      const families = await this.familyModel
        .find({
          $and: [
            { familyName: { $regex: new RegExp(familyName, 'i') } },
            { country: { $regex: new RegExp(country, 'i') } },
            { state: { $regex: new RegExp(state, 'i') } },
            { tribe: { $regex: new RegExp(tribe, 'i') } },
          ],
        })
        .select(
          'root members familyName familyUsername familyCoverImage familyJoinLink',
        )
        .populate({
          path: 'root',
          select: 'fullName role profilePic',
        })
        .populate({
          path: 'members',
          select: '-family',
          options: { limit: 6 },
          populate: {
            path: 'user',
            select: 'relationshipToRoot userName fullName profilePic',
          },
        });

      if (families.length === 0) {
        return (response = {
          statusCode: 404,
          message: `no family found with these record`,
          data: null,
          error: null,
        });
      }

      return (response = {
        statusCode: 200,
        message: `families found with this record are`,
        data: families,
        error: null,
      });
    } catch (err) {
      console.log(err);

      this.logger.error(
        `an error occur querying family` + JSON.stringify(err, null, 2),
      );

      return (response = {
        statusCode: 400,
        message: `error querying family`,
        data: null,
        error: {
          code: 'family_querying_failed',
          message:
            `an unexpected error occurred while processing the request: error ` +
            JSON.stringify(err, null, 2),
        },
      });
    }
  }

  async updateFamily(familyId: any, updateFamilyDto: Partial<CreateFamilyDto>) {
    let response: IResponse;

    try {
      const family = await this.getFamilyById(familyId);
      if (!family.data || family.data === null) {
        return (response = family);
      }

      const updated = await this.familyModel.findOneAndUpdate(
        { _id: familyId },
        { $set: updateFamilyDto },
        { new: true },
      );

      return (response = {
        statusCode: 200,
        message: 'family updated successfully',
        data: updated,
        error: null,
      });
    } catch (err) {
      console.log(err);

      this.logger.error(
        `error updating family: ` + JSON.stringify(err, null, 2),
      );

      return (response = {
        statusCode: 400,
        message: 'family update failed',
        data: null,
        error: {
          code: 'family_update_failed',
          message:
            `an unexpected error occurred while processing the request: error ` +
            JSON.stringify(err, null, 2),
        },
      });
    }
  }
}