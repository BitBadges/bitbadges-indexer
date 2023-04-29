import { sha256 } from "@cosmjs/crypto"
import { toHex } from "@cosmjs/encoding"
import { DecodedTxRaw, decodeTxRaw } from "@cosmjs/proto-signing"
import { Block, IndexedTx } from "@cosmjs/stargate"
import { DbStatus, Docs } from "bitbadgesjs-utils"
import * as tx from 'bitbadgesjs-proto/dist/proto/badges/tx'
import { MessageMsgClaimBadge, MessageMsgDeleteCollection, MessageMsgMintBadge, MessageMsgNewCollection, MessageMsgRegisterAddresses, MessageMsgRequestTransferManager, MessageMsgSetApproval, MessageMsgTransferBadge, MessageMsgTransferManager, MessageMsgUpdateBytes, MessageMsgUpdateDisallowedTransfers, MessageMsgUpdatePermissions, MessageMsgUpdateUris } from 'bitbadgesjs-transactions'
import { ABCIMessageLog, StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { IndexerStargateClient } from "./chain-client/indexer_stargateclient"
import { ERRORS_DB, finalizeDocsForRequest } from "./db/db"
import { getStatus, setStatus } from "./db/status"
import { client, refreshQueueMutex, setClient, setTimer } from "./indexer"
import { fetchUriInQueue } from "./metadata-queue"
import { handleMsgClaimBadge } from "./tx-handlers/handleMsgClaimBadge"
import { handleMsgDeleteCollection } from "./tx-handlers/handleMsgDeleteCollection"
import { handleMsgMintBadge } from "./tx-handlers/handleMsgMintBadge"
import { handleMsgNewCollection } from "./tx-handlers/handleMsgNewCollection"
import { handleMsgRegisterAddresses } from "./tx-handlers/handleMsgRegisterAddresses"
import { handleMsgRequestTransferManager } from "./tx-handlers/handleMsgRequestTransferManager"
import { handleMsgSetApproval } from "./tx-handlers/handleMsgSetApproval"
import { handleMsgTransferBadge } from "./tx-handlers/handleMsgTransferBadge"
import { handleMsgTransferManager } from "./tx-handlers/handleMsgTransferManager"
import { handleMsgUpdateBytes } from "./tx-handlers/handleMsgUpdateBytes"
import { handleMsgUpdateDisallowedTransfers } from "./tx-handlers/handleMsgUpdateDisallowedTransfers"
import { handleMsgUpdatePermissions } from "./tx-handlers/handleMsgUpdatePermissions"
import { handleMsgUpdateUris } from "./tx-handlers/handleMsgUpdateUris"


const pollIntervalMs = 1_000
let outageTime: Date | undefined

export const poll = async () => {
    try {
        // Connect to the chain client (this is first-time only)
        // This could be in init() but it is here in case indexer is started w/o the chain running
        if (!client) {
            const newClient = await IndexerStargateClient.connect(process.env.RPC_URL)
            console.log("Connected to chain-id:", await newClient.getChainId())
            setClient(newClient)
        }


        // We fetch initial status at beginning and do not write anything in DB until caught up to current block
        // IMPORTANT: This is critical because we do not want to double-handle txs if we fail in middle of block
        const currentHeight = await client.getHeight();

        await refreshQueueMutex.runExclusive(async () => {
            const status = await getStatus();
            let docs: Docs = {
                accounts: {},
                collections: {},
                metadata: {},
                accountNumbersMap: {},
                activityToAdd: []
            };

            if (status.block.height <= currentHeight - 100) {
                console.log(`Catching up ${status.block.height}..${currentHeight}`)
            }

            //Handle each block in sequence
            while (status.block.height < currentHeight) {
                const processing = status.block.height + 1
                process.stdout.cursorTo(0);

                const block: Block = await client.getBlock(processing)
                process.stdout.write(`Handling block: ${processing} with ${block.txs.length} txs`)
                docs = await handleBlock(block, status, docs)
                status.block.height++;
            }

            docs = await fetchUriInQueue(status, docs);

            //Right now, we are banking on all these DB updates succeeding together every time. 
            //If there is a failure in the middle, it could be bad. //TODO in the future.
            await finalizeDocsForRequest(docs);


            await setStatus(status)

            //Handle printing of status if there was an outage
            if (outageTime) {
                process.stdout.write('\n');
                console.log(`Reconnected to chain at block ${status.block.height} after outage of ${new Date().getTime() - outageTime.getTime()} ms`)
            }
            outageTime = undefined;
        });
    } catch (e) {
        //Error handling

        //Attempt to reconnect to chain client
        try {
            outageTime = outageTime || new Date();
            const newClient = await IndexerStargateClient.connect(process.env.RPC_URL)
            setClient(newClient)
            process.stdout.write('\n');
            console.log("Connected to chain-id:", await newClient.getChainId())
        } catch (e) {
            process.stdout.cursorTo(0);
            process.stdout.clearLine(1);
            process.stdout.write(`Error connecting to chain client. ${outageTime ? `Outage Time: ${outageTime.toISOString()}` : ''} Retrying....`)
        }

        //Log error to DB, unless it is a connection refused error
        if (e.code !== 'ECONNREFUSED') {
            console.log(e);
            await ERRORS_DB.bulk({
                docs: [{
                    _id: `${Date.now()}`,
                    error: e,
                }]
            });
        }
    }

    const newTimer = setTimeout(poll, pollIntervalMs)
    setTimer(newTimer);
}



const handleBlock = async (block: Block, status: DbStatus, docs: Docs) => {
    if (0 < block.txs.length) console.log("")

    //Handle each tx in sequence
    let txIndex = 0
    while (txIndex < block.txs.length) {
        const txHash: string = toHex(sha256(block.txs[txIndex])).toUpperCase()
        const indexed: IndexedTx | null = await client.getTx(txHash)
        if (!indexed) throw new Error(`Could not find indexed tx: ${txHash}`)
        docs = await handleTx(indexed, status, docs)
        txIndex++
    }

    // Handle end block events
    // const events: StringEvent[] = await client.getEndBlockEvents(status.block.height)
    // if (0 < events.length) console.log("")
    // docs = await handleEvents(events, status, docs)

    return docs;
}

const handleTx = async (indexed: IndexedTx, status: DbStatus, docs: Docs) => {
    let rawLog: any;
    let decodedTx: DecodedTxRaw;
    try {
        rawLog = JSON.parse(indexed.rawLog)
    } catch (e) {
        console.log(`Error parsing rawLog for tx ${indexed.hash}. Skipping tx as it most likely failed...`)
        console.log(`Current status: ${JSON.stringify(status)}`);
        return docs;
    }



    decodedTx = decodeTxRaw(indexed.tx);

    const NUM_TXS_TO_AVERAGE = 1000;
    if (decodedTx.authInfo.fee) {
        const gasLimit = decodedTx.authInfo.fee.gasLimit;
        // console.log(decodedTx.authInfo.fee);
        for (const coin of decodedTx.authInfo.fee.amount) {
            const feeAmount = coin.amount;
            const feeDenom = coin.denom;

            if (feeDenom === "badge") {
                const gasPrice = Number(feeAmount) / gasLimit.toNumber();

                status.lastXGasPrices.push(gasPrice);
                if (status.lastXGasPrices.length > NUM_TXS_TO_AVERAGE) {
                    status.lastXGasPrices.shift();
                }

                status.gasPrice = status.lastXGasPrices.reduce((a, b) => a + b, 0) / status.lastXGasPrices.length;
            }
        }
    }


    for (const message of decodedTx.body.messages) {
        const typeUrl = message.typeUrl;
        const value = message.value;
        switch (typeUrl) {
            case "/bitbadges.bitbadgeschain.badges.MsgUpdateUris":
                const urisMsg: MessageMsgUpdateUris = tx.bitbadges.bitbadgeschain.badges.MsgUpdateUris.deserialize(value).toObject() as MessageMsgUpdateUris;
                docs = await handleMsgUpdateUris(urisMsg, status, docs);
                break;
            case "/bitbadges.bitbadgeschain.badges.MsgUpdatePermissions":
                const permissionsMsg: MessageMsgUpdatePermissions = tx.bitbadges.bitbadgeschain.badges.MsgUpdatePermissions.deserialize(value).toObject() as MessageMsgUpdatePermissions;
                docs = await handleMsgUpdatePermissions(permissionsMsg, status, docs);
                break;
            case "/bitbadges.bitbadgeschain.badges.MsgUpdateDisallowedTransfers":
                const disallowedMsg: MessageMsgUpdateDisallowedTransfers = tx.bitbadges.bitbadgeschain.badges.MsgUpdateDisallowedTransfers.deserialize(value).toObject() as MessageMsgUpdateDisallowedTransfers;
                docs = await handleMsgUpdateDisallowedTransfers(disallowedMsg, status, docs);
                break;
            case "/bitbadges.bitbadgeschain.badges.MsgUpdateBytes":
                const bytesMsg: MessageMsgUpdateBytes = tx.bitbadges.bitbadgeschain.badges.MsgUpdateBytes.deserialize(value).toObject() as MessageMsgUpdateBytes;
                docs = await handleMsgUpdateBytes(bytesMsg, status, docs);
                break;
            case "/bitbadges.bitbadgeschain.badges.MsgRegisterAddresses":
                const registerMsg: MessageMsgRegisterAddresses = tx.bitbadges.bitbadgeschain.badges.MsgRegisterAddresses.deserialize(value).toObject() as MessageMsgRegisterAddresses;
                docs = await handleMsgRegisterAddresses(registerMsg, status, docs);
                break;
            case "/bitbadges.bitbadgeschain.badges.MsgTransferManager":
                const transferManagerMsg: MessageMsgTransferManager = tx.bitbadges.bitbadgeschain.badges.MsgTransferManager.deserialize(value).toObject() as MessageMsgTransferManager;

                docs = await handleMsgTransferManager(transferManagerMsg, status, docs);
                break;
            case "/bitbadges.bitbadgeschain.badges.MsgSetApproval":
                const setApprovalMsg: MessageMsgSetApproval = tx.bitbadges.bitbadgeschain.badges.MsgSetApproval.deserialize(value).toObject() as MessageMsgSetApproval;
                docs = await handleMsgSetApproval(setApprovalMsg, status, docs);
                break;
            case "/bitbadges.bitbadgeschain.badges.MsgRequestTransferManager":
                const requestTransferManagerMsg: MessageMsgRequestTransferManager = tx.bitbadges.bitbadgeschain.badges.MsgRequestTransferManager.deserialize(value).toObject() as MessageMsgRequestTransferManager;
                docs = await handleMsgRequestTransferManager(requestTransferManagerMsg, status, docs);
                break;
            case "/bitbadges.bitbadgeschain.badges.MsgClaimBadge":
                const claimMsg: MessageMsgClaimBadge = tx.bitbadges.bitbadgeschain.badges.MsgClaimBadge.deserialize(value).toObject() as MessageMsgClaimBadge;
                docs = await handleMsgClaimBadge(claimMsg, status, docs);
                break;
            case "/bitbadges.bitbadgeschain.badges.MsgTransferBadge":
                const transferMsg: MessageMsgTransferBadge = tx.bitbadges.bitbadgeschain.badges.MsgTransferBadge.deserialize(value).toObject() as MessageMsgTransferBadge;
                docs = await handleMsgTransferBadge(transferMsg, status, docs);
                break;
            case "/bitbadges.bitbadgeschain.badges.MsgNewCollection":
                const newCollectionMsg: MessageMsgNewCollection = tx.bitbadges.bitbadgeschain.badges.MsgNewCollection.deserialize(value).toObject() as MessageMsgNewCollection;
                docs = await handleMsgNewCollection(newCollectionMsg, status, docs);
                break;
            case "/bitbadges.bitbadgeschain.badges.MsgMintBadge":
                const newMintMsg: MessageMsgMintBadge = tx.bitbadges.bitbadgeschain.badges.MsgMintBadge.deserialize(value).toObject() as MessageMsgMintBadge;
                docs = await handleMsgMintBadge(newMintMsg, status, docs);
                break;
            case "/bitbadges.bitbadgeschain.badges.MsgDeleteCollection":
                const newDeleteMsg: MessageMsgDeleteCollection = tx.bitbadges.bitbadgeschain.badges.MsgDeleteCollection.deserialize(value).toObject() as MessageMsgDeleteCollection;
                docs = await handleMsgDeleteCollection(newDeleteMsg, status, docs);
                break;
            default:
                break;
        }
    }

    const events: StringEvent[] = rawLog.flatMap((log: ABCIMessageLog) => log.events)
    docs = await handleEvents(events, status, docs)
    return docs;
}

const handleEvents = async (events: StringEvent[], status: DbStatus, docs: Docs): Promise<Docs> => {
    // let eventIndex = 0
    // while (eventIndex < events.length) {
    //     docs = await handleEvent(events[eventIndex], status, docs)
    //     eventIndex++
    // }

    return docs;
}

// const handleEvent = async (event: StringEvent, status: DbStatus, docs: Docs): Promise<Docs> => { }