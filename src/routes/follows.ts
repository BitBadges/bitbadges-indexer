
import { NumberType, convertBalance } from "bitbadgesjs-sdk";
import { BalanceDoc, BigIntify, GetFollowDetailsRouteRequestBody, GetFollowDetailsRouteResponse, TransferActivityDoc, convertFollowDetailsDoc, getBalancesForId, removeUintRangesFromUintRanges } from "bitbadgesjs-sdk";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { BalanceModel, FollowDetailsModel, MongoDB, getFromDB, insertToDB } from "../db/db";
import { executeCollectionBalancesQuery } from "./activityHelpers";
import { executeMultiUserActivityQuery } from "./userQueries";

//TODO: Eventually, do we want to cache followers as well somehow?
export const getFollowDetails = async (expressReq: Request, res: Response<GetFollowDetailsRouteResponse<NumberType>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;
    const reqBody = req.body as GetFollowDetailsRouteRequestBody;

    // const followingBookmark = reqBody.followingBookmark ?? '';
    const followersBookmark = reqBody.followersBookmark ?? '';
    // const protocolName = reqBody.protocol ?? 'BitBadges Follow Protocol';

    let _followDoc = await getFromDB(FollowDetailsModel, reqBody.cosmosAddress);
    if (!_followDoc) {
      _followDoc = {
        _docId: reqBody.cosmosAddress,
        cosmosAddress: reqBody.cosmosAddress,
        followers: [],
        following: [],
        followingCollectionId: 0,
        followingCount: 0,
        followersCount: 0,
      };
    }
    const followDoc = convertFollowDetailsDoc(_followDoc, BigIntify);

    //bookmark will be how much to skip
    const followingCollectionId = followDoc.followingCollectionId;
    const countRes = await FollowDetailsModel.aggregate([
      { $match: { following: reqBody.cosmosAddress } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 }
        }
      }
    ]).exec();
    const followersCount = countRes.length > 0 ? countRes[0].count : 0;

    const followersRes = await FollowDetailsModel.aggregate([
      { $match: { following: reqBody.cosmosAddress } },
      { $skip: Number(followersBookmark) },
      { $limit: 25 },
    ]).exec();
    const followers = followersRes.map(x => x.cosmosAddress);

    const following = followDoc.following;
    // const following = followDoc.following.slice(Number(followingBookmark), Number(followingBookmark) + 25);

    const activityBookmark = reqBody.activityBookmark ?? '';
    const activity: TransferActivityDoc<NumberType>[] = [];
    const activityPagination = {
      hasMore: false,
      bookmark: '',
    };
    if (reqBody.activityBookmark !== undefined) {
      const activityRes = await executeMultiUserActivityQuery(followDoc.following, activityBookmark);
      activity.push(...activityRes.docs);
      activityPagination.hasMore = activityRes.docs.length >= 25;
      activityPagination.bookmark = activityRes.bookmark ?? '';
    }

    return res.status(200).send({
      _docId: followDoc._docId,
      cosmosAddress: followDoc.cosmosAddress,
      followersCount: followersCount,
      followingCount: followDoc.followingCount,
      followingCollectionId: followingCollectionId,
      followers,
      following,
      followersPagination: {
        hasMore: followDoc.followersCount > Number(followersBookmark) + 25,
        bookmark: (Number(followersBookmark) + 25).toString(),
      },
      followingPagination: {
        // hasMore: followDoc.followingCount > Number(followingBookmark) + 25,
        // bookmark: (Number(followingBookmark) + 25).toString(),
        hasMore: false,
        bookmark: '',
      },
      activity,
      activityPagination,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: "Error getting follow details"
    });
  }
}

//We have sessions whenever we write to a follow doc
//This is to avoid race conditions with unsets
//For sets (aka follows), even if there are race conditions, we will eventually be correct with the next update because we always use latest value and trigger with all balance updates

export async function handleFollowsByBalanceDocId(docId: string, handledDocIds: string[]) {
  const doc = await getFromDB(BalanceModel, docId);
  if (!doc) return;

  await handleFollows(doc, handledDocIds);
}

