import { ReviewActivityItem, convertToCosmosAddress } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { getStatus } from "../db/status";
import { ACCOUNTS_DB, ACTIVITY_DB } from "../db/db";

export const addReviewForCollection = async (expressReq: Request, res: Response) => {
  try {
    const req = expressReq as AuthenticatedRequest

    if (!req.body.review || req.body.review.length > 2048) {
      return res.status(400).send({ error: 'Review must be 1 to 2048 characters long.' });
    }

    const stars = Number(req.body.stars);
    if (isNaN(stars) || stars < 0 || stars > 5) {
      return res.status(400).send({ error: 'Stars must be a number between 0 and 5.' });
    }

    const collectionId = Number(req.params.id);
    const userAccountInfo = await ACCOUNTS_DB.find({
      selector: {
        cosmosAddress: {
          $eq: req.session.cosmosAddress
        }
      }
    });
    if (userAccountInfo.docs.length === 0) {
      return res.status(400).send({ error: 'User does not exist.' });
    }


    const status = await getStatus();

    const { review } = req.body;
    const activityDoc: ReviewActivityItem & {
      partition: string
    } = {
      partition: `collection-${collectionId}`,
      method: 'Review',
      collectionId,
      stars: stars,
      review: review,
      from: userAccountInfo.docs[0].cosmosAddress,
      timestamp: Date.now(),
      block: status.block.height,
    }

    await ACTIVITY_DB.insert(activityDoc);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: 'Error adding announcement. Please try again later.'
    })
  }
}



export const addReviewForUser = async (expressReq: Request, res: Response) => {
  try {
    const req = expressReq as AuthenticatedRequest

    if (!req.body.review || req.body.review.length > 2048) {
      return res.status(400).send({ error: 'Review must be 1 to 2048 characters long.' });
    }

    const stars = Number(req.body.stars);
    if (isNaN(stars) || stars < 0 || stars > 5) {
      return res.status(400).send({ error: 'Stars must be a number between 0 and 5.' });
    }

    const cosmosAddress = convertToCosmosAddress(req.params.cosmosAddress);

    const userAccountInfo = await ACCOUNTS_DB.find({
      selector: {
        cosmosAddress: {
          $eq: req.session.cosmosAddress
        }
      }
    });

    if (userAccountInfo.docs.length === 0) {
      return res.status(400).send({ error: 'User does not exist.' });
    }

    const status = await getStatus();

    const { review } = req.body;

    const activityDoc: ReviewActivityItem & {
      partition: string
    } = {
      partition: `user-${cosmosAddress}`,
      method: 'Review',
      reviewedAddress: cosmosAddress,
      stars: stars,
      review: review,
      from: userAccountInfo.docs[0].cosmosAddress,
      timestamp: Date.now(),
      block: status.block.height,
    }

    await ACTIVITY_DB.insert(activityDoc);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: 'Error adding announcement. Please try again later.'
    })
  }

}