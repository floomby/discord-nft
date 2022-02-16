// The amount I am using the database seems antithetical to the whole ideas of having a smart contract manage this
// Note that burning tokens breaks transfering (badly) if the contract is untracked (I will write the code to fix this at some point)

// TODO
// * I need to put the blockchain searching code from that other thing I made into here to find all the interactions for the contract so we can show transfers
// * Viewing nfts on discord
// * Change the smart contract to keep the metadata on ipfs (maybe unwanted idk)
// * Proper way to burn tokens without having to jankily interact with the contract
// * Correct gas estimation
// * Transfer gas to the minting acount to run the transaction (or change the minting to run from the creator account (this requires adding them to the mint role which also takes gas thought so idk))
// * If I keep going with this project I should really switch to using mongoose cause it supports odm and stuff

const { Client, Intents } = require("discord.js");
const request = require("request");
const https = require("https");
const fs = require("fs");
const Web3 = require("web3");
const { v4: uuidv4 } = require('uuid');
const express = require('express');
const cors = require("cors");
const BN = require('bn.js');

const rpc = "https://api.s0.b.hmny.io";

function blockchainEncodeAddress(address) {
    if (!/^(0x)/.test(address)) {
        address = "0x" + address;
    }
    return address.toLowerCase();
}

const bytecode = JSON.parse(fs.readFileSync("hrc721.evm.json"));
const abi = JSON.parse(fs.readFileSync("hrc721.abi.json"));
const code = "0x" + bytecode.object;

let loadedContracts = new Map();

const keys = require("./keys");

const mintingPrice = new BN(keys.minting_price, 10);

function getContract(address) {
    address = blockchainEncodeAddress(address);
    let ret = loadedContracts.get(address);
    if (!ret) {
        ret = new web3.eth.Contract(abi, address);
        loadedContracts.set(address, ret);
    }
    return ret;
}

let web3 = new Web3(rpc);

let credentials = {};

if (keys.is_deployment) {
    credentials.key = fs.readFileSync("/etc/letsencrypt/live/discord-bot.floomby.us/privkey.pem", "utf8");
    credentials.cert = fs.readFileSync("/etc/letsencrypt/live/discord-bot.floomby.us/cert.pem", "utf8");
    credentials.ca = fs.readFileSync("/etc/letsencrypt/live/discord-bot.floomby.us/chain.pem", "utf8");
} else {
    credentials.key = fs.readFileSync("./sslcert/cert.key", "utf8");
    credentials.cert = fs.readFileSync("./sslcert/cert.pem", "utf8");
}

MongoClient = require('mongodb').MongoClient
const client = new MongoClient(keys.mongo_uri);

const dclient = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

let waccount = web3.eth.accounts.wallet.add(keys.wallet_key);

const deploy = process.argv.includes("--deploy");

// db collections (ikr, good names....)
let discords, contractmap, payments;
let contract;
// Yes this will be garbage if deploying
let contractAddress;
if (!deploy) {
    contractAddress = process.argv[process.argv.length - 1];
}

let mintSemaphore = false;
let untracked = false;

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
            msg.reply(`View nft at ${keys.metamask_link}/?address=${to}&contract=${contractAddress}`);
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
                const doc = {
                    ipfshash: ipfshash,
                    contract: contractAddress,
                    tokenID: tokenID 
                };
                const result = await discords.insertOne(doc);
                if (!untracked) {
                    try {
                        await contractmap.updateOne({ address: contractAddress }, { $inc: { minted: 1 } });
                    } catch(err) {
                        console.err("Unable to write to write minting data to contract collection:\n" + err);
                    }
                }
                mintSemaphore = false;
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
    console.dir(["toAddres", toAddress]);

    while (mintSemaphore) {
        console.log("Hit semaphore (I will be dumb and change the code and this message will help me know I forgot to unsignal it at some point)");
        await new Promise(v => setTimeout(v, 5000));
    }

    let tokenIdx;
    if (untracked) {
        tokenIdx = parseInt(await contract.methods.totalSupply().call());
    } else {
        const doc = await contractmap.findOne({ address: contractAddress });
        tokenIdx = doc.minted;
    }

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

let tokenuriLookup = (con, owner, idx, acm, cb) => {
    if (idx === -1) return cb(acm);
    con.methods.tokenOfOwnerByIndex(owner, idx).call().then(id => {
        con.methods.tokenURI(id).call().then(uri => {
            acm.push(uri);
            tokenuriLookup(con, owner, idx - 1, acm, cb);
        }).catch(console.error);
    }).catch(console.error);
};

let metadataUri = uid => `${keys.metadata_url}/metadata?uid=${uid}&id=`;

let messagePaymentLinkMap = new Map();

let genPaymentLink = async (msg) => {
    const uid = uuidv4();
    await payments.insertOne({ uid: uid, used: false, address: "", txid: "", url: msg.attachments.first().url });
    // return `${keys.metadata_url}?pid=${uid}`
    messagePaymentLinkMap.set(uid, msg);
    return `${keys.metamask_link}?pid=${uid}`;
}

