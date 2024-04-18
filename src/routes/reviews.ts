import {
  ReviewDoc,
  isAddressValid,
  type AddReviewRouteRequestBody,
  type ErrorResponse,
  type NumberType,
  type iAddReviewRouteSuccessResponse,
  type iDeleteReviewRouteSuccessResponse
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Response } from 'express';
import { serializeError } from 'serialize-error';
import { type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { deleteMany, insertToDB, mustGetFromDB } from '../db/db';
import { ReviewModel } from '../db/schemas';
import { getStatus } from '../db/status';

export const deleteReview = async (req: AuthenticatedRequest<NumberType>, res: Response<iDeleteReviewRouteSuccessResponse | ErrorResponse>) => {
  try {
    const reviewId = req.params.reviewId;
    const reviewDoc = await mustGetFromDB(ReviewModel, reviewId);

    if (req.session.cosmosAddress && reviewDoc.from !== req.session.cosmosAddress) {
      return res.status(401).send({ errorMessage: 'You can only delete your own reviews.' });
    }

    await deleteMany(ReviewModel, [reviewId]);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error deleting review.'
    });
  }
};

export const addReview = async (req: AuthenticatedRequest<NumberType>, res: Response<iAddReviewRouteSuccessResponse | ErrorResponse>) => {
  try {
    const reqBody = req.body as AddReviewRouteRequestBody;

    if (!reqBody.review || reqBody.review.length > 2048) {
      return res.status(400).send({ errorMessage: 'Review must be 1 to 2048 characters long.' });
    }

    const stars = BigInt(reqBody.stars);
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

      if (cosmosAddress && cosmosAddress === req.session.cosmosAddress) {
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
      from: req.session.cosmosAddress,
      timestamp: Number(Date.now()),
      block: Number(status.block.height)
    });

    await insertToDB(ReviewModel, activityDoc);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error adding review.'
    });
  }
};
