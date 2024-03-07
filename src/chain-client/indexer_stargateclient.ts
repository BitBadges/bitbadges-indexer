import { type StargateClientOptions } from '@cosmjs/stargate';
import { Tendermint37Client } from '@cosmjs/tendermint-rpc';
import { BadgesStargateClient } from './badges_stargateclient';

export class IndexerStargateClient extends BadgesStargateClient {
  public static async connect(endpoint: string, options: StargateClientOptions = {}): Promise<IndexerStargateClient> {
    const tmClient = await Tendermint37Client.connect(endpoint);
    return new IndexerStargateClient(tmClient, options);
  }

  protected constructor(tmClient: Tendermint37Client, options: StargateClientOptions) {
    super(tmClient, options);
  }
}
