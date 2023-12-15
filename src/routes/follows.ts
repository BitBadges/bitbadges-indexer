
import { NumberType, convertBalance } from "bitbadgesjs-proto";
import { BigIntify, GetFollowDetailsRouteRequestBody, GetFollowDetailsRouteResponse, UpdateFollowDetailsRouteRequestBody, UpdateFollowDetailsRouteResponse, convertFollowDetailsDoc, getBalanceForIdAndTime } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { CollectionModel, FollowDetailsModel, getFromDB, insertToDB, mustGetFromDB } from "../db/db";
import { executeCollectionBalancesQuery } from "./activityHelpers";
import { executeCollectedQuery } from "./userHelpers";

//TODO: Implement a more efficient approach to this (CRON job that updates counts each day?)
//TODO: Also paginate this w/ bookmarks correctly
//TODO: Think ab conflicts if CRON job is running at the same time as this

export const getFollowDetails = async (expressReq: Request, res: Response<GetFollowDetailsRouteResponse<NumberType>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;
    const reqBody = req.body as GetFollowDetailsRouteRequestBody;

    const followingBookmark = reqBody.followingBookmark ?? '';
    const followersBookmark = reqBody.followersBookmark ?? '';

    // const followingBookmark = '';
    // const followersBookmark = '';

    let _followDoc = await getFromDB(FollowDetailsModel, reqBody.cosmosAddress);
    if (!_followDoc) {
      _followDoc = {
        _legacyId: reqBody.cosmosAddress,
        cosmosAddress: reqBody.cosmosAddress,
        followingCount: 0,
        followersCount: 0,
        followingCollectionId: 0,
      };
    }
    const followDoc = convertFollowDetailsDoc(_followDoc, BigIntify);

    const followers = [];
    const following = [];

    //Calculate followers
    let hasMore = true;
    let currBookmark = followersBookmark ?? ''
    while (hasMore) {
      const res = await executeCollectedQuery(followDoc.cosmosAddress, { hiddenBadges: [] } as any, false, currBookmark);
      hasMore = res.docs.length >= 25;
      currBookmark = res.bookmark ?? '';
      for (const doc of res.docs) {
        if (!doc) continue;

        const currBalance = getBalanceForIdAndTime(1n, BigInt(Date.now()), doc.balances.map(x => convertBalance(x, BigIntify)));
        if (currBalance <= 0n) continue;

        const res = await FollowDetailsModel.find({
          followingCollectionId: Number(doc.collectionId),
        }).limit(1).lean().exec();


        if (res.length > 0) {
          followers.push(res[0].cosmosAddress);
        }
      }

      followDoc.followersCount = BigInt(followers.length);
    }

    if (followDoc.followingCollectionId > 0n) {
      let hasMore = true;
      let currBookmark = followingBookmark ?? ''
      while (hasMore) {
        const res = await executeCollectionBalancesQuery(followDoc.followingCollectionId.toString(), currBookmark);
        hasMore = res.docs.length >= 25;
        currBookmark = res.pagination.bookmark ?? '';
        for (const doc of res.docs) {
          if (!doc) continue;

          if (doc.cosmosAddress === 'Mint') continue;
          if (doc.cosmosAddress === 'Total') continue;

          const currBalance = getBalanceForIdAndTime(1n, BigInt(Date.now()), doc.balances.map(x => convertBalance(x, BigIntify)));
          if (currBalance <= 0n) continue;


          if (res.docs.length > 0) {
            following.push(doc.cosmosAddress);
          }
        }

        followDoc.followingCount = BigInt(following.length);
      }
    }

    return res.status(200).send({
      _legacyId: followDoc._legacyId,
      cosmosAddress: followDoc.cosmosAddress,
      followersCount: followDoc.followersCount,
      followingCount: followDoc.followingCount,
      followingCollectionId: followDoc.followingCollectionId,
      followers,
      following,
      followersPagination: {
        hasMore: false,
        bookmark: '',
      },
      followingPagination: {
        hasMore: false,
        bookmark: '',
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error getting follow details"
    });
  }
}

export const updateFollowDetails = async (expressReq: Request, res: Response<UpdateFollowDetailsRouteResponse>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;
    const reqBody = req.body as UpdateFollowDetailsRouteRequestBody<NumberType>;

    const cosmosAddress = req.session.cosmosAddress;

    let _followDoc = await getFromDB(FollowDetailsModel, cosmosAddress);
    if (!_followDoc) {
      _followDoc = {
        _legacyId: cosmosAddress,
        cosmosAddress: cosmosAddress,
        followingCount: 0,
        followersCount: 0,
        followingCollectionId: 0,
      };
    }

    const followDoc = convertFollowDetailsDoc(_followDoc, BigIntify);


    if (reqBody.followingCollectionId) {
      followDoc.followingCollectionId = BigInt(reqBody.followingCollectionId);

      //Ensure the collection exists and meets the criteria for the follow standards
      const collectionDoc = await mustGetFromDB(CollectionModel, reqBody.followingCollectionId.toString());

      if (collectionDoc.createdBy !== cosmosAddress) {
        return res.status(400).send({
          message: "Collection was not created by this user."
        });
      }


      //TODO: Add other restrictions?
      //-Assert correct metadata
      //-Assert at least one badge
      //-Not "No Balances" standard
    }
    await insertToDB(FollowDetailsModel, followDoc);

    return
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error updating follow details."
    });
  }
}


//getCounts (cached each day one writer CRON job)


