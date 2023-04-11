import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { SigningStargateClient, assertIsDeliverTxSuccess } from "@cosmjs/stargate";
import { Mutex } from "async-mutex";
import { Request, Response } from "express";
import { AuthenticatedRequest } from "src/blockin/blockin_handlers";
import { AIRDROP_DB } from "../db/db";

// create a mutex to protect the documentMutexes map
const faucetMutex = new Mutex();

export const sendTokensFromFaucet = async (expressReq: Request, res: Response) => {
    try {
        const req = expressReq as AuthenticatedRequest;
        if (!req.session.blockin || !req.session.cosmosAddress) {
            return res.status(401).send({ authenticated: false, message: 'You must Sign In w/ Ethereum.' });
        }

        // acquire the mutex for the documentMutexes map
        const authReturnValue = await faucetMutex.runExclusive(async () => {
            const req = expressReq as AuthenticatedRequest;
            if (!req.session.blockin || !req.session.cosmosAddress) {
                return { authenticated: false, message: 'You must Sign In w/ Ethereum.' };
            }

            //if no error, already has doc which means we have airdropped
            let alreadyAirdropped = await AIRDROP_DB.head(req.session.cosmosAddress).then(() => true).catch((e) => {
                //Only if missing error
                if (e.statusCode === 404) {
                    return false;
                }
                return true;
            });

            if (alreadyAirdropped) {
                return { message: "Already airdropped" };
            }

            return null;
        });

        if (authReturnValue) {
            return res.status(401).send(authReturnValue);
        }


        //Sign and send a MsgSend transaction
        const cosmosAddress = req.session.cosmosAddress;
        const fromMnemonic = process.env.FAUCET_MNEMONIC;
        const to = cosmosAddress;

        //Get cosmos address form mnemonic
        const wallet = await DirectSecp256k1HdWallet.fromMnemonic(fromMnemonic);
        const [firstAccount] = await wallet.getAccounts();

        const signingClient = await SigningStargateClient.connectWithSigner(
            process.env.RPC_URL,
            wallet
        );

        const amount = {
            denom: "badge",
            amount: "10",
        };


        const fee = {
            amount: [
                {
                    denom: "badge",
                    amount: "0",
                },
            ],
            gas: "180000",
        };
        const result = await signingClient.sendTokens(firstAccount.address, to, [amount], fee, "Have fun with your star coins");
        assertIsDeliverTxSuccess(result);

        const returnValue = await faucetMutex.runExclusive(async () => {
            await AIRDROP_DB.insert({ airdropped: true, _id: req.session.cosmosAddress, hash: result.transactionHash, timestamp: Date.now() });

            return { result };
        });

        return res.status(200).send(returnValue);
    } catch (e) {
        console.error(e);
        return res.status(500).send({ error: 'Internal server error handling airdrop.' });
    }
}
