import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { getAttributeValueByKey } from "../indexer"
import { IndexerStargateClient } from "../indexer_stargateclient"
import { handleNewAccount } from "./handleNewAccount"

export const handleMsgRegisterAddresses = async (event: StringEvent, client: IndexerStargateClient, status: any): Promise<void> => {
    const creatorString: string | undefined = getAttributeValueByKey(event.attributes, "creator");
    if (!creatorString) throw new Error(`New Collection event missing creator`)

    await handleNewAccount(Number(creatorString), client);

    const addressesString: string | undefined = getAttributeValueByKey(event.attributes, "addressNums");
    if (!addressesString) throw new Error(`New Collection event missing addressNums`)

    const addressNums: string[] = JSON.parse(addressesString);
    for (const addressNum of addressNums) {
        await handleNewAccount(Number(addressNum), client);
    }
}