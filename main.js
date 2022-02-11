// BURNING TOKENS BREAKS THIS

const { Client, Intents } = require("discord.js");
const request = require("request");
const https = require("https");
const fs = require("fs");
const Web3 = require("web3");
const { v4: uuidv4 } = require('uuid');

let web3 = new Web3("https://api.s0.b.hmny.io");

const keys = require("./keys");

MongoClient = require('mongodb').MongoClient
const client = new MongoClient(keys.mongo_uri);

const bytecode = JSON.parse(fs.readFileSync("hrc721.evm.json"));
const abi = JSON.parse(fs.readFileSync("hrc721.abi.json"));
const code = "0x" + bytecode.object;

const dclient = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

let waccount = web3.eth.accounts.wallet.add(keys.wallet_key);

const deploy = process.argv.includes("--deploy");

let discords;
let contract;
// Yes this will be garbage if deploying
let contractAddress;
if (!deploy) {
    contractAddress = process.argv[process.argv.length - 1];
}

let mintSemaphore = false;

let transferNFT = (msg, to, from, tokenID) => {
    contract.methods.transferFrom(from, to, tokenID).send({
        from: waccount.address,
        gas: 20000000,
        gasPrice: "30000000000"
    }).on("transactionHash", hash => {
        console.dir(["txhash (transfer)", hash]);
    })
    .on("confirmation", async (confirmationNumber, receipt) => {
        if (confirmationNumber === 0) {
            console.dir(["confirmation (transfer)", confirmationNumber, receipt]);
            msg.reply(`Transfered nft to ${to}`);
        }
    })
    .on("receipt", receipt => {
        console.dir(["receipt (transfer)", receipt]);
    })
    .on("error", (error, receipt) => {
        console.dir(["error (transfer)", error, receipt]);
        mintSemaphore = false;
    });
};

let doMint = (msg, toAddress, ipfshash, tokenID) => {
    contract.methods.name().call().then(console.dir);
        contract.methods.mint(waccount.address).send({
            from: waccount.address,
            gas: 20000000,
            gasPrice: "30000000000"
        })
        .on("transactionHash", hash => {
            console.dir(["txhash (mint)", hash]);
        })
        .on("confirmation", async (confirmationNumber, receipt) => {
            if (confirmationNumber === 0) {
                console.dir(["confirmation (mint)", confirmationNumber, receipt]);
                msg.reply(`Mint completed`);
                mintSemaphore = false;
                const doc = {
                    ipfshash: ipfshash,
                    contract: contractAddress,
                    tokenID: tokenID 
                };
                const result = await discords.insertOne(doc);
                transferNFT(msg, toAddress, waccount.address, tokenID);
            }
        })
        .on("receipt", receipt => {
            console.dir(["receipt (mint)", receipt]);
        })
        .on("error", (error, receipt) => {
            console.dir(["error (mint)", error, receipt]);
            mintSemaphore = false;
        });
};

let ipfsize = async (url, msg, toAddress) => {
    while (mintSemaphore) {
        console.log("Hit semaphore (I will be dumb and change the code and this message will help me know I forgot to unsignal it at some point)");
        await new Promise(v => setTimeout(v, 5000));
    }

    let tokenIdx = parseInt(await contract.methods.totalSupply().call());

    https.get(url, res => {
        res.on("error", err => {
            console.error(err);
            mintSemaphore = false;
        }); 

        const chunks = [];

        res.on("data", chunk => {
            chunks.push(chunk);
        });

        res.on("end", async () => {
            let buffer = Buffer.concat(chunks)

            const postopts = {
                method: "POST",
                url: "https://api-eu1.tatum.io/v3/ipfs",
                port: 443,
                headers: {
                    "content-type": "multipart/form-data",
                    "x-api-key": keys.tatum_key
                },
                formData: {
                    "file": {
                        value: buffer,
                        options: {
                            filename: "token.png",
                            // contentType: <mime type> // Idk if needed or not
                        }
                    }
                }
            };

            request(postopts, (err, res, body) => {
                if (err) {
                    console.log("There was an error storing data");
                    console.log(body.toString());
                    mintSemaphore = false;
                } else {
                    // Go ahead and print it out anyways for now
                    console.log(body.toString());
                    const ipfshash = JSON.parse(body)["ipfsHash"];
                    console.log("ipfsHash: " + ipfshash);
                    doMint(msg, toAddress, ipfshash, tokenIdx);
                }
            });
        });
    });
}

let go = async () => {
    await client.connect();
    const database = client.db("discorddb");
    discords = database.collection("discords");
    let contractmap = database.collection("contractmap");
    
    if (deploy) {
        const uid = uuidv4();
        const mintingContract = new web3.eth.Contract(abi);
    
        mintingContract.deploy({
            data: code,
            arguments: ["Discord nfts", "DNFT", `realm endpoint (not in place yet)?uid=${uid}&id=`]
        })
        .send({
            from: waccount.address,
            gas: 20000000,
            gasPrice: "30000000000"
        }, function(error, transactionHash){ console.dir(["sending", error, transactionHash]); })
        .on("error", function(error){ console.dir(["error", error]); })
        .on("transactionHash", function(transactionHash){ console.dir(["txhash", transactionHash]); })
        .on("receipt", function(receipt){
            console.dir(["receipt", receipt.contractAddress]); // contains the new contract address
        })
        .on("confirmation", async (confirmationNumber, receipt) => {
            if (confirmationNumber === 3) {
                console.dir(["confirmation", confirmationNumber, receipt]);
                const doc = {
                    uid: uid,
                    address: receipt.contractAddress
                };
                const result = await contractmap.insertOne(doc);
                process.exit(0);
            }
        })
        .then(function(newContractInstance){
            console.dir(["new instance", newContractInstance.options.address]) // instance with the new contract address
            // doMint(newContractInstance, count, name, symbol, ipfscids, 0, res);
        });
    } else {
        if (!contractAddress) {
            console.error("Missing contract address with which to interact");
            process.exit(1);
        }

        contract = new web3.eth.Contract(abi, contractAddress);

        // Mongo optimizes sort().limit() even though it feels wrong
        // let maxDoc = await discords.find({ contract: contractAddress }).sort({ tokenID: -1}).limit(1);
        // if (maxDoc) {
        //     maxToken = maxDoc.tokenID;
        // }

        dclient.login(keys.discord_key);
        
        dclient.on("messageCreate", async msg => {
            if (msg.content.split(" ")[0] === "!nft-this") {
                if (!msg.attachments.first()) {
                    msg.reply("Missing attachment");
                    return;
                }
                let toAddress = msg.content.split(" ")[1];
                if (!web3.utils.isAddress(toAddress)) {
                    msg.reply("Valid address not provided");
                    return;
                }
                ipfsize(msg.attachments.first().url, msg, toAddress);
                // msg.reply(`Making nft of ${msg.attachments.first().url}`);
                msg.reply(`Making nft ...`);
                // console.log(`Making nft of ${msg.attachments.first().url}`);
            }
            if (msg.content.split(" ")[0] === "!nft-owner-of") {
                try {
                    let id = parseInt(msg.content.split(" ")[1]);
                    let addr = await contract.methods.ownerOf(id).call();
                    msg.reply(`The owner of token #${id} is ${addr}`);
                } catch {
                    msg.reply("Bad command");
                }
            }
            if (msg.content.split(" ")[0] === "!nft-contract") {
                msg.reply(`Contract of minting is ${contractAddress}`);
            }
        });
    }
}

go();