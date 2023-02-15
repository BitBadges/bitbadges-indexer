import { Docs } from "./db";

export async function updateCollection(docs: Docs, collectionId: number, collectionInfo: any) {
    try {
        docs.collections[collectionId] = collectionInfo;
    } catch (error) {
        throw `Error in updateCollection(): ${error}`;
    }
}