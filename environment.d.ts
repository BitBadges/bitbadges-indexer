declare global {
  namespace NodeJS {
    interface ProcessEnv {
      FRONTEND_URL: string // ex: "https://localhost:3000"
      RPC_URLS: string // ex: "https://blockchain:26657"
      API_URL: string // ex: "https://blockchain:1317"
      INFURA_ID: string //IPFS details
      INFURA_SECRET_KEY: string
      DB_URL: string // ex: "http://username:password@localhost:5984"
      SESSION_SECRET: string, // ex: "mysecret"
      INFURA_API_KEY: string  //API key for infura
      FAUCET_MNEMONIC: string // ex: "big wrestle ... "
      FAUCET_ADDRESS: string // ex: "cosmos1..."
      SYM_KEY: string // ex: "mykey"
      LOAD_BALANCER_ID: string //string number ex: "1"
      FETCH_TIMEOUT: string //string number ex: "30000"
      MIN_TIME_BETWEEN_REFRESHES: string //string number ex: "60000"
      NUM_METADATA_FETCHES_PER_BLOCK: string //string number ex: "25"
      BASE_DELAY: string //string number ex: "60000"
      PORT: string //string number ex: "3000"
      SPACES_ACCESS_KEY_ID: string //string number ex: "1"
      SPACES_SECRET_ACCESS_KEY: string //string number ex: "1"
      POLL_INTERVAL_MS: string //string number ex: "1000"
      URI_POLL_INTERVAL_MS: string //string number ex: "1000"
      DISABLE_URI_POLLER: string //string number ex: "false"
      DISABLE_BLOCKCHAIN_POLLER: string //string number ex: "false"
      TIME_MODE: string //string number ex: "false"
      QUEUE_TIME_MODE: string //string number ex: "false"
      DEV_MODE: string //string number ex: "false"
    }
  }
}

export { }