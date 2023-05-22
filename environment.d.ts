declare global {
    namespace NodeJS {
        interface ProcessEnv {
            RPC_URL: string // ex: "https://blockchain:26657"
            API_URL: string // ex: "https://blockchain:1317"
            INFURA_ID: string //IPFS details
            INFURA_SECRET_KEY: string
            DB_URL: string // ex: "http://username:password@localhost:5984"
            SESSION_SECRET: string, // ex: "mysecret"
            INFURA_API_KEY: string  //API key for infura
            FAUCET_MNEMONIC: string // ex: "big wrestle ... "
            FAUCET_ADDRESS: string // ex: "cosmos1..."
            SYM_KEY: string // ex: "mykey"
        }
    }
}

export { }
