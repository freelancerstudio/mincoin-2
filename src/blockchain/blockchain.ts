import * as Validator from "./validator"
import * as Util from "../util"
import * as Network from "../network/"
import { UnspentTxOut, Transaction, processTransactions } from '../transaction/'

class Block {
    public index: number;
    public hash: string;
    public previousHash: string;
    public timestamp: number;
    public data: Transaction[];
    // difficulty: 
    // It defines how many prefixing zeros the block hash must have, in order for the block to be valid
    // We can control how often blocks are mined by changing the difficulty. (Proof-of-Work)
    public difficulty: number;
    // nonce:
    // In order to find a hash that satisfies the difficulty, 
    // we must be able to calculate different hashes for the same content of the block. 
    // This is done by modifying the nonce parameter
    public nonce: number;

    constructor(
        index: number,
        hash: string,
        previousHash: string,
        timestamp: number,
        data: Transaction[],
        difficulty: number,
        nonce: number
    ) {
        this.index = index;
        this.hash = hash;
        this.previousHash = previousHash;
        this.timestamp = timestamp;
        this.data = data;
        this.difficulty = difficulty;
        this.nonce = nonce;
    }
}

// The first block of the blockchain is always a so-called “genesis-block”, which is hard coded.
const genesisBlock: Block = new Block(0, "816534932c2b7154836da6afc367695e6337db8a921823784c14378abed4f7d7", "0", 1588310945, [], 0, 0)

// A in-memory Javascript array is used to store the blockchain. 
let blockchain: Block[] = [genesisBlock]

// The list of Unspent Transactions Outputs (UTXO): it contains data(amount) of coins that can be used(spent) by owner.
let unspentTxOuts: UnspentTxOut[] = [];

const getBlockchain = (): Block[] => blockchain

const getGenesisBlock = (): Block => genesisBlock

const getLatestBlock = (): Block => blockchain[blockchain.length - 1]

/**
 * BLOCK_GENERATION_INTERVAL (in seconds)
 * defines how often a block should be found. (in Bitcoin this value is 10 minutes)
 */
const BLOCK_GENERATION_INTERVAL: number = 10;  // 10. so we expect a new block is mined in 10 secs.
/**
 * DIFFICULTY_ADJUSTMENT_INTERVAL (in blocks)
 * defines how often the difficulty should adjust to the increasing or decreasing network hashrate. (in Bitcoin this value is 2016 blocks)
 */
const DIFFICULTY_ADJUSTMENT_INTERVAL: number = 10;  // 10. so we compare timestamp for every 10 blocks.

const getDifficulty = (aBlockchain: Block[]): number => {
    const latestBlock: Block = aBlockchain[blockchain.length - 1];
    if (latestBlock.index % DIFFICULTY_ADJUSTMENT_INTERVAL === 0 && latestBlock.index !== 0) {
        return getAdjustedDifficulty(latestBlock, aBlockchain);
    } else {
        return latestBlock.difficulty;
    }
};

/**
 * getAccumulatedDifficulty
 * @param aBlockchain 
 * @description 
 *  We have to use the 2^difficulty as we chose the difficulty to represent the number of zeros that must prefix the hash in binary format.
 *  For instance, if we compare the difficulties of 5 and 11, it requires 2^(11-5) = 2^6 times more work to find a block with latter difficulty.
 */
const getAccumulatedDifficulty = (aBlockchain: Block[]): number => {
    return aBlockchain
        .map((block) => block.difficulty)
        .map((difficulty) => Math.pow(2, difficulty))
        .reduce((a, b) => a + b);
};

/**
 * getAdjustedDifficulty
 * @param latestBlock 
 * @param aBlockchain 
 * @description How to agree on a difficulty of the block
 */
const getAdjustedDifficulty = (latestBlock: Block, aBlockchain: Block[]) => {
    const prevAdjustmentBlock: Block = aBlockchain[blockchain.length - DIFFICULTY_ADJUSTMENT_INTERVAL];
    const timeExpected: number = BLOCK_GENERATION_INTERVAL * DIFFICULTY_ADJUSTMENT_INTERVAL;
    const timeTaken: number = latestBlock.timestamp - prevAdjustmentBlock.timestamp;
    if (timeTaken < timeExpected / 2) {
        // Increase the difficulty since the time took less than expected.
        return prevAdjustmentBlock.difficulty + 1;
    } else if (timeTaken > timeExpected * 2) {
        // Decrease the difficulty since the time took more than expected.
        return prevAdjustmentBlock.difficulty - 1;
    } else {
        // Agree on the current difficulty
        return prevAdjustmentBlock.difficulty;
    }
};

const generateNextBlock = (data: Transaction[]): Block => {
    const previousBlock: Block = getLatestBlock()
    const nextIndex: number = previousBlock.index + 1
    const nextTimestamp: number = Util.getCurrentTimestamp()
    const difficulty: number = getDifficulty(getBlockchain());
    const newBlock: Block = findBlock(nextIndex, previousBlock.hash, nextTimestamp, data, difficulty);

    if (addBlockToChain(newBlock)) {
        Network.broadcastLatest()
        return newBlock
    } else {
        return null;
    }
}

/**
 * findBlock
 * @param index 
 * @param previousHash 
 * @param timestamp 
 * @param data 
 * @param difficulty 
 * @description to find a valid block hash, we must increase the nonce as until we get a valid hash.
 */
const findBlock = (index: number, previousHash: string, timestamp: number, data: Transaction[], difficulty: number): Block => {
    let nonce = 0;
    while (true) {
        const hash: string = Util.calculateHash(index, previousHash, timestamp, data, difficulty, nonce);
        if (Validator.hashMatchesDifficulty(hash, difficulty)) {
            return new Block(index, hash, previousHash, timestamp, data, difficulty, nonce);
        }
        nonce++;
    }
};

const addBlockToChain = (newBlock: Block): Boolean => {
    if (Validator.isValidNewBlock(newBlock, getLatestBlock())) {
        const newUnspentTxOuts: UnspentTxOut[] = processTransactions(newBlock.data, unspentTxOuts, newBlock.index);
        if (newUnspentTxOuts === null) {
            return false;
        } else {
            // Adding new block to chain
            blockchain.push(newBlock);
            // Updating unspent transaction outputs
            unspentTxOuts = newUnspentTxOuts
            return true;
        }
    }
    return false
}

const replaceChain = (newBlockchain: Block[]) => {
    /**
     * Resolving confilicts
     * 
     * There should always be only one explicit set of blocks in the chain at a given time.
     * In case of conflicts,
     * we choose the chain that has the most cumulative difficulty. (Chain w/ higher difficulty dominates)
     * e.g. the "Chain B" is the "correct" chain in the below
     *  Chain A: 5 blocks w/ difficulty 4 & 5: 2^4 + 2^4 + 2^4 + 2^4 + 2^5 = 96
     *  Chain B: 2 blocks w/ difficulty 6: 2^6 + 2^6 = 128
     */
    if (Validator.isValidChain(newBlockchain) && getAccumulatedDifficulty(newBlockchain) > getAccumulatedDifficulty(getBlockchain())) {
        console.log('Received blockchain is valid. Replacing current blockchain with received blockchain');
        blockchain = newBlockchain;
        Network.broadcastLatest();
    } else {
        console.log('Received blockchain invalid');
    }
}

export default Block
export {
    getBlockchain,
    getGenesisBlock,
    getLatestBlock,
    generateNextBlock,
    addBlockToChain,
    replaceChain
}