import { sha256 } from "@cosmjs/crypto"
import { toHex } from "@cosmjs/encoding"
import { Block, IndexedTx } from "@cosmjs/stargate"
import { ABCIMessageLog, Attribute, StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { config } from "dotenv"
import express, { Express, Request, Response } from "express"
import { writeFile } from "fs/promises"
import { Server } from "http"
import { create } from 'ipfs-http-client'
import { handleMsgNewCollection } from "./handlers/handleMsgNewCollection"
import { IndexerStargateClient } from "./indexer_stargateclient"
import { DbType } from "./types"
import _ from "../environment"
import { handleMsgMintBadge } from "./handlers/handleMsgMintBadge"
import { handleMsgClaimBadge } from "./handlers/handleMsgClaimBadge"
import { handleMsgRequestTransferManager } from "./handlers/handleMsgRequestTransferManager"
import { handleMsgSetApproval } from "./handlers/handleMsgSetApproval"
import { handleMsgTransferBadge } from "./handlers/handleMsgTransferBadge"
import { handleMsgTransferManager } from "./handlers/handleMsgTransferManager"
import { handleMsgUpdateBytes } from "./handlers/handleMsgUpdateBytes"
import { handleMsgUpdateDisallowedTransfers } from "./handlers/handleMsgUpdateDisallowedTransfers"
import { handleMsgUpdateUris } from "./handlers/handleMsgUpdateUris"
import { handleMsgUpdatePermissions } from "./handlers/handleMsgUpdatePermissions"
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import last from 'it-last';
const cors = require('cors');
var bodyParser = require('body-parser')


config()

const auth =
    'Basic ' + Buffer.from(process.env.INFURA_ID + ':' + process.env.INFURA_SECRET_KEY).toString('base64');

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
    const dbFile = `${__dirname}/db/db.json`
    const db: DbType = require(dbFile)
    const pollIntervalMs = 5_000 // 5 seconds
    let timer: NodeJS.Timer | undefined
    let client: IndexerStargateClient

    const app: Express = express()
    app.use(cors());

    // parse application/x-www-form-urlencoded
    app.use(bodyParser.urlencoded({ extended: false }))

    // parse application/json
    app.use(bodyParser.json())


    app.get("/", (req: Request, res: Response) => {
        res.send({
            error: "Not implemented",
        })
    })

    app.get("/api/status", (req: Request, res: Response) => {
        res.json({
            block: {
                height: db.status.block.height,
            },
        })
    })

    app.get("/api/collection/:id", (req: Request, res: Response) => {
        res.json({
            collection: db.collections[req.params.id],
        })
    })

    app.post('/api/addToIpfs', async (req: Request, res: Response) => {
        console.log("BODY", req.body);
        const files = [];
        files.push({
            path: 'metadata/collection',
            content: uint8ArrayFromString(JSON.stringify(req.body.collectionMetadata))
        });

        console.log("req.body for addToIPFS: " + JSON.stringify(req.body));
        let individualBadgeMetadata = req.body.individualBadgeMetadata;
        for (let i = 0; i < individualBadgeMetadata.length; i++) {
            files.push(
                {
                    path: 'metadata/' + i,
                    content: uint8ArrayFromString(JSON.stringify(individualBadgeMetadata[i]))
                }
            );
        }

        const result = await last(ipfsClient.addAll(files));

        if (!result) {
            return res.status(400).send({ error: 'No addAll result received' });
        }

        const { path, cid } = result;
        return res.status(200).send({ cid: cid.toString(), path });
    });

    app.post('/api/addMerkleTreeToIpfs', async (req: Request, res: Response) => {
        const files = [];
        files.push({
            path: '',
            content: uint8ArrayFromString(JSON.stringify(req.body.leaves))
        });

        const result = await last(ipfsClient.addAll(files));

        if (!result) {
            return res.status(400).send({ error: 'No addAll result received' });
        }

        const { path, cid } = result;
        return res.status(200).send({ cid: cid.toString(), path });
    });


    //TODO: refresh metadata endpoint


    const saveDb = async () => {
        await writeFile(dbFile, JSON.stringify(db, null, 4))
    }

    const init = async () => {
        client = await IndexerStargateClient.connect(process.env.RPC_URL)
        console.log("Connected to chain-id:", await client.getChainId())
        setTimeout(poll, 1)
    }

    const poll = async () => {
        const currentHeight = await client.getHeight()
        if (db.status.block.height <= currentHeight - 100)
            console.log(`Catching up ${db.status.block.height}..${currentHeight}`)
        while (db.status.block.height < currentHeight) {
            const processing = db.status.block.height + 1
            process.stdout.cursorTo(0)
            // Get the block
            const block: Block = await client.getBlock(processing)
            process.stdout.write(`Handling block: ${processing} with ${block.txs.length} txs`)
            await handleBlock(block)
            db.status.block.height = processing
        }
        await saveDb()
        timer = setTimeout(poll, pollIntervalMs)
    }

    const handleBlock = async (block: Block) => {
        if (0 < block.txs.length) console.log("")
        let txIndex = 0
        while (txIndex < block.txs.length) {
            const txHash: string = toHex(sha256(block.txs[txIndex])).toUpperCase()
            const indexed: IndexedTx | null = await client.getTx(txHash)
            if (!indexed) throw new Error(`Could not find indexed tx: ${txHash}`)
            await handleTx(indexed)
            txIndex++
        }
        const events: StringEvent[] = await client.getEndBlockEvents(block.header.height)
        if (0 < events.length) console.log("")
        await handleEvents(events)
    }

    const handleTx = async (indexed: IndexedTx) => {
        try {
            const rawLog: any = JSON.parse(indexed.rawLog)
            const events: StringEvent[] = rawLog.flatMap((log: ABCIMessageLog) => log.events)
            await handleEvents(events)
        } catch (e) {
            // Skipping if the handling failed. Most likely the transaction failed.
        }
    }

    const handleEvents = async (events: StringEvent[]): Promise<void> => {
        try {
            let eventIndex = 0
            while (eventIndex < events.length) {
                await handleEvent(events[eventIndex])
                eventIndex++
            }
        } catch (e) {
            // Skipping if the handling failed. Most likely the transaction failed.
        }
    }

    const handleEvent = async (event: StringEvent): Promise<void> => {
        console.log(getAttributeValueByKey(event.attributes, "action"));

        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgNewCollection") {
            await handleMsgNewCollection(event, db, client).catch(err => console.log(err));
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgMintBadge") {
            await handleMsgMintBadge(event, db, client).catch(err => console.log(err));
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgClaimBadge") {
            await handleMsgClaimBadge(event, db, client).catch(err => console.log(err));
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgRequestTransferManager") {
            await handleMsgRequestTransferManager(event, db, client).catch(err => console.log(err));
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgSetApproval") {
            await handleMsgSetApproval(event, db, client).catch(err => console.log(err));
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgTransferBadge") {
            await handleMsgTransferBadge(event, db, client).catch(err => console.log(err));
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgTransferManager") {
            await handleMsgTransferManager(event, db, client).catch(err => console.log(err));
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgUpdateBytes") {
            await handleMsgUpdateBytes(event, db, client).catch(err => console.log(err));
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgUpdateDisallowedTransfers") {
            await handleMsgUpdateDisallowedTransfers(event, db, client).catch(err => console.log(err));
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgUpdateUris") {
            await handleMsgUpdateUris(event, db, client).catch(err => console.log(err));
        }
        if (getAttributeValueByKey(event.attributes, "action") == "/bitbadges.bitbadgeschain.badges.MsgUpdatePermissions") {
            await handleMsgUpdatePermissions(event, db, client).catch(err => console.log(err));
        }
    }

    process.on("SIGINT", () => {
        if (timer) clearTimeout(timer)
        saveDb()
            .then(() => {
                console.log(`${dbFile} saved`)
            })
            .catch(console.error)
            .finally(() => {
                server.close(() => {
                    console.log("server closed")
                    process.exit(0)
                })
            })
    })

    const server: Server = app.listen(port, () => {
        init()
            .catch(console.error)
            .then(() => {
                console.log(`\nserver started at http://localhost:${port}`)
            })
    })
}
