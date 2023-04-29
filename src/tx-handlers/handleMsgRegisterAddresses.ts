import { MessageMsgRegisterAddresses } from "bitbadgesjs-transactions"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { DbStatus, Docs } from "bitbadgesjs-utils";

export const handleMsgRegisterAddresses = async (msg: MessageMsgRegisterAddresses, status: DbStatus, docs: Docs): Promise<Docs> => {
    docs = await handleNewAccountByAddress(msg.creator, docs);

    for (const cosmosAddress of msg.addressesToRegister) {
        docs = await handleNewAccountByAddress(cosmosAddress, docs);
    }

    return docs;
}