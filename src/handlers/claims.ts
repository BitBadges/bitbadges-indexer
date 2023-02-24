import { getFromIpfs } from "../ipfs/ipfs";
import { BadgeCollection, DistributionMethod } from "../types";

export const fetchClaims = async (collection: BadgeCollection) => {
    //Handle claim objects
    for (let idx = 0; idx < collection.claims.length; idx++) {
        let claim = collection.claims[idx];

        if (Number(claim.type) === 0) {
            let res = await getFromIpfs(claim.uri.replace('ipfs://', ''));
            const fetchedLeaves: string[] = JSON.parse(res.file);

            if (fetchedLeaves[0]) {
                if (fetchedLeaves[0].split('-').length < 5 || (fetchedLeaves[0].split('-').length - 3) % 2 != 0) {
                    //Is a list of hashed codes; do not hash the leaves
                    //Users will enter their code and we check if we have a Merkle proof for it
                    collection.claims[idx].leaves = fetchedLeaves;
                    collection.claims[idx].distributionMethod = DistributionMethod.Codes;
                } else {
                    //Is a list of specific codes with addresses
                    collection.claims[idx].leaves = fetchedLeaves;
                    collection.claims[idx].distributionMethod = DistributionMethod.Whitelist;
                }
            }
        }
    }

    return collection.claims;
}
