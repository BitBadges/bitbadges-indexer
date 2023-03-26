import { MessageMsgRegisterAddresses } from "bitbadgesjs-transactions"
import { Docs } from "../db/db"
import { DbStatus } from "../types"
import { handleNewAccountByAddress } from "./handleNewAccount"

export const handleMsgRegisterAddresses = async (msg: MessageMsgRegisterAddresses, status: DbStatus, docs: Docs): Promise<Docs> => {
    docs = await handleNewAccountByAddress(msg.creator, docs);

    for (const cosmosAddress of msg.addressesToRegister) {
        docs = await handleNewAccountByAddress(cosmosAddress, docs);
    }

    return docs;
}