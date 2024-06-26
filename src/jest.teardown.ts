// jest.teardown.js
import { gracefullyShutdown } from './indexer';

module.exports = async () => {
  await gracefullyShutdown();

  //Send CTRL+C to the process
  process.kill(process.pid, 'SIGINT');
  process.exit(0);
};
