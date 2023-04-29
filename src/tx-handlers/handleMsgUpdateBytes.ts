import { MessageMsgUpdateBytes } from "bitbadgesjs-transactions"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { DbStatus, Docs, isAddressValid } from "bitbadgesjs-utils";
import { fetchUri } from "../metadata-queue";


export const handleMsgUpdateBytes = async (msg: MessageMsgUpdateBytes, status: DbStatus, docs: Docs): Promise<Docs> => {
    docs = await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], []);
    docs = await handleNewAccountByAddress(msg.creator, docs);

    docs.collections[msg.collectionId].bytes = msg.newBytes;

    const userList: string[] = [];
    try {
      //check if bytes
      const userListArr: string[] = await fetchUri(docs.collections[msg.collectionId].bytes);
      userListArr.forEach((user) => {
        if (isAddressValid(user)) {
          userList.push(user);
        }
      });
    } catch (e) {
      
    }
    docs.collections[msg.collectionId].userList = userList;

    return docs;
}