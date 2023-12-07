
import { NumberType, convertBalance } from "bitbadgesjs-proto";
import { BigIntify, GetFollowDetailsRouteRequestBody, GetFollowDetailsRouteResponse, UpdateFollowDetailsRouteRequestBody, UpdateFollowDetailsRouteResponse, convertFollowDetailsDoc, getBalanceForIdAndTime } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { COLLECTIONS_DB, FOLLOWS_DB, insertToDB } from "../db/db";
import { catch404 } from "../utils/couchdb-utils";
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

    let _followDoc = await FOLLOWS_DB.get(reqBody.cosmosAddress).catch(catch404);
    if (!_followDoc) {
      _followDoc = {
        _id: reqBody.cosmosAddress,
        _rev: '',
        cosmosAddress: reqBody.cosmosAddress,
        followingCount: 0,
        followersCount: 0,
        followingCollectionId: 0,
      }
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


        const res = await FOLLOWS_DB.find({
          selector: {
            followingCollectionId: {
              $eq: doc.collectionId
            }
          },
          limit: 1,
        });

        if (res.docs.length > 0) {
          followers.push(res.docs[0].cosmosAddress);
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
        currBookmark = res.bookmark ?? '';
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
      _id: followDoc._id,
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

    const cosmosAddress = req.session?.cosmosAddress;

    let _followDoc = await FOLLOWS_DB.get(cosmosAddress).catch(catch404);
    if (!_followDoc) {
      _followDoc = {
        _id: cosmosAddress,
        _rev: '',
        cosmosAddress: cosmosAddress,
        followingCount: 0,
        followersCount: 0,
        followingCollectionId: 0,
      }
    }

    const followDoc = convertFollowDetailsDoc(_followDoc, BigIntify);


    if (reqBody.followingCollectionId) {
      followDoc.followingCollectionId = BigInt(reqBody.followingCollectionId);

      //Ensure the collection exists and meets the criteria for the follow standards
      const collectionDoc = await COLLECTIONS_DB.get(followDoc.followingCollectionId.toString()).catch(catch404);
      if (!collectionDoc) {
        return res.status(400).send({
          message: "Collection does not exist."
        });
      }

      console.log(collectionDoc.createdBy, cosmosAddress);
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


    await insertToDB(FOLLOWS_DB, followDoc);

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


