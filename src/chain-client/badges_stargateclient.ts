import { QueryClient, StargateClient, type StargateClientOptions } from '@cosmjs/stargate';
import { Tendermint37Client } from '@cosmjs/tendermint-rpc';
import { type BadgesExtension, setupBadgesExtension } from './queries';

// Credit: Code in this folder is mostly inherited from Cosmos Tutorials (Academy Checkers)
export class BadgesStargateClient extends StargateClient {
  public readonly badgesQueryClient: BadgesExtension | undefined;

  public static async connect(endpoint: string, options?: StargateClientOptions): Promise<BadgesStargateClient> {
    const tmClient = await Tendermint37Client.connect(endpoint);
    return new BadgesStargateClient(tmClient, options);
  }

  protected constructor(tmClient: Tendermint37Client | undefined, options: StargateClientOptions = {}) {
    super(tmClient, options);
    if (tmClient) {
      this.badgesQueryClient = QueryClient.withExtensions(tmClient, setupBadgesExtension);
    }
  }
}
