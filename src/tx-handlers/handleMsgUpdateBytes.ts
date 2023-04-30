import { MessageMsgUpdateBytes } from "bitbadgesjs-transactions";
import { BalancesMap, DbStatus, Docs } from "bitbadgesjs-utils";
import { fetchDocsForRequestIfEmpty } from "../db/db";
import { fetchUri } from "../metadata-queue";
import { handleNewAccountByAddress } from "./handleNewAccount";


export const handleMsgUpdateBytes = async (msg: MessageMsgUpdateBytes, status: DbStatus, docs: Docs): Promise<Docs> => {
    docs = await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], []);
    docs = await handleNewAccountByAddress(msg.creator, docs);

    docs.collections[msg.collectionId].bytes = msg.newBytes;

    let balanceMap: BalancesMap = {}
    if (docs.collections[msg.collectionId].standard === 1) {
      try {
        //check if bytes
        balanceMap = await fetchUri(docs.collections[msg.collectionId].bytes);
        //TODO: validate types
      } catch (e) {
        
      }
    }
    docs.collections[msg.collectionId].balances = balanceMap;

    return docs;
}