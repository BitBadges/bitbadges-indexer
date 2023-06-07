import { AddReviewForCollectionRouteRequestBody, AddReviewForCollectionRouteResponse, AddReviewForUserRouteRequestBody, AddReviewForUserRouteResponse, ReviewInfoBase, convertToCosmosAddress, isAddressValid } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { ACCOUNTS_DB, REVIEWS_DB, insertToDB } from "../db/db";
import { getStatus } from "../db/status";
import { getAccountByUsername } from "./users";

export const addReviewForCollection = async (expressReq: Request, res: Response<AddReviewForCollectionRouteResponse>) => {
  try {
    const req = expressReq as AuthenticatedRequest
    const reqBody = req.body as AddReviewForCollectionRouteRequestBody;

    if (!reqBody.review || reqBody.review.length > 2048) {
      return res.status(400).send({ message: 'Review must be 1 to 2048 characters long.' });
    }

    const stars = BigInt(reqBody.stars);
    if (stars < 0 || stars > 5) {
      return res.status(400).send({ message: 'Stars must be a number between 0 and 5.' });
    }

    //TODO: Search PROFILES_DB here? And create new profile if not found?

    const collectionId = BigInt(req.params.collectionId);
    const userAccountInfo = await ACCOUNTS_DB.find({
      selector: {
        cosmosAddress: {
          $eq: req.session.cosmosAddress
        }
      }
    });
    if (userAccountInfo.docs.length === 0) {
      return res.status(400).send({ message: 'User does not exist in database.' });
    }


    const status = await getStatus();

    const { review } = req.body;
    //number because nothng should overflow here
    const activityDoc: ReviewInfoBase<number> & {
      partition: string
    } = {
      partition: `collection-${collectionId}`,
      method: 'Review',
      collectionId: Number(collectionId),
      stars: Number(stars),
      review: review,
      from: userAccountInfo.docs[0].cosmosAddress,
      timestamp: Number(Date.now()),
      block: Number(status.block.height)
    }

    await insertToDB(REVIEWS_DB, activityDoc);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error adding announcement. Please try again later."
    })
  }
}



export const addReviewForUser = async (expressReq: Request, res: Response<AddReviewForUserRouteResponse>) => {
  try {
    const req = expressReq as AuthenticatedRequest
    const reqBody = req.body as AddReviewForUserRouteRequestBody;

    if (!reqBody.review || reqBody.review.length > 2048) {
      return res.status(400).send({ message: 'Review must be 1 to 2048 characters long.' });
    }

    const stars = Number(reqBody.stars);
    if (isNaN(stars) || stars < 0 || stars > 5) {
      return res.status(400).send({ message: 'Stars must be a number between 0 and 5.' });
    }

    let cosmosAddress = '';
    if (isAddressValid(req.params.addressOrUsername)) {
      cosmosAddress = convertToCosmosAddress(req.params.addressOrUsername);
    } else {
      const account = await getAccountByUsername(req.params.addressOrUsername);
      cosmosAddress = account.cosmosAddress;
    }

    const status = await getStatus();

    const { review } = req.body;


    const activityDoc: ReviewInfoBase<number> & {
      partition: string
    } = {
      partition: `user-${cosmosAddress}`,
      method: 'Review',
      reviewedAddress: cosmosAddress,
      stars: Number(stars),
      review: review,
      from: req.session.cosmosAddress,
      timestamp: Number(Date.now()),
      block: Number(status.block.height)
    }

    await insertToDB(REVIEWS_DB, activityDoc);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error adding announcement. Please try again later."
    })
  }
}