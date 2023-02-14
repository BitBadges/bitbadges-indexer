import { ipfsClient } from "../indexer";

export const getFromIpfs = async (path: string) => {
    const getRes = ipfsClient.cat(path);

    const decoder = new TextDecoder();
    let fileJson = '';
    for await (const file of getRes) {
        let chunk = decoder.decode(file);
        fileJson += chunk;
    }

    return { file: fileJson };
}