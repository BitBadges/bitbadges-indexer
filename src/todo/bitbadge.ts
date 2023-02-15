/* eslint-disable no-case-declarations */
import { MetadataStandard } from './standards';
import Joi from 'joi';

/**
 * All badge entries are required to meet this minimum standard.
 *
 * Note that if a type is specified, it may need to adhere to some
 * additional schemas as well. See below.
 */
const BitBadgeMetadataSchema = Joi.object({
    //Required
    name: Joi.string().min(1).max(80).required(),
    description: Joi.string().min(0).max(1000).required(),
    creator: Joi.string().min(1).max(80).required(),

    // txnHash: Joi.string().alphanum().required()

    //Optional, but if specified must be in this format
    type: Joi.number().required(),
    category: Joi.string().max(50),
    image: Joi.string().uri().max(2048),
    color: Joi.string().max(30),
    url: Joi.string().uri().allow('').max(2048),
    validFrom: Joi.object({
        start: Joi.number().required(),
        end: Joi.number().required()
    }),
    tags: Joi.array().items(Joi.string()),
    attributes: Joi.object(),
});

/**
 * Public BitBadges are those that will be visible to others.
 *
 * They must adhere to the schema below, in addition to the minimum BitBadgeMetadataSchema above.
 */
const PublicBadgeSchema = Joi.object({
    image: Joi.string().uri().required(),
    category: Joi.string().required(),
    color: Joi.string().required(),
    url: Joi.string().uri().allow('').required(),
    validFrom: Joi.object({
        start: Joi.number().required(),
        end: Joi.number().required()
    }).required(),
});

const typesToSchemas = [PublicBadgeSchema];

export const BitBadgeStandard: MetadataStandard = {
    name: 'BitBadge',
    validate: (data: any) => {
        Joi.assert(data, BitBadgeMetadataSchema);

        //check if badge type is defined and validate it meets that types' schema
        const TypeSchema = typesToSchemas[data.type];
        if (TypeSchema) {
            const { error } = TypeSchema.validate(data, { stripUnknown: true });
            if (error) throw error;
        } else if (data.type) {
            throw `Invalid type: ${data.type}. Must be an integer from 0 to ${typesToSchemas.length - 1}`;
        }

        //TODO: set defaults and validate other fields like color, image, etc for more than just string

        return data;
    }
};
