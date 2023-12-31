
import { NumberType, convertBalance } from "bitbadgesjs-proto";
import { BigIntify, GetFollowDetailsRouteRequestBody, GetFollowDetailsRouteResponse, convertFollowDetailsDoc, getBalanceForIdAndTime } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { FollowDetailsModel, UserProtocolCollectionsModel, getFromDB } from "../db/db";
import { client } from "../indexer";
import { executeCollectionBalancesQuery } from "./activityHelpers";
import { executeCollectedQuery } from "./userQueries";

//TODO: Implement a more efficient approach to this (CRON job that updates counts each day?)
//TODO: Also paginate this w/ bookmarks correctly
//TODO: Think ab conflicts if CRON job is running at the same time as this

export const getFollowDetails = async (expressReq: Request, res: Response<GetFollowDetailsRouteResponse<NumberType>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;
    const reqBody = req.body as GetFollowDetailsRouteRequestBody;

    const followingBookmark = reqBody.followingBookmark ?? '';
    const followersBookmark = reqBody.followersBookmark ?? '';
    const protocolName = reqBody.protocol ?? 'BitBadges Follow Protocol';

    let _followDoc = await getFromDB(FollowDetailsModel, reqBody.cosmosAddress);
    if (!_followDoc) {
      _followDoc = {
        _legacyId: reqBody.cosmosAddress,
        cosmosAddress: reqBody.cosmosAddress,
        followingCount: 0,
        followersCount: 0,
      };
    }
    const followDoc = convertFollowDetailsDoc(_followDoc, BigIntify);

    if (!client || !client.badgesQueryClient) {
      throw new Error("Indexer not initialized");
    }

    let followingCollectionId = 0n;
    const protocolsRes = await getFromDB(UserProtocolCollectionsModel, reqBody.cosmosAddress);
    if (protocolsRes) {
      if (protocolsRes.protocols[protocolName]) {
        followingCollectionId = BigInt(protocolsRes.protocols[protocolName]);
      }
    }

    const followers = [];
    const following = [];

    //Calculate followers
    let hasMore = true;
    let currBookmark = followersBookmark ?? ''
    while (hasMore) {
      const res = await executeCollectedQuery(followDoc.cosmosAddress, { hiddenBadges: [] } as any, false, undefined, currBookmark);
      hasMore = res.docs.length >= 25;
      currBookmark = res.bookmark ?? '';
      for (const doc of res.docs) {
        if (!doc) continue;

        const currBalance = getBalanceForIdAndTime(1n, BigInt(Date.now()), doc.balances.map(x => convertBalance(x, BigIntify)));
        if (currBalance <= 0n) continue;

        const res = await UserProtocolCollectionsModel.find({
          [`protocols.${protocolName}`]: Number(doc.collectionId),
        }).limit(1).lean().exec();


        if (res.length > 0) {
          followers.push(res[0]._legacyId);
        }
      }

      followDoc.followersCount = BigInt(followers.length);
    }

    if (followingCollectionId > 0n) {
      let hasMore = true;
      let currBookmark = followingBookmark ?? ''
      while (hasMore) {
        const res = await executeCollectionBalancesQuery(followingCollectionId.toString(), currBookmark);
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
      followingCollectionId: followingCollectionId,
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


//getCounts (cached each day one writer CRON job)


