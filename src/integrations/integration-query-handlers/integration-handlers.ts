import axios from 'axios';
import { BigIntify, BlockinAndGroup, BlockinAssetConditionGroup, BlockinOrGroup, NumberType, OwnershipRequirements } from 'bitbadgesjs-sdk';
import { AndGroup, OrGroup } from 'blockin';
import { verifyBitBadgesAssets } from '../../blockin/verifyBitBadgesAssets';
import { getAccountByAddress } from '../../routes/users';
import { type Response } from 'express';

axios.defaults.timeout = 10000;

export const handleIntegrationQuery = async (body: any) => {
  if (body.__type === 'github-contributions') {
    await handleGithubContributionsQuery(body);
  } else if (body.__type === 'min-badge') {
    await handleMinBadgeQuery(body);
  } else if (body.__type === 'discord-server') {
    await handleDiscordServerQuery(body);
  } else if (body.__type === 'must-own-badges') {
    await mustOwnBadgesQuery(body);
  } else {
    throw new Error('Invalid integration query type');
  }
};

export const mustOwnBadgesQuery = async (body: { cosmosAddress: string; ownershipRequirements: any }) => {
  const ownershipRequirementsBase = body.ownershipRequirements;
  if (!ownershipRequirementsBase) {
    throw new Error('No ownership requirements found');
  }

  let ownershipRequirements: BlockinAssetConditionGroup<bigint> | undefined;
  if ((ownershipRequirementsBase as AndGroup<NumberType>).$and) {
    ownershipRequirements = new BlockinAndGroup(ownershipRequirementsBase as AndGroup<NumberType>).convert(BigIntify);
  } else if ((ownershipRequirementsBase as OrGroup<NumberType>).$or) {
    ownershipRequirements = new BlockinOrGroup(ownershipRequirementsBase as OrGroup<NumberType>).convert(BigIntify);
  } else {
    ownershipRequirements = new OwnershipRequirements(ownershipRequirementsBase as OwnershipRequirements<NumberType>).convert(BigIntify);
  }

  try {
    await verifyBitBadgesAssets(ownershipRequirements, body.cosmosAddress);
  } catch (e) {
    throw new Error(e.message);
  }
};

export const handleGithubContributionsQuery = async (body: { github: { username: string; id: string }; repository: string }) => {
  const { github, repository } = body;

  const username = github.username;
  const repositoryOwner = repository.split('/')[0];
  const repositoryName = repository.split('/')[1];

  // Fetch the user's contributions to the specified repository using GitHub API
  const response = await axios.get(`https://api.github.com/repos/${repositoryOwner}/${repositoryName}/contributors`);

  // Check if the user has contributed (search for their username in the contributors list)
  const userContributions = response.data.filter((contributor: any) => contributor.login === username);

  // Send the response based on whether the user has contributed or not
  if (userContributions.length > 0) {
  } else {
    throw new Error('User has not contributed to the specified repository');
  }
};

const handleMinBadgeQuery = async (body: { cosmosAddress: string; minBalance: number }) => {
  const minBalance = BigInt(body.minBalance);
  const account = await getAccountByAddress(undefined, {} as Response, body.cosmosAddress, { fetchBalance: true });
  if (account.balance && BigInt(account.balance.amount) >= minBalance) {
  } else {
    throw new Error('Insufficient balance');
  }
};

const handleDiscordServerQuery = async (body: {
  serverId: string;
  discord: { id: string; username: string; discriminator: string; access_token: string };
}) => {
  const { serverId, discord: discordInfo } = body;

  const userId = discordInfo.id;
  const guildId = serverId;
  const access_token = discordInfo.access_token;
  if (!discordInfo.id || !discordInfo.username || !access_token) {
    throw new Error('Invalid discord user details');
  }

  if (!guildId) {
    throw new Error('Server ID not provided');
  }

  if (guildId) {
    // Use the access token to fetch user information
    const userResponse = await axios.get('https://discord.com/api/users/@me/guilds/' + guildId + '/member', {
      headers: {
        Authorization: `Bearer ${access_token}`
      }
    });
    if (!(userResponse.data && userResponse.data.user.id === userId)) {
      throw new Error('User not in server');
    }
  }
};
