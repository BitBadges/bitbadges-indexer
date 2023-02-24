import { sha256 } from "@cosmjs/crypto"
import { toHex } from "@cosmjs/encoding"
import { Block, IndexedTx } from "@cosmjs/stargate"
import { ABCIMessageLog, Attribute, StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { config } from "dotenv"
import express, { Express, Request, Response } from "express"
import { Server } from "http"
import { create } from 'ipfs-http-client'
import { Docs, ERRORS_DB, fetchDocsForRequest, finalizeDocsForRequest } from "./db/db"
import { getStatus, setStatus } from "./db/status"
import { handleMsgClaimBadge } from "./handlers/handleMsgClaimBadge"
import { handleMsgMintBadge } from "./handlers/handleMsgMintBadge"
import { handleMsgNewCollection } from "./handlers/handleMsgNewCollection"
import { handleMsgRegisterAddresses } from "./handlers/handleMsgRegisterAddresses"
import { handleMsgRequestTransferManager } from "./handlers/handleMsgRequestTransferManager"
import { handleMsgSetApproval } from "./handlers/handleMsgSetApproval"
import { handleMsgTransferBadge } from "./handlers/handleMsgTransferBadge"
import { handleMsgTransferManager } from "./handlers/handleMsgTransferManager"
import { handleMsgUpdateBytes } from "./handlers/handleMsgUpdateBytes"
import { handleMsgUpdateDisallowedTransfers } from "./handlers/handleMsgUpdateDisallowedTransfers"
import { handleMsgUpdatePermissions } from "./handlers/handleMsgUpdatePermissions"
import { handleMsgUpdateUris } from "./handlers/handleMsgUpdateUris"
import { IndexerStargateClient } from "./indexer_stargateclient"
import { getBadgeBalance } from "./routes/balances"
import { getCollectionById, getCollections, getMetadataForCollection, getOwnersForCollection, queryCollections } from "./routes/collections"
import { addMerkleTreeToIpfsHandler, addToIpfsHandler } from "./routes/ipfs"
import { searchHandler } from "./routes/search"
import { getStatusHandler } from "./routes/status"
import { getBatchUsers, getPortfolioInfo } from "./routes/users"
import { DbStatus } from "./types"
import _ from "../environment"
import { fetchBadgeMetadata, fetchMetadata } from "./handlers/metadata"
// import { getChainDriver } from "./blockin/blockin"
// import { setChainDriver, verifyChallenge, createChallenge } from 'blockin';
// import { parse } from "./util/preserveJson"

const cors = require('cors');

config()

const auth = 'Basic ' + Buffer.from(process.env.INFURA_ID + ':' + process.env.INFURA_SECRET_KEY).toString('base64');

export const ipfsClient = create({
    host: 'ipfs.infura.io',
    port: 5001,
    protocol: 'https',
    headers: {
        authorization: auth,
    },
});

export const getAttributeValueByKey = (attributes: Attribute[], key: string): string | undefined => {
    return attributes.find((attribute: Attribute) => attribute.key === key)?.value
}

export const createIndexer = async () => {
    const port = "3001"
    const pollIntervalMs = 1_000
    let timer: NodeJS.Timer | undefined
    let client: IndexerStargateClient

    const app: Express = express()
    app.use(cors());

    // parse application/x-www-form-urlencoded
    app.use(express.urlencoded({ extended: false }))

    // parse application/json
    app.use(express.json())

    app.get("/", (req: Request, res: Response) => {
        res.send({
            error: "Not implemented",
        })
    })

    //TODO: clean route names and methods
    app.get("/api/status", getStatusHandler);

    app.get("/api/search/:searchValue", searchHandler);

    app.get("/api/collection/:id", getCollectionById)
    app.post("/api/collection/batch", getCollections)
    app.get("/api/collection/query", queryCollections)
    app.post("/api/metadata/:collectionId", getMetadataForCollection)
    app.get('/api/collection/:id/:badgeId/owners', getOwnersForCollection);

    app.get('/api/balance/:collectionId/:accountNum', getBadgeBalance);

    app.post('/api/addToIpfs', addToIpfsHandler);
    app.post('/api/addMerkleTreeToIpfs', addMerkleTreeToIpfsHandler);

    app.get('/api/user/id/:accountNum', async (req: Request, res: Response) => {
        let accountInfo = await client.badgesQueryClient?.badges.getAccountInfoByNumber(Number(req.params.accountNum));
        return res.status(200).send({ ...accountInfo });
    });

    app.get('/api/user/address/:address', async (req: Request, res: Response) => {
        let accountInfo = await client.badgesQueryClient?.badges.getAccountInfo(req.params.address);
        return res.status(200).send({ ...accountInfo });
    });

    // app.get('/api/getChallenge', async (req: Request, res: Response) => {
    //     const chainDriver = getChainDriver(req.body.chain);
    //     setChainDriver(chainDriver);

    //     const message = await createChallenge(
    //         {
    //             domain: 'https://blockin.com',
    //             statement: 'Sign in to this website via Blockin. You will remain signed in until you terminate your browser session.',
    //             address: req.body.address,
    //             uri: 'https://blockin.com/login',
    //             nonce: '0x12345',
    //             expirationDate: '2022-12-22T18:19:55.901Z',
    //             notBefore: undefined,
    //             resources: []
    //         },
    //         req.body.chain
    //     );

    //     return res.status(200).json({ message });
    // });

    // app.get('/api/getChallengeParams', async (req: Request, res: Response) => {
    //     const chainDriver = getChainDriver(req.body.chain);
    //     setChainDriver(chainDriver);

    //     return res.status(200).json({
    //         domain: 'https://blockin.com',
    //         statement: 'Sign in to this website via Blockin. You will remain signed in until you terminate your browser session.',
    //         address: req.body.address,
    //         uri: 'https://blockin.com/login',
    //         nonce: '0x12345',
    //         expirationDate: '2022-12-22T18:19:55.901Z',
    //         notBefore: undefined,
    //         resources: []
    //     });
    // });

    // app.get('api/verifyChallenge', async (req: Request, res: Response) => {
    //     const chainDriver = getChainDriver(req.body.chain);
    //     setChainDriver(chainDriver);

    //     const body = parse(JSON.stringify(req.body)); //little hack to preserve Uint8Arrays

    //     try {
    //         const verificationResponse = await verifyChallenge(
    //             body.originalBytes,
    //             body.signatureBytes,
    //             // {
    //             //     verifyNonceUsingBlockTimestamps: true
    //             // }
    //         );

    //         /**
    //          * Here, Blockin has successfully verified the following five things:
    //          * 1) Challenge is well-formed
    //          * 2) Challenge is valid at present time
    //          * 3) Challenge was signed correctly by user
    //          * 4) User owns all requested assets at time of signing in
    //          * 5) Any additional verification checks specified in the verifyChallenge options
    //          * 
    //          * Below, you can add any other validity checks that you wish to add.
    //          *      -You can use chainDriver.functionName where functionName is in the ChainDriver interface.
    //          *      -You can also use the helper functions exported from Blockin to manipulate and parse challenges
    //          * For both of the above, check out the Blockin documentation.
    //          * 
    //          * Once everything is validated and verified, you can add the logic below to grant the user access to your
    //          * resource. This can be via any method of your choice, such as:
    //          *      -JWTs
    //          *      -Session Tokens
    //          *      -HTTP Only Cookies
    //          *      -Just granting the user access
    //          *      -Or anything else
    //          */

    //         //TODO: cookies

    //         return res.status(200).json({ verified: true, message: verificationResponse.message });
    //     } catch (err) {
    //         return res.status(200).json({ verified: false, message: `${err}` });
    //     }
    // });

    app.post('/api/user/batch', getBatchUsers);


    app.post('/api/collection/refreshMetadata/:collectionId', async (req: Request, res: Response) => {
        //TODO:

        return res.status(200).send({ message: 'Not implemented' });
    });

    app.get('/api/user/portfolio/:accountNum', getPortfolioInfo);

    const init = async () => {
        client = await IndexerStargateClient.connect(process.env.RPC_URL)
        console.log("Connected to chain-id:", await client.getChainId())
        setTimeout(poll, 1)
    }

    const poll = async () => {
        const currentHeight = await client.getHeight()
        const status = await getStatus();
        status.block.txIndex = 0;


        if (status.block.height <= currentHeight - 100)
            console.log(`Catching up ${status.block.height}..${currentHeight}`)
        while (status.block.height < currentHeight) {
            const processing = status.block.height + 1
            process.stdout.cursorTo(0)

            // Get the block
            try {
                const block: Block = await client.getBlock(processing)
                process.stdout.write(`Handling block: ${processing} with ${block.txs.length} txs`)
                await handleBlock(block, status)
                status.block.height = processing
            } catch (e) {
                console.log(e)
                console.log(`Error processing block ${processing}. Retrying...`)
                await ERRORS_DB.bulk({
                    docs: [{
                        _id: `${processing}-${Date.now()}`,
                        block: processing,
                        error: e,
                        status
                    }]
                });

                await new Promise(resolve => setTimeout(resolve, 5000))
            }
        }

        await fetchMetadataInQueue(status);
        await setStatus(status)
        timer = setTimeout(poll, pollIntervalMs)
    }

    const fetchMetadataInQueue = async (status: DbStatus) => {
        const NUM_METADATA_FETCHES = 10;

        //TODO: don't refresh if IPFS and frozen and Promise.all it
        // we also have redundances with addToIpfs and this
        // redundancies with duplicate metadata
        try {

            let numFetchesLeft = NUM_METADATA_FETCHES;

            while (numFetchesLeft > 0 && status.queue.length > 0) {
                const metadataIdsToFetch = [];
                const queueObj = status.queue[0];
                if (queueObj.collection) {
                    metadataIdsToFetch.push(`${queueObj.collectionId}:collection`);
                    numFetchesLeft--;
                    queueObj.collection = false;
                }

                if (queueObj.badgeIds) {
                    while (numFetchesLeft > 0 && queueObj.badgeIds.start <= queueObj.badgeIds.end) {
                        metadataIdsToFetch.push(`${queueObj.collectionId}:${queueObj.badgeIds.start}`);
                        queueObj.badgeIds.start++;
                        numFetchesLeft--;
                    }
                }

                const docs: Docs = await fetchDocsForRequest([], [], metadataIdsToFetch);

                for (const metadataId of metadataIdsToFetch) {
                    try {
                        if (metadataId.includes('collection')) {
                            const collectionMetadata = await fetchMetadata(queueObj.collectionUri);
                            docs.metadata[`${queueObj.collectionId}:collection`] = {
                                ...collectionMetadata,
                                _id: `${queueObj.collectionId}:collection`,
                                _rev: docs.metadata[`${queueObj.collectionId}:collection`]._rev
                            };
                        } else {
                            const badgeId = Number(metadataId.split(':')[1]);
                            const badgeMetadata = await fetchBadgeMetadata({
                                start: badgeId,
                                end: badgeId
                            }, queueObj.badgeUri);

                            docs.metadata[`${queueObj.collectionId}:${badgeId}`] = {
                                ...badgeMetadata[badgeId],
                                id: badgeId,
                                _id: `${queueObj.collectionId}:${badgeId}`,
                                _rev: docs.metadata[`${queueObj.collectionId}:${badgeId}`]._rev
                            };
                        }
                    } catch (e) {
                        console.error(`Error fetching metadata for ${metadataId}`, e);
                    }
                }

                await finalizeDocsForRequest(docs.accounts, docs.collections, docs.metadata);

                if (queueObj.badgeIds.start > queueObj.badgeIds.end) {
                    status.queue.shift();
                } else {
                    //place the queue object at the end
                    const firstElem = status.queue.shift()
                    if (firstElem) status.queue.push(firstElem);
                }
            }
        } catch (e) {
            console.error('Error fetching metadata', e);
            await ERRORS_DB.bulk({
                docs: [{
                    _id: `metadata-${Date.now()}`,
                    error: e,
                    status,

                }]
            });

            await new Promise(resolve => setTimeout(resolve, 5000))
        }
    }

    const handleBlock = async (block: Block, status: any) => {
        let docs: Docs = {
            accounts: {},
            collections: {},
            metadata: {},
        };

        if (0 < block.txs.length) console.log("")
        let txIndex = 0
        while (txIndex < block.txs.length) {
            const txHash: string = toHex(sha256(block.txs[txIndex])).toUpperCase()
            const indexed: IndexedTx | null = await client.getTx(txHash)
            if (!indexed) throw new Error(`Could not find indexed tx: ${txHash}`)
            docs = await handleTx(indexed, status, docs)
            txIndex++
        }

        const events: StringEvent[] = await client.getEndBlockEvents(block.header.height)
        if (0 < events.length) console.log("")
        docs = await handleEvents(events, status, docs)

        await finalizeDocsForRequest(docs.accounts, docs.collections, docs.metadata);
    }

    const handleTx = async (indexed: IndexedTx, status: any, docs: Docs) => {
        let rawLog: any;
        try {
            rawLog = JSON.parse(indexed.rawLog)
        } catch (e) {
            console.log(`Error parsing rawLog for tx ${indexed.hash}. Skipping tx as it most likely failed...`)
            console.log(`Current status: ${JSON.stringify(status)}`);
            return docs;
        }
        const events: StringEvent[] = rawLog.flatMap((log: ABCIMessageLog) => log.events)
        docs = await handleEvents(events, status, docs)
        return docs;
    }

    const handleEvents = async (events: StringEvent[], status: any, docs: Docs): Promise<Docs> => {
        let eventIndex = 0
        while (eventIndex < events.length) {
            docs = await handleEvent(events[eventIndex], status, docs)
            eventIndex++
        }

        return docs;
    }

    const handleEvent = async (event: StringEvent, status: any, docs: Docs): Promise<Docs> => {
        console.log(getAttributeValueByKey(event.attributes, "action"));

        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgNewCollection") {
            docs = await handleMsgNewCollection(event, client, status, docs);
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgMintBadge") {
            docs = await handleMsgMintBadge(event, client, status, docs);
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgClaimBadge") {
            docs = await handleMsgClaimBadge(event, client, status, docs);
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgRequestTransferManager") {
            docs = await handleMsgRequestTransferManager(event, client, status, docs);
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgSetApproval") {
            docs = await handleMsgSetApproval(event, client, status, docs);
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgTransferBadge") {
            docs = await handleMsgTransferBadge(event, client, status, docs);
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgTransferManager") {
            docs = await handleMsgTransferManager(event, client, status, docs);
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgUpdateBytes") {
            docs = await handleMsgUpdateBytes(event, client, status, docs);
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgUpdateDisallowedTransfers") {
            docs = await handleMsgUpdateDisallowedTransfers(event, client, status, docs);
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgUpdateUris") {
            docs = await handleMsgUpdateUris(event, client, status, docs);
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgUpdatePermissions") {
            docs = await handleMsgUpdatePermissions(event, client, status, docs);
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgRegisterAddresses") {
            docs = await handleMsgRegisterAddresses(event, client, status, docs);
        }

        return docs;
    }

    process.on("SIGINT", () => {
        if (timer) clearTimeout(timer)
        server.close(() => {
            console.log("server closed")
            process.exit(0)
        })
    })

    const server: Server = app.listen(port, () => {
        init().catch(console.error).then(() => {
            console.log(`\nserver started at http://localhost:${port}`)
        })
    })
}
