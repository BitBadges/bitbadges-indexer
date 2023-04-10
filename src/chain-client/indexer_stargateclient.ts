import { StargateClientOptions } from "@cosmjs/stargate"
import { BlockResultsResponse, Tendermint34Client } from "@cosmjs/tendermint-rpc"
import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { BadgesStargateClient } from "./badges_stargateclient"
import { convertTendermintEvents } from "./events"

export class IndexerStargateClient extends BadgesStargateClient {
    private readonly myTmClient: Tendermint34Client

    public static async connect(
        endpoint: string,
        options: StargateClientOptions = {},
    ): Promise<IndexerStargateClient> {
        const tmClient = await Tendermint34Client.connect(endpoint)
        return new IndexerStargateClient(tmClient, options)
    }

    protected constructor(tmClient: Tendermint34Client, options: StargateClientOptions) {
        super(tmClient, options)
        this.myTmClient = tmClient
    }

    public async getEndBlockEvents(height: number): Promise<StringEvent[]> {
        const results: BlockResultsResponse = await this.myTmClient.blockResults(height)

        return convertTendermintEvents(results.endBlockEvents)
    }



    // public async simulateTx() {
    //     const sendMsg: MsgSendEncodeObject = {
    //         typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    //         value: {
    //             fromAddress: 'cosmos12mjdk86h8xrj6flnmf8796w09q2m874cnakpfu',
    //             toAddress: 'cosmos1t5sh93zc6pl8g3hpqyy6v55eza2ewwqem07x09',
    //             amount: [...amount],
    //         },
    //     };

    //     // const registry = new Registry();
    //     // this.forceGetQueryClient().tx.simulate(
    //     //     [
    //     //         registry.encodeAsAny(sendMsg)
    //     //     ],
    //     //     '',
    // }
}