let go = async () => {
    await client.connect();
    const database = client.db("discorddb");
    discords = database.collection("discords");
    contractmap = database.collection("contractmap");
    payments = database.collection("payments");
    const nftname = "Discord nfts";
    const nftsymbol = "DNFT";

    if (deploy) {
        const uid = uuidv4();
        const mintingContract = new web3.eth.Contract(abi);
    
        mintingContract.deploy({
            data: code,
            arguments: [nftname, nftsymbol, metadataUri(uid)]
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
                    address: receipt.contractAddress,
                    name: nftname,
                    description: "Made by nft discord bot",
                    minted: 0,
                    metadata: metadataUri("")
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
        if (!web3.utils.isAddress(contractAddress)) {
            console.error("Invalid contract address");
            process.exit(1);
        }

        const app = express();

        if (!keys.is_deployment) {
            app.use(cors());
        }

        const contractCheck = await contractmap.findOne({ address: contractAddress });
        if (!contractCheck) {
            console.log("Warning this is an untracked contract");
            untracked = true;
        }

        app.get("/metadata", async (req, res) => {
            try {
                const doc = await contractmap.findOne({ uid: req.query.uid });
                console.dir(doc);
                const doc2 = await discords.findOne({ contract: doc.address, tokenID: parseInt(req.query.id) });
                
                res.send({
                    image: `https://cloudflare-ipfs.com/ipfs/${doc2.ipfshash}`,
                    description: doc.description,
                    name: doc.name
                });
            } catch(err) {
                console.dir(["error getting metadata", err]);
                res.send({});
            }
        });

        app.get("/which-rpc", (req, res) => {
            res.send({ rpc: rpc });
        });

        app.get("/mint-address", (req, res) => {
            res.send(waccount.address);
        });

        app.get("/payment", async (req, res) => {
            try {
                let doc = await payments.findOne({ uid: req.query.uid, used: false });
                if (doc) {
                    await payments.updateOne({ uid: req.query.uid, used: false }, { $set: { used: true }});
                    res.send(true);
                }
                else (res.send(false));
            } catch(err) {
                console.log(err);
                res.send(false);
            }
        });

        app.get("/set-payment-uid-address", async (req, res) => {
            try {
                if (!web3.utils.isAddress(req.query.address)) {
                    res.send(false);
                    return;
                }
                let doc = await payments.findOneAndUpdate({ uid: req.query.uid, address: "" }, { $set: { address: req.query.address }});
                if (doc) {
                    res.send(true);
                }
                else res.send(false);
            } catch(err) {
                console.log(err);
                res.send(false);
            }
        });

        app.get("/txid-for-uid", async (req, res) => {
            try {
                let doc = await payments.findOneAndUpdate({ uid: req.query.uid, txid: "" }, { $set: { txid: req.query.txid }});
                if (doc) {
                    console.dir(doc);
                    res.send(true);
                    console.dir(req.query.txid);
                    // TODO We need to wait for the transaction to be confirmed by the network just waiting is stupid
                    // Probably the best way to do this is to check the pending transactions and then make sure it is there and wait for it to quit being pending by either being confirmed or rejected
                    await new Promise(v => setTimeout(v, 10000));
                    web3.eth.getTransaction(req.query.txid).then(async tx => {
                        const val = new BN(tx.value, 10);
                        if (val >= mintingPrice) {
                            let msg = messagePaymentLinkMap.get(req.query.uid);
                            ipfsize(msg.attachments.first().url, msg, doc.value.address);
                        }
                    });
                    return;
                }
            } catch(err) {
                console.log(err);
            }
            res.send(false);
        });

        app.get("/tokens-for", (req, res) => {
            try {
                if (!web3.utils.isAddress(req.query.contract)) throw Error("Invalid contract address");
                if (!web3.utils.isAddress(req.query.owner)) throw Error("Invalid owner address");
                let con = getContract(req.query.contract);
                con.methods.balanceOf(req.query.owner).call().then(count => {
                    tokenuriLookup(con, req.query.owner, count - 1, [], acm => { res.send({ uris: acm })});
                }).catch(console.error);
            } catch(err) {
                console.error(err);
            }
        });

        app.use(express.static("./frontend/build"));

        // app.listen(keys.http_port, () => {
        //     console.log(`Listening on port ${keys.http_port}`);
        // });

        const httpsServer = https.createServer(credentials, app);
        httpsServer.listen(keys.https_port, () => {
            console.log(`Running on port ${keys.https_port}`);
        });

        contract = new web3.eth.Contract(abi, contractAddress);
        loadedContracts.set(blockchainEncodeAddress(contractAddress), contract);

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
                // let toAddress = msg.content.split(" ")[1];
                // if (!web3.utils.isAddress(toAddress)) {
                //     msg.reply("Valid address not provided");
                //     return;
                // }
                msg.author.send(`Minting link ${await genPaymentLink(msg)}`);

                // ipfsize(msg.attachments.first().url, msg, toAddress);

                // msg.reply(`Making nft of ${msg.attachments.first().url}`);
                // msg.reply(`Making nft ...`);
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
            if (msg.content.split(" ")[0] === "!nft-token-uri") {
                try {
                    let id = parseInt(msg.content.split(" ")[1]);
                    let uri = await contract.methods.tokenURI(id).call();
                    msg.reply(`The uri of token #${id} is ${uri}`);
                } catch {
                    msg.reply("Bad command");
                }
            }
            if (msg.content === "!nft-token-supply") {
                const supply = parseInt(await contract.methods.totalSupply().call());
                msg.reply(`There are ${supply} tokens in circulation`);
            }
            if (msg.content === "!nft-contract") {
                msg.reply(`Contract of minting is ${contractAddress}`);
            }
            if (msg.content === "!blockchain-latest-block") {
                const latest = await web3.eth.getBlockNumber();
                msg.reply(`Latest block is ${latest}`);
            }
        });
    }
}

go();