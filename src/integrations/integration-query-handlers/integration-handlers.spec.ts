import { handleGithubContributionsQuery, handleIntegrationQuery } from '../integration-query-handlers/integration-handlers'; // Replace './yourFile' with the correct path to your file

describe('handleIntegrationQuery', () => {
  it('should throw an error for invalid integration query type', async () => {
    await expect(handleIntegrationQuery({ __type: 'invalid-type' })).rejects.toThrow('Invalid integration query type');
  });

  it('should throw an error if user has not contributed to the specified repository', async () => {
    await expect(
      handleGithubContributionsQuery({ github: { username: 'trevormil', id: '123' }, repository: 'testowner/testrepo' })
    ).rejects.toThrow();
  });

  it('should not throw an error if user has contributed to the specified repository', async () => {
    const response = await handleGithubContributionsQuery({ github: { username: 'trevormil', id: '123' }, repository: 'bitbadges/bitbadgeschain' });
    expect(response).toBeUndefined();
  });

  it('should throw an error if user has not contributed to the specified repository - valid repo', async () => {
    await expect(
      handleGithubContributionsQuery({ github: { username: 'bob123', id: '123' }, repository: 'bitbadges/bitbadgeschain' })
    ).rejects.toThrow();
  });

  it('should throw an error if user does not does meet min-badge balance', async () => {
    await expect(
      handleIntegrationQuery({ __type: 'min-badge', cosmosAddress: 'cosmos1uqxan5ch2ulhkjrgmre90rr923932w38tn33gu', minBalance: 200 })
    ).rejects.toThrow();
  });

  it('should not throw an error if user meets min-badge balance', async () => {
    const response = await handleIntegrationQuery({
      __type: 'min-badge',
      cosmosAddress: 'cosmos1uqxan5ch2ulhkjrgmre90rr923932w38tn33gu',
      minBalance: 0
    });
    expect(response).toBeUndefined();
  });

  //TODO: Test Discord (requires access token?)
  // it('should test discord server query', async () => {
  //   const response = await handleIntegrationQuery({
  //     __type: 'discord-server',
  //     discordInfo: {
  //       id: '123',
  //       username: 'test',
  //       discriminator: '0'
  //     },
  //     serverId: '123'
  //   });

  //   expect(response).toBeUndefined();
  // });
});
