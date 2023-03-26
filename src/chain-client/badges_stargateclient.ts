import { QueryClient, StargateClient, StargateClientOptions } from "@cosmjs/stargate"
import { BroadcastTxSyncResponse, Tendermint34Client } from "@cosmjs/tendermint-rpc"
import { BadgesExtension, setupBadgesExtension } from "./queries"

export class BadgesStargateClient extends StargateClient {
    public readonly badgesQueryClient: BadgesExtension | undefined

    public static async connect(
        endpoint: string,
        options?: StargateClientOptions,
    ): Promise<BadgesStargateClient> {
        const tmClient = await Tendermint34Client.connect(endpoint)
        return new BadgesStargateClient(tmClient, options)
    }

    protected constructor(tmClient: Tendermint34Client | undefined, options: StargateClientOptions = {}) {
        super(tmClient, options)
        if (tmClient) {
            this.badgesQueryClient = QueryClient.withExtensions(tmClient, setupBadgesExtension)
        }
    }

    public async tmBroadcastTxSync(tx: Uint8Array): Promise<BroadcastTxSyncResponse> {
        return this.forceGetTmClient().broadcastTxSync({ tx })
    }
}
