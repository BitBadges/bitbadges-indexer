import { convertToCosmosAddress, isAddressValid, s_ReviewActivityItem } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { ACCOUNTS_DB, ACTIVITY_DB } from "../db/db";
import { getStatus } from "../db/status";
import { getAccountByUsername } from "./users";

export const addReviewForCollection = async (expressReq: Request, res: Response) => {
  try {
    const req = expressReq as AuthenticatedRequest

    if (!req.body.review || req.body.review.length > 2048) {
      return res.status(400).send({ error: 'Review must be 1 to 2048 characters long.' });
    }

    const stars = BigInt(req.body.stars);
    if (stars < 0 || stars > 5) {
      return res.status(400).send({ error: 'Stars must be a number between 0 and 5.' });
    }

    const collectionId = BigInt(req.params.id);
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
    const activityDoc: s_ReviewActivityItem & {
      partition: string
    } = {
      partition: `collection-${collectionId}`,
      method: 'Review',
      collectionId: collectionId.toString(),
      stars: stars.toString(),
      review: review,
      from: userAccountInfo.docs[0].cosmosAddress,
      timestamp: Date.now().toString(),
      block: status.block.height.toString()
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

    let cosmosAddress = '';
    if (isAddressValid(req.params.addressOrUsername)) {
      cosmosAddress = convertToCosmosAddress(req.params.addressOrUsername);
    } else {
      const account = await getAccountByUsername(req.params.addressOrUsername);
      cosmosAddress = account.cosmosAddress;
    }

    const status = await getStatus();

    const { review } = req.body;

    const activityDoc: s_ReviewActivityItem & {
      partition: string
    } = {
      partition: `user-${cosmosAddress}`,
      method: 'Review',
      reviewedAddress: cosmosAddress,
      stars: stars.toString(),
      review: review,
      from: req.session.cosmosAddress,
      timestamp: Date.now().toString(),
      block: status.block.height.toString()
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