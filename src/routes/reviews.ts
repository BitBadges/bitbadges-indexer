import {
  ReviewDoc,
  isAddressValid,
  type AddReviewPayload,
  type ErrorResponse,
  type NumberType,
  type iAddReviewSuccessResponse,
  type iDeleteReviewSuccessResponse
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Response } from 'express';
import { serializeError } from 'serialize-error';
import { mustGetAuthDetails, type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { deleteMany, insertToDB, mustGetFromDB } from '../db/db';
import { ReviewModel } from '../db/schemas';
import { getStatus } from '../db/status';

export const deleteReview = async (req: AuthenticatedRequest<NumberType>, res: Response<iDeleteReviewSuccessResponse | ErrorResponse>) => {
  try {
    const reviewId = req.params.reviewId;
    const reviewDoc = await mustGetFromDB(ReviewModel, reviewId);
    const authDetails = await mustGetAuthDetails(req, res);
    if (authDetails.cosmosAddress && reviewDoc.from !== authDetails.cosmosAddress) {
      return res.status(401).send({ errorMessage: 'You can only delete your own reviews.' });
    }

    await deleteMany(ReviewModel, [reviewId]);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error deleting review. ' + e.message
    });
  }
};

export const addReview = async (req: AuthenticatedRequest<NumberType>, res: Response<iAddReviewSuccessResponse | ErrorResponse>) => {
  try {
    const reqPayload = req.body as AddReviewPayload;
    const authDetails = await mustGetAuthDetails(req, res);
    if (!reqPayload.review || reqPayload.review.length > 2048) {
      return res.status(400).send({ errorMessage: 'Review must be 1 to 2048 characters long.' });
    }

    const stars = BigInt(reqPayload.stars);
    if (stars < 0 || stars > 5) {
      return res.status(400).send({ errorMessage: 'Stars must be a number between 0 and 5.' });
    }

    const { review } = req.body;
    const id = crypto.randomBytes(32).toString('hex');

    const isCollectionReview = req.body.collectionId && Number(req.body.collectionId);
    const isUserReview = req.body.cosmosAddress;
    if (!isCollectionReview && !isUserReview) {
      return res.status(400).send({ errorMessage: 'Must specify either collectionId or cosmosAddress.' });
    } else if (isCollectionReview && isUserReview) {
      return res.status(400).send({ errorMessage: 'Cannot specify both collectionId and cosmosAddress.' });
    }

    const cosmosAddress = req.body.cosmosAddress;
    const collectionId = isCollectionReview ? BigInt(req.body.collectionId) : BigInt(0);
    if (isUserReview) {
      if (!isAddressValid(cosmosAddress)) {
        return res.status(400).send({ errorMessage: 'Invalid address. Must be a bech32 Cosmos address.' });
      }

      if (cosmosAddress && cosmosAddress === authDetails.cosmosAddress) {
        return res.status(400).send({ errorMessage: 'You cannot review yourself.' });
      }
    } else if (isCollectionReview) {
      if (collectionId <= 0) {
        return res.status(400).send({ errorMessage: 'Collection ID must be a positive number.' });
      }
    }

    const status = await getStatus();
    const activityDoc = new ReviewDoc({
      _docId: `collection-${collectionId}:${id}`,
      collectionId: isCollectionReview ? Number(collectionId) : 0,
      reviewedAddress: isUserReview ? cosmosAddress : undefined,
      stars: Number(stars),
      review,
      from: authDetails.cosmosAddress,
      timestamp: Number(Date.now()),
      block: Number(status.block.height)
    });

    await insertToDB(ReviewModel, activityDoc);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error adding review. ' + e.message
    });
  }
};
