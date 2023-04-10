declare global {
    namespace NodeJS {
        interface ProcessEnv {
            RPC_URL: string
            FAUCET_URL: string
            MNEMONIC_TEST_ALICE: string
            ADDRESS_TEST_ALICE: string
            MNEMONIC_TEST_BOB: string
            ADDRESS_TEST_BOB: string
            INFURA_ID: string
            INFURA_SECRET_KEY: string
            DB_URL: string
            SESSION_SECRET: string,
            INFURA_API_KEY: string
            FAUCET_MNEMONIC: string
            FAUCET_ADDRESS: string
        }
    }
}

export { }
