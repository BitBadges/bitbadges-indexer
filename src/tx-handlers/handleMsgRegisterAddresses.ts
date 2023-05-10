import { MessageMsgRegisterAddresses } from "bitbadgesjs-transactions"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { DbStatus, DocsCache } from "bitbadgesjs-utils";

export const handleMsgRegisterAddresses = async (msg: MessageMsgRegisterAddresses, status: DbStatus, docs: DocsCache): Promise<void> => {
  await handleNewAccountByAddress(msg.creator, docs);

  for (const cosmosAddress of msg.addressesToRegister) {
    await handleNewAccountByAddress(cosmosAddress, docs);
  }
}