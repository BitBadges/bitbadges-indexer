declare global {
  namespace NodeJS {
    interface ProcessEnv {
      FRONTEND_URL: string // ex: "https://localhost:3000"
      RPC_URLS: string // ex: "[\"https://blockchain:26657\"]"
      API_URL: string // ex: "https://blockchain:1317"

      INFURA_ID: string //Infura IPFS details
      INFURA_SECRET_KEY: string

      DB_URL: string // CouchDB URL w/ proper authentication: ex: "http://username:password@localhost:5984"
      CLUSTERED_DB_URL: string // CouchDB URL w/ proper authentication: ex: "http://username:password@localhost:5984"

      SESSION_SECRET: string, //Secret entropy for session cookies ex: "mysecret"
      INFURA_API_KEY: string  //API key for infura

      FAUCET_MNEMONIC: string // ex: "big wrestle ... "
      FAUCET_ADDRESS: string // ex: "cosmos1..."

      SYM_KEY: string // Symmetric encryption key ex: "mykey"

      LOAD_BALANCER_ID: string //string number ex: "1"

      //All times are UNIX milliseconds
      FETCH_TIMEOUT: string //string number ex: "30000"
      MIN_TIME_BETWEEN_REFRESHES: string //string number ex: "60000"
      NUM_METADATA_FETCHES_PER_BLOCK: string //string number ex: "25"
      BASE_DELAY: string //string number ex: "60000"
      POLL_INTERVAL_MS: string //string number ex: "1000"
      URI_POLL_INTERVAL_MS: string //string number ex: "1000"

      PORT: string //string number ex: "3000"

      //Digital Ocean Spaces details
      SPACES_ACCESS_KEY_ID: string //string number ex: "1"
      SPACES_SECRET_ACCESS_KEY: string //string number ex: "1"

      //Turn off the URI or blockchain pollers
      DISABLE_URI_POLLER: string //string boolean ex: "false"
      DISABLE_BLOCKCHAIN_POLLER: string //string boolean ex: "false"
      DISABLE_API: string //string boolean ex: "false"

      //Development flags
      TIME_MODE: string //boolean string ex: "false"
      QUEUE_TIME_MODE: string //boolean string ex: "false"
      DEV_MODE: string //boolean string ex: "false"

      //Heartbeat mode
      HEARTBEAT_MODE: string //boolean string ex: "false"
      PARENT_PROCESS_URL: string //string ex: "https://api.bitbadges.io"

      MORALIS_API_KEY: string //string ex: "1"
    }
  }
}

export { }