async function handleFollows(doc: BalanceDoc<NumberType>, handledDocIds: string[]) {
  if (handledDocIds.includes(doc._docId)) return;
  handledDocIds.push(doc._docId);

  if (doc.cosmosAddress === 'Mint') return;
  if (doc.cosmosAddress === 'Total') return;

  //check if they are always following
  const currBalances = getBalancesForId(1n, doc.balances.map(x => convertBalance(x, BigIntify))).filter(x => x.amount > 0n);
  let timesToCheck = [{ start: 1n, end: BigInt("18446744073709551615") }];
  for (const balance of currBalances) {
    const [remaining] = removeUintRangesFromUintRanges(balance.ownershipTimes, timesToCheck);
    timesToCheck = remaining;
  }
  const isFollowing = timesToCheck.length === 0;

  //recipient of the follow badge
  const recipient = doc.cosmosAddress;


  //Note theoretically, this could be a huge transaction (> limit), but it's unlikely bc we'd need 1000+ users or something
  //all have the same follow protocol set on-chain
  //This is in a session to avoid race conditions
  const session = await MongoDB.startSession();
  session.startTransaction();
  try {
    const users = await FollowDetailsModel.find({
      followingCollectionId: Number(doc.collectionId),
    }).session(session).lean().exec();

    if (users.length === 0) return; //If no one has this set as their following collection, then we don't need to do anything

    for (const resDoc of users) {
      if (!resDoc) continue;
      if (resDoc.cosmosAddress === doc.cosmosAddress) continue; //don't want to follow ourselves

      if (isFollowing) {
        resDoc.following.push(recipient);
        resDoc.following = [...new Set(resDoc.following)];
        resDoc.followingCount = resDoc.following.length;
        await insertToDB(FollowDetailsModel, resDoc, session);
      } else {
        resDoc.following = resDoc.following.filter(x => x !== recipient);
        resDoc.following = [...new Set(resDoc.following)];
        resDoc.followingCount = resDoc.following.length;
        await insertToDB(FollowDetailsModel, resDoc, session);
      }
    }

    await session.commitTransaction();
    await session.endSession();
  } catch (e) {
    console.error(e);
    await session.abortTransaction();
    await session.endSession();
    throw e;
  }
}


export async function initializeFollowProtocol(cosmosAddress: string, collectionIdToSet: number) {
  const session = await MongoDB.startSession();
  session.startTransaction();
  try {
    let currFollowDoc = await getFromDB(FollowDetailsModel, cosmosAddress, session);
    if (!currFollowDoc) {
      currFollowDoc = {
        _docId: cosmosAddress,
        cosmosAddress: cosmosAddress,
        followers: [],
        following: [],
        followingCollectionId: 0,
        followingCount: 0,
        followersCount: 0,
      };
    }
    currFollowDoc.followingCollectionId = collectionIdToSet;
    await insertToDB(FollowDetailsModel, currFollowDoc, session);

    await session.commitTransaction();
    await session.endSession();
  } catch (e) {
    console.error(e);
    await session.abortTransaction();
    await session.endSession();
    throw e;
  }


  //query all balances and get following for the docToAdd
  //not in a session bc from now on, even if we have race conditions (a new balance is added), it will still be correct eventually with the next update
  const handledDocIds: string[] = [];
  let hasMore = true;
  let currBookmark = ''
  while (hasMore) {
    console.log("Getting balances for collectionId", collectionIdToSet, "with bookmark", currBookmark);
    const res = await executeCollectionBalancesQuery(collectionIdToSet.toString(), currBookmark);
    hasMore = res.docs.length >= 25;
    currBookmark = res.pagination.bookmark ?? '';
    for (const resDoc of res.docs) {
      if (!resDoc) continue;

      await handleFollows(resDoc, handledDocIds);
    }
  }
}

export async function unsetFollowCollection(cosmosAddress: string) {
  const session = await MongoDB.startSession();
  session.startTransaction();
  try {
    const doc = await getFromDB(FollowDetailsModel, cosmosAddress, session);
    if (doc) {
      doc.followingCollectionId = 0;
      doc.following = [];
      doc.followingCount = 0;
      await insertToDB(FollowDetailsModel, doc, session);
    }

    await session.commitTransaction();
    await session.endSession();
  } catch (e) {
    console.error(e);
    await session.abortTransaction();
    await session.endSession();
    throw e;
  }
}