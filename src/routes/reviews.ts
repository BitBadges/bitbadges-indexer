import { NumberType } from "bitbadgesjs-proto";
import { AddReviewForCollectionRouteRequestBody, AddReviewForCollectionRouteResponse, AddReviewForUserRouteRequestBody, AddReviewForUserRouteResponse, DeleteReviewRouteResponse, ReviewDoc, convertToCosmosAddress, isAddressValid } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { ReviewModel, deleteMany, insertToDB, mustGetFromDB } from "../db/db";
import { getStatus } from "../db/status";
import { getAccountByUsername } from "./users";

export const deleteReview = async (expressReq: Request, res: Response<DeleteReviewRouteResponse<NumberType>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;

    const reviewId = req.params.reviewId;
    const reviewDoc = await mustGetFromDB(ReviewModel, reviewId);

    if (reviewDoc.from !== req.session.cosmosAddress) {
      return res.status(403).send({ message: 'You can only delete your own reviews.' });
    }

    await deleteMany(ReviewModel, [reviewId]);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error deleting review. Please try again later."
    })
  }
}


export const addReviewForCollection = async (expressReq: Request, res: Response<AddReviewForCollectionRouteResponse<NumberType>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>; const reqBody = req.body as AddReviewForCollectionRouteRequestBody;

    if (!reqBody.review || reqBody.review.length > 2048) {
      return res.status(400).send({ message: 'Review must be 1 to 2048 characters long.' });
    }

    const stars = BigInt(reqBody.stars);
    if (stars < 0 || stars > 5) {
      return res.status(400).send({ message: 'Stars must be a number between 0 and 5.' });
    }

    const collectionId = BigInt(req.params.collectionId);
    const status = await getStatus();

    const { review } = req.body;
    //number because nothng should overflow here
    //random collision resistant id (ik it's not properly collision resistant but we just need it to not collide)
    const id = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

    const activityDoc: ReviewDoc<number> = {

      _legacyId: `collection-${collectionId}:${id}`,
      method: 'Review',
      collectionId: Number(collectionId),
      stars: Number(stars),
      review: review,
      from: req.session.cosmosAddress,
      timestamp: Number(Date.now()),
      block: Number(status.block.height)
    }

    await insertToDB(ReviewModel, activityDoc);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error adding review. Please try again later."
    })
  }
}



export const addReviewForUser = async (expressReq: Request, res: Response<AddReviewForUserRouteResponse<NumberType>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>; const reqBody = req.body as AddReviewForUserRouteRequestBody;

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
      const account = await getAccountByUsername(req, req.params.addressOrUsername);
      cosmosAddress = account.cosmosAddress;
    }

    if (cosmosAddress === req.session.cosmosAddress) {
      return res.status(400).send({ message: 'You cannot review yourself.' });
    }

    const status = await getStatus();

    const { review } = req.body;
    //random collision resistant id (ik it's not properly collision resistant but we just need it to not collide)
    const id = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

    const activityDoc: ReviewDoc<NumberType> = {
      _legacyId: `user-${cosmosAddress}:${id}`,
      method: 'Review',
      reviewedAddress: cosmosAddress,
      stars: Number(stars),
      review: review,
      from: req.session.cosmosAddress,
      timestamp: Number(Date.now()),
      block: Number(status.block.height)
    }

    await insertToDB(ReviewModel, activityDoc);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error adding announcement. Please try again later."
    })
  }
}